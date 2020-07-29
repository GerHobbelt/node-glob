// Approach:
//
// 1. Get the minimatch set
// 2. For each pattern in the set, PROCESS(pattern, false)
// 3. Store matches per-set, then uniq them
//
// PROCESS(pattern, inGlobStar)
// Get the first [n] items from pattern that are all strings
// Join these together.  This is PREFIX.
//   If there is no more remaining, then stat(PREFIX) and
//   add to matches if it succeeds.  END.
//
// If inGlobStar and PREFIX is symlink and points to dir
//   set ENTRIES = []
// else readdir(PREFIX) as ENTRIES
//   If fail, END
//
// with ENTRIES
//   If pattern[n] is GLOBSTAR
//     // handle the case where the globstar match is empty
//     // by pruning it out, and testing the resulting pattern
//     PROCESS(pattern[0..n] + pattern[n+1 .. $], false)
//     // handle other cases.
//     for ENTRY in ENTRIES (not dotfiles)
//       // attach globstar + tail onto the entry
//       // Mark that this entry is a globstar match
//       PROCESS(pattern[0..n] + ENTRY + pattern[n .. $], true)
//
//   else // not globstar
//     for ENTRY in ENTRIES (not dotfiles, unless pattern[n] is dot)
//       Test ENTRY against pattern[n]
//       If fails, continue
//       If passes, PROCESS(pattern[0..n] + item + pattern[n+1 .. $])
//
// Caveat:
//   Cache all stats and readdirs results to minimize syscall.  Since all
//   we ever care about is existence and directory-ness, we can just keep
//   `true` for files, and [children,...] for directories, or `false` for
//   things that don't exist.

module.exports = glob

var fs = require('fs')
var minimatch = require('@gerhobbelt/minimatch')
var inherits = require('util').inherits
var EE = require('events').EventEmitter
var path = require('path')
var assert = require('assert')
var common = require('./common.js')
var setopts = common.setopts
var ownProp = common.ownProp
var inflight = require('inflight')
var childrenIgnored = common.childrenIgnored
var isIgnored = common.isIgnored
var pathToUnix = common.pathToUnix


const once = f => {
  let v = false;
  return function() {
    if (v) return;
    v = true;
    return f.apply(this, arguments);
  }
};

function glob (pattern, options, cb) {
  if (typeof options === 'function') {
    cb = options
    options = {}
  }
  if (!options) {
    options = {}
  }

  if (options.sync && !options.noprocess) {
    if (cb) {
      throw new TypeError('callback provided to sync glob\n'+
                          'See: https://github.com/isaacs/node-glob/issues/167')
    }
  }

  return new Glob(pattern, options, cb)
}

function globSync (pattern, options) {
  if (typeof options === 'function') {
      throw new TypeError('callback provided to sync glob\n'+
                          'See: https://github.com/isaacs/node-glob/issues/167')
  }
  options = Object.assign({}, options || {}, { sync: true })

  return new Glob(pattern, options).found
}

function GlobSync (pattern, options) {
  if (typeof options === 'function') {
      throw new TypeError('callback provided to sync glob\n'+
                          'See: https://github.com/isaacs/node-glob/issues/167')
  }
  if (options && !options.sync) {
    options = Object.assign({}, options || {}, { sync: true })
  }
  return Glob(pattern, options)
}


glob.sync = globSync
glob.GlobSync = globSync.GlobSync = GlobSync

// old api surface
glob.glob = glob

glob.hasMagic = function (pattern, options_) {
  var options = Object.assign({}, options_)
  options.noprocess = true

  var g = new Glob(pattern, options)
  var set = g.minimatch.set

  if (!pattern)
    return false

  if (set.length > 1)
    return true

  if (set.length === 0)
    return false

  for (var j = 0; j < set[0].length; j++) {
    if (typeof set[0][j] !== 'string')
      return true
  }

  return false
}

