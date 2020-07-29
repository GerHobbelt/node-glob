require("./global-leakage.js")
var path = require('path')
var fs = require('fs')
var mkdirp = require('mkdirp')
var glob = require('../')
var Glob = glob.Glob
var test = require('tap').test

test('set up broken symlink', function (t) {
  cleanup()
  mkdirp.sync('fixtures/a/broken-link')
  fs.symlinkSync('this-does-not-exist', 'fixtures/a/broken-link/link')
  t.end()
})

test('regression', function(t) {
  var spec = {
    pattern: 'fixtures/a/broken-link/**/*',
    res: [],
    opt: { mark: true, nonegate: true, nocomment: true },
    link: 'fixtures/a/broken-link/link'
  }
  var specset = spec.res;
  var opt = Object.assign({}, spec.opt, { cwd: __dirname, debug: false });
  var g = new Glob(spec.pattern, opt)
  var matches = []
  g.on('match', function(m) {
    g.debug('@@@@@@ MATCH', m)
    matches.push(m)
  })
  g.on('end', function(set) {
    g.debug('@@@@@@ END', {matches, specset, set})
    matches = matches.sort()

    set = set.sort()
    g.debug('@@@@@@ END', {matches, specset, set})
    t.same(matches, set, 'should have same set of matches')

    t.notEqual(set.indexOf(spec.link), -1, 'opt=' + JSON.stringify(opt))

    var res = glob.sync(spec.pattern, opt)
    g.debug('@@@@@@ SYNC', {res, set})
    t.same(res, set, 'should have same set of matches')

    t.notEqual(res.indexOf(spec.link), -1, 'SYNC opt=' + JSON.stringify(opt))

    t.end()
  })
})

test('cleanup', function (t) {
  cleanup()
  t.end()
})

function cleanup () {
  try { fs.unlinkSync('fixtures/a/broken-link/link') } catch (e) {}
  try { fs.rmdirSync('fixtures/a/broken-link') } catch (e) {}
}
