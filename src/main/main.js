'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pty = require('node-pty');
const { AGENTS } = require('./agents');
const sandbox = require('./sandbox');
const settings = require('./settings');
const git = require('./git');
const { StatusTracker } = require('./status');
const { execFile, execFileSync } = require('node:child_process');

/** @type {Map<string, {id:string, kind:string, directory:string, sandboxed:boolean, term:any, status:StatusTracker, started:number, title:string}>} */
const sessions = new Map();
/** Folders the user chose (dialog) or started a session in: the only places the renderer may read/write. */
const workspaces = new Set();
let win = null;

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

function insideWorkspace(p) {
  const abs = path.resolve(String(p || ''));
  return [...workspaces].some((root) => {
    const rel = path.relative(root, abs);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}
function requireWorkspace(p) {
  if (!insideWorkspace(p)) throw new Error('Path is outside the opened workspaces');
  return path.resolve(p);
}

function publicSession(s) {
  return { id: s.id, kind: s.kind, name: AGENTS[s.kind].name, directory: s.directory, sandboxed: s.sandboxed, status: s.status.state, started: s.started, title: s.title };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 900, minHeight: 600, backgroundColor: '#1e1f22', title: 'Hearth IDE',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ---- sandbox / settings ----
ipcMain.handle('env:detect', (_e, force) => sandbox.detect(Boolean(force), settings.load().backend));
ipcMain.handle('settings:get', () => settings.load());
ipcMain.handle('settings:set', (_e, next) => settings.save(next));
ipcMain.handle('agents:list', () => Object.entries(AGENTS).map(([id, a]) => ({ id, name: a.name, install: a.install, login: Boolean(a.login) })));

ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  workspaces.add(path.resolve(r.filePaths[0]));
  return r.filePaths[0];
});

// ---- sessions ----
ipcMain.handle('session:start', async (_e, { kind, directory, login = false, resumeID }) => {
  if (!AGENTS[kind]) throw new Error('Unknown agent');
  const dir = requireWorkspace(directory);
  const cfg = settings.load();
  const id = 'run_' + crypto.randomBytes(5).toString('hex');
  const launch = await sandbox.prepare({
    purpose: 'agent', kind, runID: id, directory: dir, settings: cfg, resumeID,
    mode: cfg.allowUnsandboxed && !(await sandbox.detect(false, cfg.backend)).backend ? 'none' : 'sandbox',
    extraArgs: login && AGENTS[kind].login ? AGENTS[kind].login : [],
  });
  const term = pty.spawn(launch.file, launch.args, { name: 'xterm-256color', cols: 120, rows: 32, cwd: launch.cwd, env: launch.env, useConpty: true });
  const status = new StatusTracker((state) => send('session:status', { id, status: state }));
  const s = { id, kind, directory: dir, sandboxed: launch.sandboxed, backend: launch.backend, revoke: launch.revoke, helper: launch.helper, term, status, started: Date.now(), title: path.basename(dir) };
  sessions.set(id, s);
  term.onData((d) => { status.data(d); send('session:data', { id, data: d }); });
  term.onExit(({ exitCode }) => { status.exit(exitCode); send('session:exit', { id, code: exitCode }); });
  return publicSession(s);
});
ipcMain.on('session:input', (_e, { id, data }) => { sessions.get(id)?.term.write(String(data)); });
ipcMain.on('session:resize', (_e, { id, cols, rows }) => {
  const s = sessions.get(id);
  if (s && cols > 0 && rows > 0) { try { s.term.resize(Math.floor(cols), Math.floor(rows)); } catch { /* exited */ } }
});
ipcMain.handle('session:stop', (_e, id) => { const s = sessions.get(id); if (s) { try { s.term.kill(); } catch { /* exited */ } } });
ipcMain.handle('session:remove', (_e, id) => { const s = sessions.get(id); if (s) { try { s.term.kill(); } catch { /* */ } sessions.delete(id); revokeGrants(s); } });
ipcMain.handle('session:list', () => [...sessions.values()].map(publicSession));

// ---- files (workspace only) ----
const SKIP = new Set(['.git', 'node_modules', '.gradle', 'target', 'dist', 'build', '.idea']);
ipcMain.handle('fs:list', async (_e, dir) => {
  const abs = requireWorkspace(dir);
  const entries = await fs.promises.readdir(abs, { withFileTypes: true });
  return entries.filter((d) => !SKIP.has(d.name)).map((d) => ({ name: d.name, path: path.join(abs, d.name), dir: d.isDirectory() }))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
});
ipcMain.handle('fs:read', async (_e, file) => {
  const abs = requireWorkspace(file);
  const st = await fs.promises.stat(abs);
  if (st.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB');
  const buf = await fs.promises.readFile(abs);
  if (buf.includes(0)) throw new Error('Binary file');
  return buf.toString('utf8');
});
ipcMain.handle('fs:write', async (_e, { file, content }) => {
  const abs = requireWorkspace(file);
  // The agent sandbox protects .git/hooks; the host editor must not become the way around it.
  const parts = abs.split(path.sep).map((p) => p.toLowerCase());
  if (parts.some((p, i) => p === '.git' && parts[i + 1] === 'hooks')) throw new Error('.git/hooks is write-protected');
  await fs.promises.writeFile(abs, String(content), 'utf8');
});

// ---- git (workspace only) ----
const gitOp = (fn) => async (_e, dir, ...rest) => fn(requireWorkspace(dir), ...rest);
ipcMain.handle('git:isRepo', gitOp((d) => git.isRepo(d)));
ipcMain.handle('git:status', gitOp((d) => git.status(d)));
ipcMain.handle('git:diff', gitOp((d, f, staged) => git.diff(d, f, staged)));
ipcMain.handle('git:stage', gitOp((d, files) => git.stage(d, files)));
ipcMain.handle('git:unstage', gitOp((d, files) => git.unstage(d, files)));
ipcMain.handle('git:commit', gitOp((d, msg) => git.commit(d, msg)));
ipcMain.handle('git:log', gitOp((d) => git.log(d)));

// Smoke mode (tests): run a script in the renderer, print its JSON result, save a screenshot, quit.
async function smoke() {
  const dir = process.env.HEARTH_SMOKE_DIR;
  if (dir) workspaces.add(path.resolve(dir));
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  let out;
  try { out = await win.webContents.executeJavaScript(fs.readFileSync(process.env.HEARTH_SMOKE, 'utf8')); } catch (e) { out = { error: String(e) }; }
  if (process.env.HEARTH_SHOT) fs.writeFileSync(process.env.HEARTH_SHOT, (await win.webContents.capturePage()).toPNG());
  console.log('SMOKE_RESULT ' + JSON.stringify(out));
  cleanupAll();
  app.exit(0);
}

app.whenReady().then(() => { createWindow(); if (process.env.HEARTH_SMOKE) smoke(); });
// Leave no AppContainer grants behind, also when the app is closed or killed by a smoke test.
let cleaned = false;
function cleanupAll() {
  if (cleaned) return;
  cleaned = true;
  const done = new Set();
  for (const s of sessions.values()) {
    try { s.term.kill(); } catch { /* exited */ }
    if (s.revoke && s.helper && !done.has(s.directory)) { done.add(s.directory); try { execFileSync(s.helper, s.revoke, { windowsHide: true, timeout: 20000 }); } catch { /* best effort */ } }
  }
}
app.on('before-quit', cleanupAll);
app.on('window-all-closed', () => { cleanupAll(); app.quit(); });

/** Remove the AppContainer grants of a finished session, unless another session still uses the same project. */
function revokeGrants(s) {
  if (!s.revoke || !s.helper) return;
  if ([...sessions.values()].some((o) => o.directory === s.directory && o.revoke)) return;
  execFile(s.helper, s.revoke, { windowsHide: true }, () => { /* best effort */ });
}