glob.Glob = Glob
inherits(Glob, EE)
function Glob (pattern, options, cb) {
  if (typeof options === 'function') {
    cb = options
    options = null
  }

  if (!pattern) {
    throw new Error('must provide pattern')
  }

  if (options && options.sync && !options.noprocess) {
    if (cb) {
      throw new TypeError('callback provided to sync glob\n'+
                          'See: https://github.com/isaacs/node-glob/issues/167')
    }
  }

  if (!(this instanceof Glob)) {
    return new Glob(pattern, options, cb)
  }

  setopts(this, pattern, options)
  this._didRealPath = false
  this._inflightSyncCache = Object.create(null);

  // process each pattern in the minimatch set
  var n = this.minimatch.set.length

  // The matches are stored as {<filename>: true,...} so that
  // duplicates are automagically pruned.
  // Later, we do an Object.keys() on these.
  // Keep them as a list so we can fill in when nonull is set.
  this.matches = new Array(n)

  if (typeof cb === 'function') {
    cb = once(cb)
    this.on('error', cb)
    this.on('end', function (matches) {
      cb(null, matches)
    })
  }

  var self = this
  this._processing = 0

  this._emitQueue = []
  this._processQueue = []
  this.paused = false

  if (this.noprocess)
    return this

  if (n === 0)
    return done()

  var sync = true
  for (var i = 0; i < n; i ++) {
    this._process(this.minimatch.set[i], i, false, done)
  }
  sync = false

  function done () {
    --self._processing
    self.debug('glob DONE', { processing: self._processing, sync, syncOption: self.sync })
    if (self._processing <= 0) {
      if (sync && !self.sync) {
        process.nextTick(function () {
          self._finish()
        })
      } else {
        self._finish()
      }
    }
  }
}

Glob.prototype.debug = function () {}

Glob.prototype._finish = function () {
  assert(this instanceof Glob)
  if (this.aborted)
    return

  if (this.realpath && !this._didRealpath)
    return this._realpath()

  common.finish(this)
  this.emit('end', this.found)
}

Glob.prototype._realpath = function () {
  if (this._didRealpath)
    return

  this._didRealpath = true

  var n = this.matches.length
  if (n === 0)
    return this._finish()

  var self = this
  for (var i = 0; i < this.matches.length; i++) {
    this._realpathSet(i, next)
  }

  function next () {
    if (--n === 0) {
      self._finish()
    }
  }
}

Glob.prototype._realpathSet = function (index, cb) {
  var matchset = this.matches[index]
  if (!matchset)
    return cb()

  var found = Object.keys(matchset)
  var self = this
  var n = found.length

  if (n === 0)
    return cb()

  var set = this.matches[index] = Object.create(null)
  found.forEach(function (p, i) {
    // If there's a problem with the stat, then it means that
    // one or more of the links in the realpath couldn't be
    // resolved.  just return the abs value in that case.
    p = self._makeAbs(p)
    self.fs_realpath(p, function (er, real) {
      real = pathToUnix(real)
      this.debug('fs_realpath CB', { er, p, real })
      if (!er)
        set[real] = true
      else if (er.syscall === 'stat')
        set[p] = true
      else {
        self.emit_error(er); // srsly wtf right here
      }

      if (--n === 0) {
        self.matches[index] = set
        cb()
      }
    })
  })
}

Glob.prototype._mark = function (p) {
  return common.mark(this, p)
}

Glob.prototype._makeAbs = function (f) {
  return common.makeAbs(this, f)
}

Glob.prototype.abort = function () {
  this.aborted = true
  this.emit('abort')
}

Glob.prototype.pause = function () {
  if (!this.paused) {
    this.paused = true
    this.emit('pause')
  }
}

Glob.prototype.resume = function () {
  if (this.paused) {
    this.emit('resume')
    this.paused = false
    if (this._emitQueue.length) {
      var eq = this._emitQueue.slice(0)
      this._emitQueue.length = 0
      for (var i = 0; i < eq.length; i ++) {
        var e = eq[i]
        this._emitMatch(e[0], e[1])
      }
    }
    if (this._processQueue.length) {
      var pq = this._processQueue.slice(0)
      this._processQueue.length = 0
      for (var i = 0; i < pq.length; i ++) {
        var p = pq[i]
        this._processing--
        this._process(p[0], p[1], p[2], p[3])
      }
    }
  }
}

