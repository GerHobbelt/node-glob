// regression test to make sure that slash-ended patterns
// don't match files when using a different cwd.
var glob = require('../')
var path = require('path')
var test = require('tap').test
var pattern = '../{*.md,test}/'
var expect = [ '../test/' ]
var cwd = __dirname.replace(/\\/g, '/')
process.chdir(path.join(__dirname, '..'))

test('slashes only match directories (sync)', function (t) {
  var sync = glob.sync(pattern, { cwd: cwd })
  t.same(sync, expect, 'sync test')
  t.end()
})

test('slashes only match directories', function (t) {
  glob(pattern, { cwd: cwd, debug: false }, function (er, async) {
    if (er)
      throw er
    t.same(async, expect, 'async test')
    t.end()
  })
})
