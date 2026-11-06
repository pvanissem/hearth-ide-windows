'use strict';
// Native Windows sandbox: hearth-sandbox.exe runs the agent in an AppContainer.
// No WSL, no admin rights. This module turns a launch request into helper arguments.
// Pure functions where possible so the rules are unit-testable.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AGENTS } = require('./agents');

/** Container name per project folder: one project cannot see another's grants. */
function containerName(directory) {
  const norm = path.resolve(directory).toLowerCase();
  return 'p' + crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

/** Quote one argument for a Windows command line (CommandLineToArgvW rules). */
function quoteArg(a) {
  a = String(a);
  if (a !== '' && !/[\s"]/.test(a)) return a;
  let out = '"'; let backslashes = 0;
  for (const ch of a) {
    if (ch === '\\') { backslashes++; continue; }
    if (ch === '"') { out += '\\'.repeat(backslashes * 2 + 1) + '"'; backslashes = 0; continue; }
    out += '\\'.repeat(backslashes) + ch; backslashes = 0;
  }
  return out + '\\'.repeat(backslashes * 2) + '"';
}

/** Find an executable on PATH (host side). Returns the full path or null. */
function resolveExecutable(name, env = process.env) {
  const exts = (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const candidates = path.extname(name) ? [''] : exts;
  for (const dir of dirs) {
    for (const ext of candidates) {
      const file = path.join(dir, name + ext);
      try { if (fs.statSync(file).isFile()) return file; } catch { /* next */ }
    }
  }
  return null;
}

/** Command line for the sandboxed process. Scripts need cmd.exe. */
function commandLine(executable, args) {
  const isScript = /\.(cmd|bat)$/i.test(executable);
  const parts = isScript ? ['cmd.exe', '/d', '/s', '/c', `"${[quoteArg(executable), ...args.map(quoteArg)].join(' ')}"`] : [quoteArg(executable), ...args.map(quoteArg)];
  return parts.join(' ');
}

/** Folders under the user's profile that contain tools on PATH: read-only for the sandbox. */
function runtimeFolders(env = process.env, home = os.homedir(), exists = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }) {
  const profile = path.resolve(home).toLowerCase();
  const out = [];
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    const abs = path.resolve(dir);
    const low = abs.toLowerCase();
    if (!low.startsWith(profile + path.sep)) continue;      // system folders are already readable
    if (low === profile) continue;                          // never the whole profile
    if (/[\\/](\.ssh|\.gnupg|\.aws|\.azure|\.kube)([\\/]|$)/.test(low)) continue;
    if (exists(abs) && !out.includes(abs)) out.push(abs);
  }
  return out;
}

/** The sandbox's private home: logins and config of one agent kind live here (not in the real profile). */
function privateHome(hearthHome, kind) { return path.join(hearthHome, '.hearth', 'agents', kind, 'home'); }

function privateEnvironment(home, extra = {}) {
  return {
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    TEMP: path.join(home, 'Temp'), TMP: path.join(home, 'Temp'), npm_config_cache: path.join(home, 'npm-cache'),
    npm_config_update_notifier: 'false',
    // An AppContainer cannot lstat the parent folders of the project (C:\ and friends). Node resolves
    // modules with realpath, which stats every parent: switch that off inside the sandbox.
    NODE_PRESERVE_SYMLINKS: '1', NODE_PRESERVE_SYMLINKS_MAIN: '1',
    ...extra,
  };
}

/**
 * Helper arguments (without the executable).
 * @param {{directory:string, runDir:string, home:string, kind:string, settings:object, executable:string, args:string[], network:'none'|'internet', env?:object, runtime?:string[]}} r
 */
function buildArgs(r) {
  const a = ['--name', containerName(r.directory), '--net', r.network, '--cwd', r.cwd || r.directory];
  const rw = [r.directory, r.home, r.runDir];
  const ro = [...(r.runtime || [])];
  for (const f of r.settings.folders || []) (f.write ? rw : ro).push(f.path);
  for (const p of [...new Set(rw)]) a.push('--rw', p);
  for (const p of [...new Set(ro)]) a.push('--ro', p);
  a.push('--deny-write', path.join(r.directory, '.git', 'hooks'));
  const env = { ...privateEnvironment(r.home), ...(AGENTS[r.kind]?.env || {}), ...(r.env || {}) };
  for (const [k, v] of Object.entries(env)) a.push('--env', `${k}=${v}`);
  a.push('--cmd64', Buffer.from(r.rawCommandLine || commandLine(r.executable, r.args), 'utf8').toString('base64'));
  return a;
}

/** Arguments that remove every grant of a launch again (shared by the same project container). */
function revokeArgs(helperArgs) {
  const keep = new Set(['--name', '--rw', '--ro', '--deny-write']);
  const out = [];
  for (let i = 0; i < helperArgs.length; i += 2) if (keep.has(helperArgs[i])) out.push(helperArgs[i], helperArgs[i + 1]);
  return [...out, '--revoke'];
}

const helperPath = () => {
  const dev = path.join(__dirname, '..', '..', 'native', 'bin', 'hearth-sandbox.exe');
  const packed = path.join(process.resourcesPath || '', 'native', 'hearth-sandbox.exe');
  return [packed, dev].find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
};

module.exports = { containerName, quoteArg, resolveExecutable, commandLine, runtimeFolders, privateHome, privateEnvironment, buildArgs, revokeArgs, helperPath };
