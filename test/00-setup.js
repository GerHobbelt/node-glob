// just a little pre-run script to set up the fixtures.
// zz-finish cleans it up

require("./global-leakage.js")
var mkdirp = require("mkdirp")
var path = require("path")
var i = 0
var tap = require("tap")
var fs = require("fs")
var rimraf = require("rimraf")
var spawn = require('child_process').spawn

//tap.debug = console.error

var fixtureDir = path.resolve(__dirname, 'fixtures')

var files =
[ "a/.abcdef/x/y/z/a"
, "a/abcdef/g/h"
, "a/abcfed/g/h"
, "a/b/c/d"
, "a/bc/e/f"
, "a/c/d/c/b"
, "a/cb/e/f"
, "a/x/.y/b"
, "a/z/.y/b"
, "edge/!(case)"
, "edge/!case"
, "edge/(case)"
, "edge/case"
]

var symlinkTo = path.resolve(fixtureDir, "a/symlink/a/b/c")
var symlinkFrom = "../.."

files = files.map(function (f) {
  return path.resolve(fixtureDir, f)
})

tap.test("remove fixtures", function (t) {
  rimraf.sync(fixtureDir)
  t.end()
})

files.forEach(function (f) {
  tap.test('setup fixture file ' + f, function (t) {
    f = path.resolve(fixtureDir, f);
    var d = path.dirname(f);
    mkdirp(d, '0755').catch((er) => {
        t.fail(er);
        return t.bailout()
      }).then(() => {
      fs.writeFile(f, "i like tests", function (er) {
        t.ifError(er, "make file")
        t.end()
      })
    })
  })
})


//if (process.platform !== "win32") {
  tap.test("symlinky", function (t) {
    var d = path.dirname(symlinkTo)
    mkdirp(d, '0755').catch((er) => {
        throw er
      }).then(() => {
      fs.symlinkSync(symlinkFrom, symlinkTo, "dir")
      t.end()
    })
  })
//}



var tmpGlobTestDirs = ["foo","bar","baz","asdf","quux","qwer","rewq"]
tmpGlobTestDirs.forEach(function (w) {
  w = "/tmp/glob-test/" + w
  tap.test("create " + w + " --> " + path.resolve(w), function (t) {
    mkdirp(w, '0755').catch((er) => {
        throw er
       }).then(() => {
      t.pass(w)
      t.end()
    })
  })
})

// see git commit SHA-1: 3fcb58477cabfc259685bba12daff9c358ab181c: not creating a net share any more, using implicit shares in the tests instead.
if (0) {
  // share 'a' via unc path \\<hostname>\glob-test
  if (process.platform === 'win32') {
    tap.test('create unc-accessible share', function (t) {
      var localPath = path.resolve(__dirname, 'fixtures/a')
      var net = spawn('net', ['share', 'glob-test=' + localPath])
      net.stderr.pipe(process.stderr)
      net.on('close', function (code) {
        // TODO: currently 'NET SHARE' is a pretty dangerous command as, depending on user rights, this is okay or not. Hence we now IGNORE any failures here:
        if (0) {
          t.equal(code, 0, 'failed to create a unc share')
        }
        t.end()
      })
    })
  }
}


// generate the bash pattern test-fixtures if possible
let rootDrive = '';
if (process.platform === 'win32') {
  rootDrive = process.cwd().replace(/^([^\\/]+:)[\\/].*$/, '$1');
}

var globs =
  // put more patterns here.
  // anything that would be directly in / should be in /tmp/glob-test
  ["a/*/+(c|g)/./d"
  ,"a/**/[cg]/../[cg]"
  ,"a/{b,c,d,e,f}/**/g"
  ,"a/b/**"
  ,"**/g"
  ,"a/abc{fed,def}/g/h"
  ,"a/abc{fed/g,def}/**/"
  ,"a/abc{fed/g,def}/**///**/"
  ,"**/a/**/"
  ,"+(a|b|c)/a{/,bc*}/**"
  ,"*/*/*/f"
  ,"**/f"
  ,"a/symlink/a/b/c/a/b/c/a/b/c//a/b/c////a/b/c/**/b/c/**"
  ,`{./*/*,/tmp/glob-test/*}`
  ,`{/tmp/glob-test/*,*}` // evil owl face!  how you taunt me!
  ,"a/!(symlink)/**"
  ,"a/symlink/a/**/*"
  ]
var bashOutput = {}
var fs = require("fs")

globs.forEach(function (pattern) {
  tap.test("generate fixture " + pattern, function (t) {
    var opts = [
      "-O", "globstar",
      "-O", "extglob",
      "-O", "nullglob",
      "-c",
      // rootDrive injection: fix issue where / is translated to C: drive system path when running bash in windows / MSYS2. 
      // 
      // Also make sure the path is printed as-is by quoting it. We've encountered some weird behaviour on the windows/MSYS
      // box where entries were sometimes NOT separated by a newline when the `echo` command wasn't carrying quotes...
      "for i in " + pattern.replace(/(\{|,)(\/)/g, '$1' + rootDrive + '$2') + "; do echo \"$i\"; done"
    ]
    var cp = spawn("bash", opts, { cwd: fixtureDir })
    var out = []
    cp.stdout.on("data", function (c) {
      out.push(c)
    })
    cp.stderr.pipe(process.stderr)
    cp.on("close", function (code) {
      out = flatten(out)
      console.log('bash --> ', { pattern, out})
      if (!out)
        out = []
      else {
        // and strip off the rootDrive again in windows:
        if (rootDrive) {
          let re = new RegExp(`^${rootDrive}[\\/]`, 'gm');
          out = out.replace(re, '/');
        }
        // also split on space: apparently bash does NOT print a newline between every entry when expanding {./*/*,/tmp/glob-test/*}:
        out = cleanResults(out.split(/\r*\n/))
      }

      bashOutput[pattern] = out
      t.notOk(code, "bash test should finish nicely")
      t.end()
    })
  })
})

tap.test("save fixtures", function (t) {
  var fname = path.resolve(__dirname, "bash-results.json")
  var data = JSON.stringify(bashOutput, null, 2) + "\n"
  fs.writeFile(fname, data, function (er) {
    t.ifError(er)
    t.end()
  })
})

function cleanResults (m) {
  // normalize discrepancies in ordering, duplication,
  // and ending slashes.
  return m.map(function (m) {
    return m.replace(/\/+/g, "/").replace(/\/$/, "")
  }).sort(alphasort).reduce(function (set, f) {
    if (f !== set[set.length - 1]) set.push(f)
    return set
  }, []).sort(alphasort).map(function (f) {
    // de-windows
    return (process.platform !== 'win32') ? f
           : f.replace(/^[a-zA-Z]:\\\\/, '/').replace(/\\/g, '/')
  })
}

function flatten (chunks) {
  var s = 0
  chunks.forEach(function (c) { s += c.length })
  var out = new Buffer(s)
  s = 0
  chunks.forEach(function (c) {
    c.copy(out, s)
    s += c.length
  })

  return out.toString().trim()
}

function alphasort (a, b) {
  a = a.toLowerCase()
  b = b.toLowerCase()
  return a > b ? 1 : a < b ? -1 : 0
}
