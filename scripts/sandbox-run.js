'use strict';
// Dev tool: run an agent CLI in the native sandbox without the UI (pipes instead of a PTY).
//   node scripts/sandbox-run.js <agent> <project-folder> [agent arguments...]
const { spawnSync } = require('node:child_process');
const sandbox = require('../src/main/sandbox');
const settings = require('../src/main/settings');

(async () => {
  const [kind, directory, ...extraArgs] = process.argv.slice(2);
  if (!kind || !directory) { console.error('usage: node scripts/sandbox-run.js <agent> <folder> [args...]'); process.exit(2); }
  const launch = await sandbox.prepare({ kind, runID: 'cli-' + Date.now(), directory, settings: settings.load(), extraArgs });
  const r = spawnSync(launch.file, [...launch.args, '--pipes'], { stdio: 'inherit', cwd: directory, env: launch.env });
  if (launch.revoke) spawnSync(launch.helper, launch.revoke, { windowsHide: true });
  process.exit(r.status ?? 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