Glob.prototype._process = function (pattern, index, inGlobStar, cb) {
  assert(this instanceof Glob)
  assert(typeof cb === 'function')

  if (this.aborted)
    return

  this._processing++
  if (this.paused) {
    this._processQueue.push([pattern, index, inGlobStar, cb])
    return
  }

  this.debug('PROCESS', { processing: this._processing, pattern, index, inGlobStar })

  // Get the first [n] parts of pattern that are all strings.
  var n = 0
  while (typeof pattern[n] === 'string') {
    n ++
  }
  // now n is the index of the first one that is *not* a string.

  // See if there's anything else
  var prefix
  switch (n) {
    // if not, then this is rather simple
    case pattern.length:
      this._processSimple(pattern.join('/'), index, cb)
      return

    case 0:
      // pattern *starts* with some non-trivial item.
      // going to readdir(cwd), but not include the prefix in matches.
      prefix = null
      break

    default:
      // pattern has some string bits in the front.
      // whatever it starts with, whether that's 'absolute' like /foo/bar,
      // or 'relative' like '../baz'
      prefix = pattern.slice(0, n).join('/')
      break
  }

  var remain = pattern.slice(n)

  // get the list of entries.
  var read
  if (prefix === null)
    read = '.'
  else if (path.isAbsolute(prefix) || path.isAbsolute(pattern.join('/'))) {
    if ((!prefix || !path.isAbsolute(prefix)) && !common.isWinDrive(prefix))
      prefix = '/' + prefix
    read = prefix
  } else
    read = prefix

  var abs = this._makeAbs(read)

  // if ignored, skip processing
  if (childrenIgnored(this, read))
    return cb()

  var isGlobStar = remain[0] === minimatch.GLOBSTAR
  if (isGlobStar)
    this._processGlobStar(prefix, read, abs, remain, index, inGlobStar, cb)
  else
    this._processReaddir(prefix, read, abs, remain, index, inGlobStar, cb)
}

Glob.prototype._processReaddir = function (prefix, read, abs, remain, index, inGlobStar, cb) {
  var self = this
  this._readdir(abs, inGlobStar, function (er, entries) {
    return self._processReaddir2(prefix, read, abs, remain, index, inGlobStar, entries, cb)
  })
}

Glob.prototype._processReaddir2 = function (prefix, read, abs, remain, index, inGlobStar, entries, cb) {
  this.debug('processReaddir2', { prefix, read, abs, rawGlob: remain[0]._glob, index, entries, inGlobStar })

  // if the abs isn't a dir, then nothing can match!
  if (!entries)
    return cb()

  // It will only match dot entries if it starts with a dot, or if
  // dot is set.  Stuff like @(.foo|.bar) isn't allowed.
  var pn = remain[0]
  var negate = !!this.minimatch.negate
  var rawGlob = pn._glob
  var dotOk = this.dot || rawGlob.charAt(0) === '.'

  var matchedEntries = []
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i]
    if (e.charAt(0) !== '.' || dotOk) {
      var m
      if (negate && !prefix) {
        m = !e.match(pn)
      } else {
        m = e.match(pn)
      }
      if (m)
        matchedEntries.push(e)
    }
  }

  this.debug('processReaddir2 matchedEntries', { prefix, read, abs, rawGlob, negate, matchedEntries, index, entries, inGlobStar })

  var len = matchedEntries.length
  // If there are no matched entries, then nothing matches.
  if (len === 0) {
    return cb()
  }

  // if this is the last remaining pattern bit, then no need for
  // an additional stat *unless* the user has specified mark or
  // stat explicitly.  We know they exist, since readdir returned
  // them.

  if (remain.length === 1 && !this.mark && !this.stat) {
    if (!this.matches[index])
      this.matches[index] = Object.create(null)

    for (var i = 0; i < len; i ++) {
      var e = matchedEntries[i]
      if (prefix) {
        if (prefix.slice(-1) !== '/')
          e = prefix + '/' + e
        else
          e = prefix + e
      }

      if (e.charAt(0) === '/' && !this.nomount) {
        // WARNING
        //
        // DO NOT apply pathToUnix(...) to the path.join() on the next line or tests will fail.
        e = path.join(this.root, e) 
        this.debug('processReaddir2 match A', {e, i, rooted: true, self: this })
      }
      this._emitMatch(index, e)
    }
    // This was the last one, and no stats were needed
    return cb()
  }

  // now test all matched entries as stand-ins for that part
  // of the pattern.
  remain.shift()
  for (var i = 0; i < len; i ++) {
    var e = matchedEntries[i]
    if (prefix) {
      if (prefix.slice(-1) !== '/')
        e = prefix + '/' + e
      else
        e = prefix + e
    }
    this._process([e].concat(remain), index, inGlobStar, cb)
  }
  cb()
}

