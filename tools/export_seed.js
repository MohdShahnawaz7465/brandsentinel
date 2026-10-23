// Exports the demo brand data to JSON so the Python backend and the JS page share one source of truth.
const fs = require('fs'), D = require('../src/data.js');
fs.writeFileSync(__dirname + '/../backend/app/seed.json', JSON.stringify({ sources: D.sources, users: D.users, roleNames: D.roleNames, samples: D.samples, evalSet: D.evalSet }, null, 1));
console.log('seed.json written');
