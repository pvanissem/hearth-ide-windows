'use strict';
// Dev tool: run an agent CLI or a shell command in the native sandbox without the UI (pipes instead of a PTY).
//   node scripts/sandbox-run.js <agent> <project-folder> [agent arguments...]
//   node scripts/sandbox-run.js --cmd <project-folder> "<command line>"      (like a Build & Deployment task)
const { spawnSync } = require('node:child_process');
const sandbox = require('../src/main/sandbox');
const settings = require('../src/main/settings');

(async () => {
  const argv = process.argv.slice(2);
  const asCommand = argv[0] === '--cmd';
  if (asCommand) argv.shift();
  const [kindOrDir, directoryOrCmd, ...rest] = argv;
  if (!kindOrDir || !directoryOrCmd) { console.error('usage: node scripts/sandbox-run.js <agent> <folder> [args...] | --cmd <folder> "<command>"'); process.exit(2); }
  const common = { runID: 'cli-' + Date.now(), settings: settings.load() };
  const launch = asCommand
    ? await sandbox.prepare({ ...common, purpose: 'build', kind: 'shell', directory: kindOrDir, command: directoryOrCmd })
    : await sandbox.prepare({ ...common, kind: kindOrDir, directory: directoryOrCmd, extraArgs: rest });
  const r = spawnSync(launch.file, [...launch.args, '--pipes'], { stdio: 'inherit', cwd: launch.cwd, env: launch.env });
  if (launch.revoke) spawnSync(launch.helper, launch.revoke, { windowsHide: true });
  process.exit(r.status ?? 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