Glob.prototype._emitMatch = function (index, e) {
  if (this.aborted)
    return

  if (isIgnored(this, e))
    return

  if (this.paused) {
    this._emitQueue.push([index, e])
    return
  }

  var abs = path.isAbsolute(e) ? e : this._makeAbs(e)

  if (this.mark)
    e = this._mark(e)

  if (this.absolute) {
    e = abs
  }

  if (this.matches[index][e]) {
    return
  }

  if (this.nodir) {
    var c = this.cache[abs]
    if (c === 'DIR' || Array.isArray(c)) {
      return
    }
  }

  this.matches[index][e] = true

  var st = this.statCache[abs]
  if (st) {
    this.emit('stat', e, st)
  }

  this.emit('match', e)
}

Glob.prototype._readdirInGlobStar = function (abs, cb) {
  if (this.aborted)
    return

  // follow all symlinked directories forever
  // just proceed as if this is a non-globstar situation
  if (this.follow) {
    return this._readdir(abs, false, cb)
  }

  var lstatkey = 'lstat\0' + abs
  var self = this
  var lstatcb = this.inflight(lstatkey, lstatcb_)
  this.debug('lstat:', { abs, inflight: !!lstatcb })
  if (lstatcb) {
    this.fs_lstat(abs, lstatcb)
  }

  function lstatcb_ (er, lstat) {
    if (er && (er.code === 'ENOENT' || er.code === 'EPERM')) {
      // lstat failed, doesn't exist
      return cb()
    }

    var isSym = lstat && lstat.isSymbolicLink()
    self.symlinks[abs] = isSym

    // If it's not a symlink or a dir, then it's definitely a regular file.
    // don't bother doing a readdir in that case.
    if (!isSym && lstat && !lstat.isDirectory()) {
      self.cache[abs] = 'FILE'
      cb()
    } else {
      self._readdir(abs, false, cb)
    }
  }
}

Glob.prototype._readdir = function (abs, inGlobStar, cb) {
  if (this.aborted)
    return

  //cb = this.inflight('readdir\0'+abs+'\0'+inGlobStar, cb)
  this.debug('readdir', { abs, inGlobStar, inflight: !cb })
  if (!cb)
    return

  if (inGlobStar && !ownProp(this.symlinks, abs)) {
    return this._readdirInGlobStar(abs, cb)
  }

  if (ownProp(this.cache, abs)) {
    var c = this.cache[abs]
    if (!c || c === 'FILE')
      return cb()

    // have we collected the directory child entries already? If yes, then be done
    if (Array.isArray(c)) {
      return cb(null, c)
    }
  }

  this.fs_readdir(abs, readdirCb(this, abs, cb))
}

function readdirCb (self, abs, cb) {
  return function (er, entries) {
    if (er)
      self._readdirError(abs, er, cb)
    else
      self._readdirEntries(abs, entries, cb)
  }
}

Glob.prototype._readdirEntries = function (abs, entries, cb) {
  if (this.aborted)
    return

  this.debug('_readdirEntries RAW:', { abs, entries, cache: this.cache })
  entries = entries.map((p) => pathToUnix(p))

  // if we haven't asked to stat everything, then just
  // assume that everything in there exists, so we can avoid
  // having to stat it a second time.
  if (!this.mark && !this.stat) {
    for (var i = 0; i < entries.length; i ++) {
      var e = entries[i]
      if (abs === '/')
        e = abs + e
      else
        e = abs + '/' + e
      this.cache[e] = true
    }
  }

  this.cache[abs] = entries
  this.debug('_readdirEntries POST:', { abs, entries, cache: this.cache })
  return cb(null, entries)
}

