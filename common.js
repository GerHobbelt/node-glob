var path = require('path')

exports.alphasort = alphasort
exports.alphasorti = alphasorti
exports.setopts = setopts
exports.ownProp = ownProp
exports.makeAbs = makeAbs
exports.finish = finish
exports.mark = mark
exports.isIgnored = isIgnored
exports.childrenIgnored = childrenIgnored
exports.isWinDrive = isWinDrive

function ownProp (obj, field) {
  return Object.prototype.hasOwnProperty.call(obj, field)
}

var path = require("path")
var minimatch = require("@gerhobbelt/minimatch")
var Minimatch = minimatch.Minimatch


var pathToUnix;
if (process.platform === 'win32') {
  pathToUnix = function (p) {
    return p.replace(/\\/g, '/');
  }
} else {
  pathToUnix = function (p) {
    return p;
  }
}

function WinPath (p) {
  if (!(this instanceof WinPath))
    return new WinPath(p)

  // pull off the device/UNC bit from a windows path.
  // from node's lib/path.js
  var splitDeviceRe =
      /^([a-zA-Z]:|[\\\/]{2}[^\\\/]+[\\\/]+[^\\\/]+)?([\\\/])?([\s\S]*?)$/
  var result = splitDeviceRe.exec(p)
  this.device = result[1] || ''
  this.sep = result[2] || ''
  this.tail = result[3] || ''
  this.isUnc = !!this.device && this.device.charAt(1) !== ':'
  this.isAbsolute = !!this.sep || this.isUnc // UNC paths are always absolute
}

function alphasorti (a, b) {
  return a.toLowerCase().localeCompare(b.toLowerCase())
}

function alphasort (a, b) {
  return a.localeCompare(b)
}

function setupIgnores (self, options) {
  var absolutePattern = path.isAbsolute(self.pattern);
  self.ignore = options.ignore || []

  if (!Array.isArray(self.ignore))
    self.ignore = [self.ignore]

  if (self.ignore.length) {
    self.debug('ignore list before mapping:', { ignoreList: self.ignore, absolutePattern, allPathsAreUnixFormatted: self.allPathsAreUnixFormatted })
    self.ignore = self.ignore.map(function (ignorePattern) {
      if (absolutePattern && !self.allPathsAreUnixFormatted) {
        ignorePattern = makeAbs(self, ignorePattern)
      }

      return ignoreMap(self, ignorePattern)
    })
    self.debug('ignore list after mapping:', { ignoreList: self.ignore })
  }
}

// ignore patterns are always in dot:true mode.
function ignoreMap (self, pattern) {
  if (typeof pattern === 'function') {
    return {
      ignore: pattern,
      ignoreChildren: pattern
    }
  }
  
  var matcher = new Minimatch(pattern, { dot: true, debug: self.debugMode })
  var gmatcher = null
  // negative pattern does not require for additional check
  if (!matcher.negate && pattern.slice(-3) === '/**') {
    var gpattern = pattern.replace(/(\/\*\*)+$/, '')
    gmatcher = new Minimatch(gpattern, { dot: true, debug: self.debugMode })
  }

  return new IgnoreItem(matcher, gmatcher)
}

function IgnoreItem(matcher, gmatcher) {
  this.matcher = matcher
  this.gmatcher = gmatcher
}

IgnoreItem.prototype.ignore = function(path) {
  return this.matcher.match(path)
    || !!(this.gmatcher && this.gmatcher.match(path))
}

IgnoreItem.prototype.ignoreChildren = function (path) {
  return !!(this.gmatcher && this.gmatcher.match(path))
}

function setopts (self, pattern, options) {
  if (!options)
    options = {}

  self.debugMode = options.debug
  if (self.debugMode) {
    self.debug = (typeof self.debugMode === 'function' ? self.debugMode : console.error)
  } else {
    self.debug = () => {}
  }

  self.debug('glob.common input args:', { pattern, options })

  // base-matching: just use globstar for that.
  if (options.matchBase && -1 === pattern.indexOf("/")) {
    if (options.noglobstar) {
      throw new Error("base matching requires globstar")
    }
    pattern = "**/" + pattern
  }

  self.silent = !!options.silent
  self.pattern = pattern
  self.strict = options.strict !== false
  self.realpath = !!options.realpath
  self.realpathCache = options.realpathCache || Object.create(null)
  self.follow = !!options.follow
  self.dot = !!options.dot
  self.mark = !!options.mark
  self.nodir = !!options.nodir
  if (self.nodir) {
    self.mark = true
  }
  self.sync = !!options.sync
  self.nounique = !!options.nounique
  self.nonull = !!options.nonull
  self.nosort = !!options.nosort
  self.nocase = !!options.nocase
  self.stat = !!options.stat
  self.noprocess = !!options.noprocess
  self.absolute = !!options.absolute
  self.allPathsAreUnixFormatted = options.allPathsAreUnixFormatted

  self.maxLength = options.maxLength || Infinity
  self.cache = options.cache || Object.create(null)
  self.statCache = options.statCache || Object.create(null)
  self.symlinks = options.symlinks || Object.create(null)

  self.changedCwd = false
  var cwd = process.cwd()
  if (!ownProp(options, "cwd"))
    self.cwd = cwd
  else {
    self.cwd = pathToUnix(path.resolve(options.cwd))
    self.changedCwd = self.cwd !== cwd
  }

  self.root = options.root
  if (process.platform === "win32") {
    var winPath = new WinPath(pattern)
    if (winPath.isAbsolute) {
      // only override the root when the pattern did include an actual **drive letter**!
      if (winPath.device) {
        self.root = winPath.device + winPath.sep
      }
      pattern = winPath.sep + winPath.tail
    }
  }

  self.root = path.resolve(self.root || "/")
  self.root = pathToUnix(self.root)

  // TODO: is an absolute `cwd` supposed to be resolved against `root`?
  // e.g. { cwd: '/test', root: __dirname } === path.join(__dirname, '/test')
  self.cwdAbs = path.isAbsolute(self.cwd) ? self.cwd : makeAbs(self, self.cwd)
  self.cwdAbs = pathToUnix(self.cwdAbs)
  self.nomount = !!options.nomount

  // disable comments and negation in Minimatch.
  // Note that they are not supported in Glob itself anyway.
  options.nonegate = true
  options.nocomment = true

  self.minimatch = new Minimatch(pattern, options)
  self.options = self.minimatch.options

  // this should come last so self.changedCwd is set (among other things)
  // to allow the ignores to be resolved absolutely if needed
  setupIgnores(self, options)
}

