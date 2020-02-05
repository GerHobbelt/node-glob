const { Glob } = require('./glob');

async function globAsync (pattern, options) {
  return new Promise((resolve, reject) => {
    new Glob(pattern, options, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

module.exports = globAsync;
