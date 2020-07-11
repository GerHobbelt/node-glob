require("./global-leakage.js")
// remove the fixtures
var tap = require("tap")
, rimraf = require("rimraf")
, path = require("path")
, spawn = require('child_process').spawn

// see git commit SHA-1: 3fcb58477cabfc259685bba12daff9c358ab181c: not creating a net share any more, using implicit shares in the tests instead.
if (0) {
  // remove unc share
  if (process.platform === 'win32') {
    tap.test('remove unc-accessible share', function (t) {
      var net = spawn('net', ['share', 'glob-test', '/y', '/delete'])
      net.stderr.pipe(process.stderr)
      net.on('close', function (code) {
        t.equal(code, 0, 'failed to remove unc share')
        t.end()
      })
    })
  }
}

tap.test("cleanup fixtures", function (t) {
  rimraf(path.resolve(__dirname, "fixtures"), function (er) {
    t.ifError(er, "removed")
    t.end()
  })
})

tap.test("cleanup /tmp/glob-test/ fixtures", function (t) {
  rimraf("/tmp/glob-test/", function (er) {
    t.ifError(er, "removed")
    t.end()
  })
})