function finish (self) {
  var nou = self.nounique
  var all = nou ? [] : Object.create(null)

  for (var i = 0, l = self.matches.length; i < l; i ++) {
    var matches = self.matches[i]
    if (!matches || Object.keys(matches).length === 0) {
      if (self.nonull) {
        // do like the shell, and spit out the literal glob
        var literal = self.minimatch.globSet[i]
        if (nou)
          all.push(literal)
        else
          all[literal] = true
      }
    } else {
      // had matches
      var m = Object.keys(matches)
      if (nou)
        all.push.apply(all, m)
      else
        m.forEach(function (m) {
          all[m] = true
        })
    }
  }

  if (!nou)
    all = Object.keys(all)

  if (!self.nosort)
    all = all.sort(self.nocase ? alphasorti : alphasort)

  // at *some* point we statted all of these
  if (self.mark) {
    for (var i = 0; i < all.length; i++) {
      all[i] = self._mark(all[i])
    }
    if (self.nodir) {
      all = all.filter(function (e) {
        var notDir = !(/\/$/.test(e))
        var c = self.cache[e] || self.cache[makeAbs(self, e)]
        if (notDir && c)
          notDir = c !== 'DIR' && !Array.isArray(c)
        return notDir
      })
    }
  }

  if (self.ignore.length)
    all = all.filter(function(m) {
      return !isIgnored(self, m)
    })

  self.found = all
}

function mark (self, p) {
  var abs = makeAbs(self, p)
  var c = self.cache[abs]
  var m = p
  if (c) {
    var isDir = c === 'DIR' || Array.isArray(c)
    var slash = p.slice(-1) === '/'

    if (isDir && !slash)
      m += '/'
    else if (!isDir && slash)
      m = m.slice(0, -1)

    if (m !== p) {
      var mabs = makeAbs(self, m)
      self.statCache[mabs] = self.statCache[abs]
      self.cache[mabs] = self.cache[abs]
    }
  }

  return m
}

// lotta situps...
function makeAbs (self, f) {
  var abs
  
  if (f.charAt(0) === '/') {
    abs = path.join(self.root, f)
    self.debug('makeAbs ROOTED:', { before: f, root: self.root, after: abs })
    abs = pathToUnix(abs);
  } else if (isWinDrive(f)) {
    abs = f + '/'                               // e.g. "C:/"
  } else if (path.isAbsolute(f) || f === '') {
    abs = f
    if (!self.allPathsAreUnixFormatted) {
      abs = pathToUnix(abs);
    }
  } else if (self.changedCwd) {
    abs = path.resolve(self.cwd, f)
    self.debug('makeAbs changedCWD:', { before: f, cwd: self.cwd, after: abs })
    abs = pathToUnix(abs);
  } else {
    abs = path.resolve(f)
    self.debug('makeAbs MISC:', { before: f, after: abs })
    abs = pathToUnix(abs);
  }

  self.debug('makeAbs -->', { inputPath: f, returnPath: abs })
  return abs
}


// Return true, if pattern ends with globstar '**', for the accompanying parent directory.
// Ex:- If node_modules/** is the pattern, add 'node_modules' to ignore list along with it's contents
function isIgnored (self, path) {
  if (!self.ignore.length)
    return false

  return self.ignore.some(function(item) {
    return item.ignore(path)
  })
}

function childrenIgnored (self, path) {
  if (!self.ignore.length)
    return false

  return self.ignore.some(function(item) {
    return item.ignoreChildren(path)
  })
}

function isWinDrive (path) {
  return process.platform === 'win32' && path.match(/^[a-z]+:$/i)
}