Glob.prototype._readdirError = function (f, er, cb) {
  if (this.aborted)
    return

  this.debug('_readdirError:', { f, er })
  // handle errors, and cache the information
  switch (er.code) {
    case 'ENOTSUP': // https://github.com/isaacs/node-glob/issues/205
    case 'ENOTDIR': // totally normal. means it *does* exist.
    case 'EBUSY':
      var abs = this._makeAbs(f)
      this.cache[abs] = 'FILE'
      if (abs === this.cwdAbs) {
        var error = new Error(er.code + ' invalid cwd ' + this.cwd)
        error.path = this.cwd
        error.code = er.code
        // If the error is handled, then we abort
        // if not, we threw out of here
        this.emit_error(error, true)
      }
      break

    case 'EACCES': // ignore permission denied path
    case 'ENOENT': // not terribly unusual
    case 'EPERM':
    case 'ELOOP':
    case 'ENAMETOOLONG':
    case 'UNKNOWN':
      this.cache[this._makeAbs(f)] = false
      break

    default: // some unusual error.  Treat as failure.
      this.cache[this._makeAbs(f)] = false
      if (this.strict) {
        // If the error is handled, then we abort
        // if not, we threw out of here
        this.emit_error(er, true)
      }
      if (!this.silent) {
        console.error('glob error', er)
      }
      break
  }

  return cb()
}

Glob.prototype._processGlobStar = function (prefix, read, abs, remain, index, inGlobStar, cb) {
  var self = this
  this._readdir(abs, inGlobStar, function (er, entries) {
    self._processGlobStar2(prefix, read, abs, remain, index, inGlobStar, entries, cb)
  })
}


Glob.prototype._processGlobStar2 = function (prefix, read, abs, remain, index, inGlobStar, entries, cb) {
  this.debug('processGlobStar2', { prefix, read, abs, remain, index, inGlobStar, entries })

  // no entries means not a dir, so it can never have matches
  // foo.txt/** doesn't match foo.txt
  if (!entries)
    return cb()

  // test without the globstar, and with every child both below
  // and replacing the globstar.
  var remainWithoutGlobStar = remain.slice(1)
  var gspref = prefix ? [ prefix ] : []
  var noGlobStar = gspref.concat(remainWithoutGlobStar)

  // the noGlobStar pattern exits the inGlobStar state
  this._process(noGlobStar, index, false, cb)

  var isSym = this.symlinks[abs]
  var len = entries.length

  // If it's a symlink, and we're in a globstar, then stop
  if (isSym && inGlobStar)
    return cb()

  for (var i = 0; i < len; i++) {
    var e = entries[i]
    if (e.charAt(0) === '.' && !this.dot)
      continue

    // these two cases enter the inGlobStar state
    var instead = gspref.concat(entries[i], remainWithoutGlobStar)
    this._process(instead, index, true, cb)

    var below = gspref.concat(entries[i], remain)
    this._process(below, index, true, cb)
  }

  cb()
}

Glob.prototype._processSimple = function (prefix, index, cb) {
  // XXX review this.  Shouldn't it be doing the mounting etc
  // before doing stat?  kinda weird?
  var self = this
  this._stat(prefix, function (er, exists) {
    self._processSimple2(prefix, index, er, exists, cb)
  })
}

Glob.prototype._processSimple2 = function (prefix, index, er, exists, cb) {
  this.debug('processSimple2', {prefix, index, er, exists })

  if (!this.matches[index]) {
    this.matches[index] = Object.create(null)
  }

  // If it doesn't exist, then just mark the lack of results
  if (!exists) {
    return cb()
  }

  if (prefix && path.isAbsolute(prefix) && !this.nomount) {
    var trail = /[\/\\]$/.test(prefix)
    if (prefix.charAt(0) === '/') {
      prefix = path.join(this.root, prefix)
    } else {
      prefix = path.resolve(this.root, prefix)
      if (trail) {
        prefix += '/'
      }
    }
    prefix = pathToUnix(prefix)
  }

  // Mark this as a match
  this._emitMatch(index, prefix)
  cb()
}

