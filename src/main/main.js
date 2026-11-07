'use strict';
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pty = require('node-pty');
const { execFile, execFileSync } = require('node:child_process');
const { AGENTS } = require('./agents');
const sandbox = require('./sandbox');
const settings = require('./settings');
const git = require('./git');
const fileops = require('./fileops');
const { StatusTracker } = require('./status');
const journalLib = require('./journal');
const buildLib = require('./build');
const testsLib = require('./tests');
const searchLib = require('./search');
const archLib = require('./arch');
const ci = require('./ci');
const updates = require('./updates');
const { Credentials } = require('./creds');
const { Leases } = require('./leases');

/** @type {Map<string, any>} */
const sessions = new Map();
/** Folders the user chose (dialog) or started a session in: the only places the renderer may read/write. */
const workspaces = new Set();
const runs = new Map();   // build / test runs
let win = null;

const creds = new Credentials({
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
  available: () => safeStorage.isEncryptionAvailable(),
});

// AppContainer grants are removed when the last sandboxed process of a project is gone.
const leases = new Leases({
  run: (helper, args) => execFile(helper, args, { windowsHide: true }, () => { /* best effort */ }),
  runSync: (helper, args) => execFileSync(helper, args, { windowsHide: true, timeout: 20000 }),
}, { stateFile: path.join(process.env.HEARTH_HOME || require('node:os').homedir(), '.hearth', 'grants.json') });
// An earlier run that was killed or crashed may have left grants behind (they would even stop Electron from starting
// when a project contains the app itself): undo them before anything else.
leases.recover({ sync: true });

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const plainError = (e) => String((e && e.message) || e);

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
  return { id: s.id, kind: s.kind, login: Boolean(s.login), name: AGENTS[s.kind].name, directory: s.directory, sandboxed: s.sandboxed, backend: s.backend, status: s.status.state, started: s.started, title: s.title };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1000, minHeight: 600, backgroundColor: '#0e0a12', title: 'Hearth IDE',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.ico'),
    // Own title bar (the renderer draws it); Windows draws the caption buttons over its right end. Mica shows through the sidebar.
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0e0a12', symbolColor: '#e9dfe6', height: 40 }, backgroundMaterial: 'mica',
    // backgroundThrottling off: agents keep producing output (and statuses, notifications) while the window is behind others.
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ---- sandbox / settings / app ----
ipcMain.handle('env:detect', (_e, force) => sandbox.detect(Boolean(force), settings.load().backend));
ipcMain.handle('settings:get', () => settings.load());
ipcMain.handle('settings:set', (_e, next) => settings.save(next));
ipcMain.handle('agents:list', () => Object.entries(AGENTS).map(([id, a]) => ({ id, name: a.name, install: a.install, login: Boolean(a.login) })));
ipcMain.handle('app:version', () => app.getVersion());
// The renderer tells us its theme colours so the native caption buttons match.
ipcMain.handle('win:theme', (_e, { bg, fg }) => {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!win || !hex.test(bg) || !hex.test(fg)) return;
  try { win.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 40 }); win.setBackgroundColor(bg); } catch { /* not supported */ }
});
// Links from the terminal (a click on the sign-in link of an agent, a dev server's address): https, or http to this PC only.
const OPENABLE = /^(https:\/\/[^\s]+|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/[^\s]*)?)$/;
ipcMain.handle('app:open', (_e, url) => { if (OPENABLE.test(String(url)) && String(url).length < 4096) return shell.openExternal(String(url)); throw new Error('Only https links (and http links to this PC) can be opened'); });
// Clipboard for the terminal (copy a selection, paste); the text only moves between the clipboard and the terminal.
ipcMain.handle('clip:read', async () => String((await clipboard.readText()) || '').slice(0, 1024 * 1024));
ipcMain.handle('clip:write', async (_e, text) => { if (typeof text === 'string') await clipboard.writeText(text.slice(0, 1024 * 1024)); });
ipcMain.handle('app:checkUpdate', async () => updates.check(app.getVersion(), { token: creds.tokenFor('github.com', false) }).catch((e) => ({ error: plainError(e) })));

ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  workspaces.add(path.resolve(r.filePaths[0]));
  return r.filePaths[0];
});

