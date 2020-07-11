var Glob = require("../").Glob

var pattern = "{./*/*,/*,/usr/local/*}"
console.log(pattern)

var mg = new Glob(pattern, {mark: true, debug: false}, function (er, matches) {
  console.log("matches", matches)
})
console.log("after")