// Returns either 'DIR', 'FILE', or false
Glob.prototype._stat = function (f, cb) {
  var abs = this._makeAbs(f)
  var needDir = f.slice(-1) === '/'

  if (f.length > this.maxLength)
    return cb()

  if (!this.stat && ownProp(this.cache, abs)) {
    var c = this.cache[abs]

    if (Array.isArray(c)) {
      c = 'DIR'
    }

    // It exists, but maybe not how we need it
    if (!needDir || c === 'DIR') {
      return cb(null, !!c)
    }

    if (needDir && c === 'FILE') {
      return cb()
    }

    // otherwise we have to stat, because maybe c=true
    // if we know it exists, but not what it is.
  }

  var stat = this.statCache[abs]
  if (stat !== undefined) {
    if (stat === false) {
      return cb(null, false)
    }
    else {
      var type = stat.isDirectory() ? 'DIR' : 'FILE'
      if (needDir && type === 'FILE') {
        return cb()
      }
      else {
        return cb(null, true)
      }
    }
  }

  var self = this
  var statcb = this.inflight('stat\0' + abs, lstatcb_)
  this.debug('stat:', { abs, inflight: !!statcb })
  if (statcb) {
    this.fs_lstat(abs, statcb)
  }

  function lstatcb_ (er, lstat) {
    self.debug('lstat cb:', { er })
    if (lstat && lstat.isSymbolicLink()) {
      // If it's a symlink, then treat it as the target, unless
      // the target does not exist, then treat it as a file.
      self.fs_stat(abs, function (er2, stat) {
        if (er2)
          self._stat2(f, abs, null, lstat, cb)
        else
          self._stat2(f, abs, er, stat, cb)
      })
    } else {
      self._stat2(f, abs, er, lstat, cb)
    }
  }
}

Glob.prototype._stat2 = function (f, abs, er, stat, cb) {
  this.debug('_stat2 cb:', { f, abs, er })
  if (er && (er.code === 'ENOENT' || er.code === 'EPERM' || er.code === 'ENOTDIR')) {
    this.statCache[abs] = false
    return cb()
  }

  var needDir = (f.slice(-1) === '/')
  this.statCache[abs] = stat

  if (abs.slice(-1) === '/' && stat && !stat.isDirectory()) {
    return cb(null, false)
  }

  var c = true
  if (stat) {
    c = stat.isDirectory() ? 'DIR' : 'FILE'
  }

  this.cache[abs] = this.cache[abs] || c

  if (needDir && c === 'FILE') {
    return cb()
  }

  return cb(null, true)
}

Glob.prototype.fs_realpath = function (p, cb) {
  this.debug('fs_realpath', { sync: this.sync, path: p })
  if (this.sync) {
    try {
      var real = fs.realpathSync(p);
      cb(null, real)
    } catch (er) {
      cb(er)
    }
  } else {
    fs.realpath(p, cb);
  }
}

Glob.prototype.emit_error = function (er, mustAbort) {
  if (this.sync) {
    throw er
  } else {
    this.emit('error', er)
    if (mustAbort) {
      this.abort();
    }
  }
}

Glob.prototype.fs_lstat = function (p, cb) {
  this.debug('fs_lstat', { sync: this.sync, path: p })
  if (this.sync) {
    try {
      var st = fs.lstatSync(p);
      cb(null, st)
    } catch (er) {
      cb(er)
    }
  } else {
    fs.lstat(p, cb)
  }
}

Glob.prototype.fs_readdir = function (p, cb) {
  this.debug('fs_readdir', { sync: this.sync, path: p })
  if (this.sync) {
    try {
      var rv = fs.readdirSync(p);
      cb(null, rv)
    } catch (er) {
      cb(er)
    }
  } else {
    fs.readdir(p, cb)
  }
}

Glob.prototype.fs_stat = function (p, cb) {
  this.debug('fs_stat', { sync: this.sync, path: p })
  if (this.sync) {
    try {
      var st = fs.statSync(p);
      cb(null, st)
    } catch (er) {
      cb(er)
    }
  } else {
    fs.stat(p, cb);
  }
}

Glob.prototype.inflight = function (key, cb) {
  this.debug('glob.inflight', { sync: this.sync, key })
  if (this.sync) {
    if (this._inflightSyncCache[key]) {
      this.debug('glob.inflight SKIP @@@@@@@@@@@@@@@@@@@@@@@@@@@ ', { sync: this.sync, key }, new Error('x'))
      this._inflightSyncCache[key].push(cb)
      return null
    }
    let self = this;
    return function inflight_cb(...args) {
      self._inflightSyncCache[key] = []
      self.debug('inflight callback exec:', { key, args })
      cb.apply(null, args);
      // also exec any pushed callbacks:
      let arr = self._inflightSyncCache[key]
      for (let i = 0; i < arr.length; i++) {
        let cb2 = arr[i];
        self.debug('inflight callback exec queued #:', { key, index: i, args })
        cb2.apply(null, args);
      }
      self._inflightSyncCache[key] = false
    }
  } else {
    return inflight(key, cb);
  }
}
