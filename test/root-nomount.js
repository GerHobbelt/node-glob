require("./global-leakage.js")
var tap = require("tap")
var glob = require('../')
var path = require('path')

function cacheCheck(g, t) {
  // verify that path cache keys are all absolute
  var caches = [ 'cache', 'statCache', 'symlinks' ]
  caches.forEach(function (c) {
    Object.keys(g[c]).forEach(function (p) {
      t.ok(path.isAbsolute(p), p + ' should be absolute')
    })
  })
}

process.chdir(path.join(__dirname, 'fixtures'))

tap.test("changing root and searching for /b*/**", function (t) {
  t.test('.', function (t) {
    var g = glob('/b*/**', { root: '.', nomount: true }, function (er, matches) {
      t.ifError(er)
      t.like(matches, [])
      cacheCheck(g, t)
      t.end()
    })
  })

  t.test('a', function (t) {
    var g = glob('/b*/**', { root: path.resolve('a').replace(/\\/g, '/'), nomount: true }, function (er, matches) {
      t.ifError(er)
      t.like(matches, [ '/b', '/b/c', '/b/c/d', '/bc', '/bc/e', '/bc/e/f' ])
      cacheCheck(g, t)
      t.end()
    })
  })

  t.test('root=a, cwd=a/b', function (t) {
    var g = glob('/b*/**', { root: 'a', cwd: path.resolve('a/b').replace(/\\/g, '/'), nomount: true }, function (er, matches) {
      t.ifError(er)
      t.like(matches, [ '/b', '/b/c', '/b/c/d', '/bc', '/bc/e', '/bc/e/f' ])
      cacheCheck(g, t)
      t.end()
    })
  })

  t.end()
})
