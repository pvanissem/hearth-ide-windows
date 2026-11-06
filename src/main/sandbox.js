'use strict';
// Decides HOW a command runs:
//   sandboxed   : inside WSL2 under nono (the supported mode)
//   unsandboxed : directly on Windows, NOT sandboxed (explicit opt-in, shown in the UI)
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AGENTS } = require('./agents');
const { makePolicy, toProfile } = require('./policy');
const { toWslPath, shQuote } = require('./paths');

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, encoding: 'buffer', timeout: 15000, ...opts }, (err, out, errOut) => {
      resolve({ ok: !err, out: decode(out), err: decode(errOut) });
    });
  });
}

// wsl.exe prints UTF-16LE for its own messages.
function decode(buf) {
  if (!buf || !buf.length) return '';
  if (buf.length > 1 && buf[1] === 0) return buf.toString('utf16le');
  return buf.toString('utf8');
}

let cached = null;

/** What the machine can do: is WSL2 there, is nono installed in it. */
async function detect(force = false) {
  if (cached && !force) return cached;
  const info = { wsl: false, distro: null, nono: false, home: null, reason: '' };
  const list = await run('wsl.exe', ['-l', '-q']);
  const distros = list.ok ? list.out.replace(/\0/g, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  if (!distros.length) {
    info.reason = 'WSL2 is not installed (run "wsl --install" in an admin terminal).';
    return (cached = info);
  }
  info.wsl = true;
  info.distro = distros[0];
  const probe = await run('wsl.exe', ['-d', info.distro, '-e', 'sh', '-lc', 'echo $HOME; command -v nono || true']);
  if (probe.ok) {
    const [home, nono] = probe.out.split(/\r?\n/).map((s) => s.trim());
    info.home = home || null;
    info.nono = Boolean(nono);
  }
  if (!info.nono) info.reason = `nono is not installed in WSL (${info.distro}). See https://github.com/nolabs-ai/nono/releases`;
  return (cached = info);
}

function runDirectory(runID) {
  const dir = path.join(process.env.HEARTH_HOME || os.homedir(), '.hearth', 'runs', runID);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Build the process to spawn.
 * mode 'none' = explicitly unsandboxed; anything else requires WSL2 + nono.
 */
async function prepare({ purpose = 'agent', kind = 'shell', runID, directory, extraArgs = [], settings = {}, mode, gitHosts = [], resumeID }) {
  const spec = AGENTS[kind] || AGENTS.shell;
  const det = await detect();
  const useSandbox = mode !== 'none' && det.wsl && det.nono;
  if (mode !== 'none' && !useSandbox) {
    const e = new Error(det.reason || 'Sandbox unavailable');
    e.code = 'SANDBOX_UNAVAILABLE';
    throw e;
  }
  const agentArgs = [...(spec.args || []), ...(purpose === 'agent' ? spec.resume(resumeID) : []), ...extraArgs];

  if (!useSandbox) {
    const win = process.platform === 'win32';
    return {
      file: kind === 'shell' ? (win ? 'powershell.exe' : 'bash') : spec.executable + (win ? '.cmd' : ''),
      args: kind === 'shell' ? (win ? ['-NoLogo'] : agentArgs) : agentArgs,
      cwd: directory, sandboxed: false, env: { ...process.env, ...(spec.env || {}) },
    };
  }

  const runDir = runDirectory(runID);
  const policy = makePolicy(purpose, {
    kind, wslHome: det.home || '/root', workdir: toWslPath(directory), runDir: toWslPath(runDir), settings, gitHosts,
  });
  const profilePath = path.join(runDir, 'profile.json');
  fs.writeFileSync(profilePath, JSON.stringify(toProfile(policy), null, 2));
  const inner = [spec.executable, ...agentArgs].map(shQuote).join(' ');
  const script = `cd ${shQuote(toWslPath(directory))} && exec nono run --profile ${shQuote(toWslPath(profilePath))} -- ${inner}`;
  return {
    file: 'wsl.exe', args: ['-d', det.distro, '-e', 'bash', '-lc', script],
    cwd: directory, sandboxed: true, env: { ...process.env },
  };
}

module.exports = { detect, prepare, runDirectory };
