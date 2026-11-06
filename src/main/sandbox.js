'use strict';
// Decides HOW a command runs:
//   native      : Windows AppContainer via hearth-sandbox.exe (default, nothing to install)
//   wsl         : nono inside WSL2 (optional, Settings > backend)
//   none        : directly on Windows, NOT sandboxed (explicit opt-in, shown in the UI)
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AGENTS } = require('./agents');
const { makePolicy, toProfile } = require('./policy');
const { toWslPath, shQuote } = require('./paths');
const native = require('./native');

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

/**
 * What the machine can do.
 *  native: Windows AppContainer helper present (no install, no admin)  -> preferred
 *  wsl/nono: nono inside WSL2 (optional alternative)
 */
async function detect(force = false, backend = 'auto') {
  if (cached && !force) return cached;
  const info = { native: false, helper: null, wsl: false, distro: null, nono: false, home: null, backend: null, reason: '' };
  info.helper = process.platform === 'win32' ? native.helperPath() : null;
  info.native = Boolean(info.helper);
  if (info.native && backend !== 'wsl') {
    info.backend = 'native';
    return (cached = info);
  }
  const list = await run('wsl.exe', ['-l', '-q']);
  const distros = list.ok ? list.out.replace(/\0/g, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  if (!distros.length) {
    info.reason = info.native ? 'WSL2 is not installed.' : 'hearth-sandbox.exe is missing (run "npm run build:native") and WSL2 is not installed.';
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
  if (info.nono) info.backend = 'wsl';
  else info.reason = `nono is not installed in WSL (${info.distro}). See https://github.com/nolabs-ai/nono/releases`;
  return (cached = info);
}

const hearthHome = () => process.env.HEARTH_HOME || os.homedir();

function runDirectory(runID) {
  const dir = path.join(hearthHome(), '.hearth', 'runs', runID);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sandboxError(message) {
  const e = new Error(message);
  e.code = 'SANDBOX_UNAVAILABLE';
  return e;
}

/**
 * Build the process to spawn.
 * mode 'none' = explicitly unsandboxed. Otherwise the native AppContainer helper is used,
 * or nono in WSL2 when the user chose that backend.
 */
async function prepare({ purpose = 'agent', kind = 'shell', runID, directory, extraArgs = [], settings = {}, mode, gitHosts = [], resumeID, command, extraEnv = {}, secretEnv = {}, journal = false, cwd }) {
  const spec = AGENTS[kind] || AGENTS.shell;
  const det = await detect(false, settings.backend);
  const agentArgs = [...(spec.args || []), ...(purpose === 'agent' ? spec.resume(resumeID) : []), ...extraArgs];

  if (mode === 'none') {
    const win = process.platform === 'win32';
    return {
      file: kind === 'shell' ? (win ? 'powershell.exe' : 'bash') : spec.executable + (win ? '.cmd' : ''),
      args: kind === 'shell' ? (win ? ['-NoLogo'] : agentArgs) : agentArgs,
      cwd: directory, sandboxed: false, backend: 'none', env: { ...process.env, ...(spec.env || {}) },
    };
  }
  if (!det.backend) throw sandboxError(det.reason || 'Sandbox unavailable');

  if (det.backend === 'native') {
    const home = native.privateHome(hearthHome(), kind);
    for (const sub of ['', 'Temp', 'npm-cache', path.join('AppData', 'Roaming'), path.join('AppData', 'Local')]) fs.mkdirSync(path.join(home, sub), { recursive: true });
    let executable;
    let args = agentArgs;
    if (kind === 'shell') {
      // cmd.exe: PowerShell cannot initialise its FileSystem provider inside an AppContainer.
      executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'cmd.exe');
      args = ['/d'];
    } else {
      executable = native.resolveExecutable(spec.executable);
      if (!executable) throw sandboxError(`${spec.name} is not installed on this PC. Install it with: ${spec.install}`);
    }
    const runDir = runDirectory(runID);
    const env = { ...extraEnv };
    let rawCommandLine;
    if (command) {   // Build & Deployment, tests: one shell command line
      executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'cmd.exe');
      rawCommandLine = `"${executable}" /d /s /c "${command}"`;
    }
    if (journal) {   // hearth-journal on PATH, written to the run folder (the only Hearth folder the sandbox may write)
      const bin = require('./journal').install(runDir, det.helper);
      env.HEARTH_JOURNAL = path.join(runDir, require('./journal').FILE_NAME);
      env.PATH = `${bin}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;
    }
    const helperArgs = native.buildArgs({
      directory, cwd, runDir, home, kind, settings, executable, args, rawCommandLine, env,
      network: settings.network === 'none' && purpose === 'agent' ? 'none' : 'internet', runtime: native.runtimeFolders(),
    });
    return {
      file: det.helper, args: helperArgs, cwd: cwd || directory, sandboxed: true, backend: 'native',
      env: { ...process.env, ...(purpose === 'agent' ? secretEnv : {}) }, revoke: native.revokeArgs(helperArgs), helper: det.helper,
    };
  }

  const runDir = runDirectory(runID);
  const policy = makePolicy(purpose, {
    kind, wslHome: det.home || '/root', workdir: toWslPath(directory), runDir: toWslPath(runDir), settings, gitHosts,
  });
  const profilePath = path.join(runDir, 'profile.json');
  fs.writeFileSync(profilePath, JSON.stringify(toProfile(policy), null, 2));
  const inner = command ? ['bash', '-lc', command].map(shQuote).join(' ') : [spec.executable, ...agentArgs].map(shQuote).join(' ');
  const script = `cd ${shQuote(toWslPath(directory))} && exec nono run --profile ${shQuote(toWslPath(profilePath))} -- ${inner}`;
  return {
    file: 'wsl.exe', args: ['-d', det.distro, '-e', 'bash', '-lc', script],
    cwd: directory, sandboxed: true, backend: 'wsl', env: { ...process.env },
  };
}

module.exports = { detect, prepare, runDirectory };
