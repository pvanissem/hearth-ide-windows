'use strict';
// Builds native\bin\hearth-sandbox.exe with the C# compiler that ships with Windows (.NET Framework 4, no SDK needed).
// Only when Program.cs changed (or with --force): every compile gets a new file hash, and Smart App Control judges each
// hash on its own - a binary Windows already allowed should not be replaced without need.
// A Node script on purpose: PowerShell script policies (and Smart App Control) may refuse an unsigned .ps1.
//   node scripts/build-native.js [--force]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'native', 'hearth-sandbox', 'Program.cs');
const out = path.join(root, 'native', 'bin');
const exe = path.join(out, 'hearth-sandbox.exe');
const stamp = path.join(out, 'source.sha256');
const hash = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');

if (process.platform !== 'win32') { console.log('hearth-sandbox.exe is only built on Windows'); process.exit(0); }
const force = process.argv.includes('--force');
if (!force && fs.existsSync(exe) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === hash) {
  console.log('hearth-sandbox.exe is up to date');
  process.exit(0);
}
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!fs.existsSync(csc)) { console.error(`csc.exe not found: ${csc}`); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
try {
  execFileSync(csc, ['/nologo', '/optimize+', '/target:exe', '/platform:x64', `/out:${exe}`, src], { stdio: 'inherit' });
} catch { console.error('compile failed'); process.exit(1); }
fs.writeFileSync(stamp, hash + '\n');
console.log(`Built ${exe}`);
