require("./global-leakage.js")

var fs = require('fs')
var path = require('path')

var glob = require('../')
var t = require('tap')

var dir = path.join(__dirname, 'fixtures')

var expect = [
  'a/abcdef',
  'a/abcdef/g',
  'a/abcdef/g/h',
  'a/abcfed',
  'a/abcfed/g',
  'a/abcfed/g/h'
]

var lstat = fs.lstat
var lstatSync = fs.lstatSync
var badPaths = /\ba[\\\/]?$|\babcdef\b/

fs.lstat = function (path, cb) {
  // synthetically generate a non-ENOENT error
  if (badPaths.test(path)) {
    var er = new Error('synthetic')
    er.code = 'EACCES'
    return process.nextTick(cb.bind(null, er))
  }

  return lstat.call(fs, path, cb)
}

fs.lstatSync = function (path) {
  // synthetically generate a non-ENOENT error
  if (badPaths.test(path)) {
    var er = new Error('synthetic')
    er.code = 'EACCES'
    throw er
  }

  return lstatSync.call(fs, path)
}


t.test('stat errors other than ENOENT are ok', function (t) {
  t.plan(2)
  t.test('async', function (t) {
    glob('a/*abc*/**', { stat: true, cwd: dir }, function (er, matches) {
      if (er)
        throw er
      t.same(matches, expect)
      t.end()
    })
  })

  t.test('sync', function (t) {
    var matches = glob.sync('a/*abc*/**', { stat: true, cwd: dir })
    t.same(matches, expect)
    t.end()
  })
})

t.test('globstar with error in root', function (t) {
  var expect = [
    'a',
    'a/abcdef',
    'a/abcdef/g',
    'a/abcdef/g/h',
    'a/abcfed',
    'a/abcfed/g',
    'a/abcfed/g/h',
    'a/b',
    'a/b/c',
    'a/b/c/d',
    'a/bc',
    'a/bc/e',
    'a/bc/e/f',
    'a/c',
    'a/c/d',
    'a/c/d/c',
    'a/c/d/c/b',
    'a/cb',
    'a/cb/e',
    'a/cb/e/f',
    'a/symlink',
    'a/symlink/a',
    'a/symlink/a/b',
    'a/symlink/a/b/c',
    'a/x',
    'a/z'
  ]

  var pattern = 'a/**'
  t.plan(2)
  t.test('async', function (t) {
    glob(pattern, { cwd: dir }, function (er, matches) {
      if (er)
        throw er
      t.same(matches, expect)
      t.end()
    })
  })

  t.test('sync', function (t) {
    var matches = glob.sync(pattern, { cwd: dir })
    t.same(matches, expect)
    t.end()
  })
})
