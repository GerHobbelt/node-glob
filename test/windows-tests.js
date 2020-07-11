var test = require('tap').test
var path = require('path')
var os = require('os')

var uncRoot = '\\\\' + os.hostname() + '\\glob-test'
uncRoot = ('\\\\' + os.hostname() + '\\' + path.join(__dirname, 'fixtures/a').replace(/^([^\\/]+):([\\/].*)$/, '$1$$$2')).replace(/\\/g, '/');
console.error('########################### unc path', uncRoot)


var localRoot = path.resolve(__dirname, 'fixtures/a').replace(/\\/g, '/')
var windowsRoot = localRoot

function mockMinimatchForWin32() {
  var minimatch = require('@gerhobbelt/minimatch')
  var OriginalMinimatch = minimatch.Minimatch
  minimatch.Minimatch = function Minimatch(pattern, options) {
    if (!(this instanceof Minimatch))
      return new Minimatch(pattern, options)

    var mm = new OriginalMinimatch(pattern.replace(/\\/g, '/'), options)
    this.pattern = mm.pattern
    this.options = mm.options
    this.set = mm.set
    this.regexp = mm.regexp
    this.negate = mm.negate
    this.comment = mm.comment
    this.empty = mm.empty
    this.makeRe = mm.makeRe
    this.match = mm.match
    this.matchOne = mm.matchOne
  }
}

function mockResolveForWin32() {
  var originalResolve = path.resolve
  path.resolve = function() {
    var args = arguments
    var p = args[0].replace(/\\/g, '/')
    if (p.indexOf(uncRoot) === 0) {
      p = p.replace(uncRoot, localRoot)
    } else if (p.indexOf('C:/') === 0) {
      p = p.replace('C:/', '/')
    }
    args[0] = p;
    return originalResolve.apply(path, args)
  }
}

function mockProcessPlatformForWin32() {
  Object.defineProperty(process, 'platform', { value: 'win32' })
}

var mockingWin32 = (process.platform !== 'win32')
if (mockingWin32) {
  windowsRoot = 'C:' + localRoot
  mockMinimatchForWin32()
  mockResolveForWin32()
}
var glob = require('../glob.js')
if (mockingWin32) {
  mockProcessPlatformForWin32()
}

test('glob doesn\'t choke on UNC paths', function(t) {
  var expect = [uncRoot + '/c', uncRoot + '/cb']

  var results = glob(uncRoot + '/c*', { debug: false }, function (er, results) {
    if (er)
      throw er

    var uncResults = results.map(function (result) { 
      return result.replace(/\\/g, '/').replace(localRoot, uncRoot) 
    })
    t.same(uncResults, expect)
    t.end()
  })
})

test('can match abs paths on Windows with nocase', function(t) {
  var testPath = path.resolve(__dirname, "fixtures/a/b/c/d").replace(/\\/g, '/')
  glob(windowsRoot + '/**/b/c/d', {nocase: true, debug: false}, function (err, match) {
    t.same(match.map((el) => el.replace(/\\/g, '/')), [testPath])
    t.end()
  })
})
