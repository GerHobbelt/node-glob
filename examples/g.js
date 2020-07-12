var Glob = require("../").Glob

var pattern = "test/fixtures/a/**/[cg]/../[cg]"
console.log(pattern)

try {
	var mg = new Glob(pattern, { mark: true, sync: true, debug: false })
	console.log("matches", { mg, result: mg.found })
} catch (er) {
	console.error("error", er)
}
console.log("############################################################# after sync?")

if (10) {
	var mg2 = new Glob(pattern, {mark: true}, function report(er, entries) {
		console.log("async result", { error: er, result: entries })
	});
	console.log("after Async?")
}