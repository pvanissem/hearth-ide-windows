// Dev probe: which parent folders can a sandboxed Node process lstat? (Run through hearth-sandbox.)
const fs = require('node:fs');
const path = require('node:path');
const start = path.resolve(process.argv[2] || process.cwd());
for (let p = start; ; p = path.dirname(p)) {
  try { fs.lstatSync(p); console.log('ok  ', p); } catch (e) { console.log('FAIL', p, e.code); }
  if (path.dirname(p) === p) break;
}
