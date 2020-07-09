var test = require("tap").test
var glob = require('../')
var path = require("path")

var dir = __dirname.split('\\').join('/') + '/edge/'

var debugEC = false; 

test("should handle pattern starting with paren", function(t) {
  var g = new glob.Glob(dir + "(case)")
  g.on("end", function(r) {
    t.equal(r.length, 1)
    t.equal(path.basename(r[0]), "(case)")
    t.end()
  })
})

test("should handle pattern starting with at+paren", function(t) {
  var g = new glob.Glob(dir + "@(case)")
  g.on("end", function(r) {
    t.equal(r.length, 1)
    t.equal(path.basename(r[0]), "case")
    t.end()
  })
})

test("should handle pattern starting with exclam", function(t) {
  var g = new glob.Glob(dir + "\\!case")
  g.on("end", function(r) {
    t.equal(r.length, 1)
    t.equal(path.basename(r[0]), "!case")
    t.end()
  })
})

test("should handle pattern starting with exclam and paren", function(t) {
  var g = new glob.Glob(dir + "\\!(case)", { debug: debugEC })
  g.on("end", function(r) {
    g.debug("found these files:", {r})
    t.equal(r.length, 1)
    t.equal(path.basename(r[0]), "!(case)")
    t.end()
  })
})

test("should handle pattern that is a negative extglob", function(t) {
  var g = new glob.Glob(dir + "!(case)")
  g.on("end", function(r) {
    t.equal(r.length, 3)
    r = r.sort()
    t.equal(path.basename(r[0]), "!(case)")
    t.equal(path.basename(r[1]), "!case")
    t.equal(path.basename(r[2]), "(case)")
    t.end()
  })
})

test("should ignore pattern starting with paren", function(t) {
  var g = new glob.Glob(dir + "*", {ignore: [dir + "(case)"], debug: debugEC })
  g.on("end", function(r) {
    g.debug("found these files:", {r})
    // TODO: WRONG ANSWER! Glob nukes the escapes in the ignore paths via windows transforms \\ --> / 
    t.equal(r.length, 4)
    t.equal(path.basename(r[0]), "!(case)")
    t.equal(path.basename(r[1]), "!case")
    t.equal(path.basename(r[2]), "(case)")
    t.equal(path.basename(r[3]), "case")
    t.end()
  })
})

test("should ignore pattern starting with star & paren", function(t) {
  var g = new glob.Glob(dir + "*", {ignore: [dir + "*(case)"], debug: debugEC })
  g.on("end", function(r) {
    g.debug("found these files:", {r})
    // TODO: WRONG ANSWER! Glob nukes the escapes in the ignore paths via windows transforms \\ --> / 
    t.equal(r.length, 4)
    t.equal(path.basename(r[0]), "!(case)")
    t.equal(path.basename(r[1]), "!case")
    t.equal(path.basename(r[2]), "(case)")
    t.equal(path.basename(r[3]), "case")
    t.end()
  })
})

test("should ignore pattern starting with exclam", function(t) {
  var g = new glob.Glob(dir + "*", {ignore: [dir + "\\!case"], debug: debugEC })
  g.on("end", function(r) {
    g.debug("found these files:", {r})
    // TODO: WRONG ANSWER! Glob nukes the escapes in the ignore paths via windows transforms \\ --> / 
    t.equal(r.length, 4)
    t.equal(path.basename(r[0]), "!(case)")
    t.equal(path.basename(r[1]), "!case")
    t.equal(path.basename(r[2]), "(case)")
    t.equal(path.basename(r[3]), "case")
    t.end()
  })
})

test("should ignore pattern starting with exclam and paren", function(t) {
  var g = new glob.Glob(dir + "*", {ignore: [dir + "\\!(case)"], debug: debugEC })
  g.on("end", function(r) {
    // TODO: WRONG ANSWER! Glob nukes the escapes in the ignore paths via windows transforms \\ --> / 
    t.equal(r.length, 4)
    t.equal(path.basename(r[0]), "!(case)")
    t.equal(path.basename(r[1]), "!case")
    t.equal(path.basename(r[2]), "(case)")
    t.equal(path.basename(r[3]), "case")
    t.end()
  })
})

test("should ignore pattern that is a double-negative extglob A", function(t) {
  var g = new glob.Glob(dir + "*", {ignore: [dir + "!\\(case\\)"], debug: false })
  g.on("end", function(r) {
    g.debug("found these files:", {r})
    // TODO: WRONG ANSWER! Glob nukes the escapes in the ignore paths via windows transforms \\ --> / 
    t.equal(r.length, 4)
    t.equal(path.basename(r[0]), "!(case)")
    t.equal(path.basename(r[1]), "!case")
    t.equal(path.basename(r[2]), "(case)")
    t.equal(path.basename(r[3]), "case")
    t.end()
  })
})

test("should ignore pattern that is a double-negative extglob B", function(t) {
  var g = new glob.Glob(dir + "*", {ignore: [dir + "!(case)"], debug: false })
  g.on("end", function(r) {
    g.debug("found these files:", {r})
    t.equal(r.length, 4)
    t.equal(path.basename(r[0]), "!(case)")
    t.equal(path.basename(r[1]), "!case")
    t.equal(path.basename(r[2]), "(case)")
    t.equal(path.basename(r[3]), "case")
    t.end()
  })
})