// ---- credentials ----
ipcMain.handle('creds:list', () => ({ tokens: creds.listTokens(), env: creds.listEnv(), available: creds.available }));
ipcMain.handle('creds:saveToken', (_e, { host, writing, token }) => { creds.saveToken(host, Boolean(writing), token); });
ipcMain.handle('creds:deleteToken', (_e, { host, writing }) => { creds.deleteToken(host, Boolean(writing)); });
ipcMain.handle('creds:setEnv', (_e, { name, value }) => { creds.setEnv(name, value); });
ipcMain.handle('creds:deleteEnv', (_e, name) => { creds.deleteEnv(name); });

// ---- sessions ----
async function cloneInto(url, parent) {
  const dir = requireWorkspace(parent);
  if (!/^(https:\/\/|git@|ssh:\/\/)[^\s'"`$&|;<>]+$/.test(url) || url.startsWith('-')) throw new Error('Invalid repository URL');
  const name = (url.split(/[/:]/).pop() || 'repo').replace(/\.git$/, '').replace(/[^\w.-]/g, '_') || 'repo';
  const target = path.join(dir, name);
  if (fs.existsSync(target)) throw new Error(`${target} already exists`);
  await new Promise((resolve, reject) => execFile('git', ['-c', `core.hooksPath=${require('node:os').devNull}`, 'clone', '--', url, target],
    { windowsHide: true, timeout: 600000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, _o, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve())));
  workspaces.add(path.resolve(target));
  return target;
}

ipcMain.handle('session:start', async (_e, { kind, directory, login = false, resumeID, cloneUrl }) => {
  if (!AGENTS[kind]) throw new Error('Unknown agent');
  let dir = requireWorkspace(directory);
  if (cloneUrl) dir = await cloneInto(cloneUrl, dir);
  const cfg = settings.load();
  const id = 'run_' + crypto.randomBytes(5).toString('hex');
  const useJournal = cfg.journal && !login && ['claude', 'codex'].includes(kind);
  const helperJournal = cfg.journal && !login;
  const lease = leases.acquire(dir);
  let launch; let term;
  try {
    launch = await sandbox.prepare({
      purpose: 'agent', kind, runID: id, directory: dir, settings: cfg, resumeID,
      mode: cfg.allowUnsandboxed && !(await sandbox.detect(false, cfg.backend)).backend ? 'none' : 'sandbox',
      extraArgs: [...(login && AGENTS[kind].login ? AGENTS[kind].login : []), ...(useJournal ? journalLib.agentArguments(kind) : [])],
      journal: helperJournal, secretEnv: creds.envValues(),
    });
    leases.attach(lease, launch);
    term = pty.spawn(launch.file, launch.args, { name: 'xterm-256color', cols: 120, rows: 32, cwd: launch.cwd, env: launch.env, useConpty: true });
  } catch (e) { leases.release(lease); throw e; }
  const status = new StatusTracker((state) => send('session:status', { id, status: state }));
  const reader = new journalLib.JournalReader(path.join(sandbox.runDirectory(id), journalLib.FILE_NAME));
  const s = { id, kind, login, directory: dir, sandboxed: launch.sandboxed, backend: launch.backend, lease, term, status, reader, started: Date.now(), title: path.basename(dir) };
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
ipcMain.handle('session:remove', (_e, id) => { const s = sessions.get(id); if (s) { try { s.term.kill(); } catch { /* */ } sessions.delete(id); leases.release(s.lease); } });
ipcMain.handle('session:list', () => [...sessions.values()].map(publicSession));

// ---- Overview (journal) ----
const session = (id) => { const s = sessions.get(id); if (!s) throw new Error('Unknown session'); return s; };
ipcMain.handle('journal:get', (_e, id) => {
  const s = session(id);
  s.reader.poll();
  return { tree: s.reader.journal.toTree(), current: s.reader.journal.currentID, empty: s.reader.journal.isEmpty };
});
ipcMain.handle('journal:revoke', (_e, { id, node, reason, replacedBy }) => {
  const s = session(id);
  if (!journalLib.validID(node)) throw new Error('Invalid id');
  s.reader.poll();
  const prompt = s.reader.journal.revokePrompt(node, reason);
  s.reader.revoke(node, journalLib.clean(reason) || '', replacedBy && journalLib.validID(replacedBy) ? replacedBy : undefined);
  s.reader.poll();
  return prompt;
});
ipcMain.handle('journal:instruction', () => journalLib.INSTRUCTION);

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

ipcMain.handle('fs:copy', (_e, { src, dir }) => fileops.copyInto(requireWorkspace(src), requireWorkspace(dir)));
ipcMain.handle('fs:move', (_e, { src, dir }) => fileops.moveInto(requireWorkspace(src), requireWorkspace(dir)));
ipcMain.handle('fs:rename', (_e, { src, name }) => fileops.rename(requireWorkspace(src), name));
ipcMain.handle('fs:create', (_e, { dir, name, folder }) => fileops.create(requireWorkspace(dir), name, Boolean(folder)));
ipcMain.handle('fs:trash', (_e, src) => { const abs = requireWorkspace(src); if (![...workspaces].some((w) => path.resolve(w) === abs)) return shell.trashItem(abs); throw new Error('A workspace root cannot be deleted'); });
ipcMain.handle('fs:reveal', (_e, src) => shell.showItemInFolder(requireWorkspace(src)));

// ---- git (workspace only) ----
const gitOp = (fn) => async (_e, dir, ...rest) => fn(requireWorkspace(dir), ...rest);
const names = ['isRepo', 'status', 'numstat', 'diff', 'stage', 'unstage', 'commit', 'log', 'branches', 'checkout', 'createBranch', 'fetch', 'pull', 'push', 'stageAll', 'unstageAll',
  'merge', 'mergeAbort', 'mergeInProgress', 'remoteUrl', 'stashList', 'stashSave', 'stashApply', 'stashPop', 'stashDrop'];
for (const n of names) ipcMain.handle('git:' + n, gitOp((d, ...a) => git[n](d, ...a)));

// ---- search ----
const fileCache = new Map();
function filesOf(root) {
  const c = fileCache.get(root);
  if (c && Date.now() - c.at < 15000) return c.files;
  const files = searchLib.listFiles(root);
  fileCache.set(root, { at: Date.now(), files });
  return files;
}
ipcMain.handle('search:files', (_e, dir, q) => { const r = requireWorkspace(dir); return searchLib.searchFiles(r, q, filesOf(r)); });
ipcMain.handle('search:text', (_e, dir, q) => { const r = requireWorkspace(dir); return searchLib.searchText(r, q, { files: filesOf(r) }); });
ipcMain.handle('search:symbols', (_e, dir, q) => { const r = requireWorkspace(dir); return searchLib.searchSymbols(r, q, filesOf(r)); });
ipcMain.handle('search:usages', (_e, dir, word, opts = {}) => {
  const r = requireWorkspace(dir);
  const overrides = {};
  for (const [f, text] of Object.entries(opts.overrides || {})) if (insideWorkspace(f) && typeof text === 'string') overrides[path.resolve(f)] = text;
  return searchLib.findUsages(r, word, { file: opts.file, allLanguages: Boolean(opts.allLanguages), files: filesOf(r), overrides });
});

// ---- architecture ----
ipcMain.handle('arch:scan', (_e, dir) => archLib.scan(requireWorkspace(dir)));

// ---- build & deployment, tests ----
function startTask(root, task, kindOfRun) {
  const dir = requireWorkspace(root);
  if (!insideWorkspace(task.dir)) throw new Error('Task folder is outside the workspace');
  const id = 'b_' + crypto.randomBytes(5).toString('hex');
  const lease = leases.acquire(dir);
  return sandbox.prepare({ purpose: 'build', kind: 'shell', runID: id, directory: dir, cwd: task.dir, settings: settings.load(), command: task.command, mode: 'sandbox' })
    .then((launch) => {
      leases.attach(lease, launch);
      const run = buildLib.start(task, launch, () => { send('run:end', { id, state: run.state, code: run.code }); leases.release(lease); });
      run.id = id; run.root = dir; run.kind = kindOfRun;
      runs.set(id, run);
      return { id, title: task.title };
    }, (e) => { leases.release(lease); throw e; });
}
ipcMain.handle('build:tasks', (_e, dir) => buildLib.scan(requireWorkspace(dir)).map((t) => ({ id: t.id, tool: t.tool, name: t.name, title: t.title, kind: t.kind, port: t.port || null, test: Boolean(t.test), command: t.command })));
ipcMain.handle('build:start', (_e, { dir, taskId }) => {
  const root = requireWorkspace(dir);
  const task = buildLib.scan(root).find((t) => t.id === taskId);
  if (!task) throw new Error('Unknown task');
  return startTask(root, task, 'build');
});
ipcMain.handle('build:output', (_e, { id, from = 0 }) => {
  const run = runs.get(id); if (!run) throw new Error('Unknown run');
  const text = run.text;
  return { text: text.slice(from), next: text.length, state: run.state, code: run.code };
});
ipcMain.handle('build:stop', (_e, id) => { runs.get(id)?.stop(); });
ipcMain.handle('tests:load', (_e, dir) => testsLib.load(requireWorkspace(dir)));
ipcMain.handle('tests:run', (_e, dir) => {
  const root = requireWorkspace(dir);
  const task = buildLib.scan(root).find((t) => t.test);
  if (!task) throw new Error('No test task found (npm test, Maven, Gradle, Go, Cargo, Make or .hearth/tasks.json).');
  return startTask(root, task, 'test');
});

// ---- CI/CD ----
async function ciClient(dir) {
  const root = requireWorkspace(dir);
  const remote = ci.parseRemote(await git.remoteUrl(root));
  if (!remote) throw new Error('No GitHub or GitLab remote found in this repository.');
  return new ci.Client(remote, { token: creds.getToken(remote.host, false), writeToken: creds.getToken(remote.host, true) });
}
ipcMain.handle('ci:info', async (_e, dir) => {
  const remote = ci.parseRemote(await git.remoteUrl(requireWorkspace(dir)));
  return remote ? { ...remote, hasToken: Boolean(creds.tokenFor(remote.host, false)), hasWriteToken: Boolean(creds.getToken(remote.host, true)) } : null;
});
ipcMain.handle('ci:pipelines', async (_e, dir, ref) => (await ciClient(dir)).pipelines(ref));
ipcMain.handle('ci:jobs', async (_e, dir, id) => (await ciClient(dir)).jobs(id));
ipcMain.handle('ci:log', async (_e, dir, id) => (await ciClient(dir)).log(id));
ipcMain.handle('ci:retry', async (_e, dir, id) => (await ciClient(dir)).retry(id));
ipcMain.handle('ci:cancel', async (_e, dir, id) => (await ciClient(dir)).cancel(id));
ipcMain.handle('ci:retryJob', async (_e, dir, id) => (await ciClient(dir)).retryJob(id));
ipcMain.handle('ci:playJob', async (_e, dir, id) => (await ciClient(dir)).playJob(id));
ipcMain.handle('ci:workflows', async (_e, dir) => (await ciClient(dir)).workflows());
ipcMain.handle('ci:run', async (_e, dir, ref, workflow) => (await ciClient(dir)).run(ref, workflow));
ipcMain.handle('ci:changeRequest', async (_e, dir, req) => (await ciClient(dir)).createChangeRequest(req));

// Smoke mode (tests): run a script in the renderer, print its JSON result, save a screenshot, quit.
async function smoke() {
  ipcMain.handle('smoke:shot', async (_e, name) => {
    const dir = path.dirname(process.env.HEARTH_SHOT);
    const file = path.join(dir, `${String(name).replace(/[^\w-]/g, '_')}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    return file;
  });
  for (const dir of (process.env.HEARTH_SMOKE_DIR || '').split(path.delimiter).filter(Boolean)) workspaces.add(path.resolve(dir));
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  let out;
  try { out = await win.webContents.executeJavaScript(fs.readFileSync(process.env.HEARTH_SMOKE, 'utf8')); } catch (e) { out = { error: String(e) }; }
  if (process.env.HEARTH_SHOT) fs.writeFileSync(process.env.HEARTH_SHOT, (await win.webContents.capturePage()).toPNG());
  console.log('SMOKE_RESULT ' + JSON.stringify(out));
  cleanupAll();
  app.exit(0);
}

app.setAppUserModelId('io.github.pvanissem.hearth-windows');
app.whenReady().then(() => { createWindow(); if (process.env.HEARTH_SMOKE) smoke(); });

// Leave no AppContainer grants behind, also when the app is closed or killed by a smoke test.
let cleaned = false;
function cleanupAll() {
  if (cleaned) return;
  cleaned = true;
  for (const r of runs.values()) r.stop();
  for (const s of sessions.values()) { try { s.term.kill(); } catch { /* exited */ } }
  leases.releaseAllSync();
}
app.on('before-quit', cleanupAll);
app.on('window-all-closed', () => { cleanupAll(); app.quit(); });
