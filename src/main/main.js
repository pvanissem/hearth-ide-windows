'use strict';
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pty = require('node-pty');
const { execFile, execFileSync } = require('node:child_process');
const agentsLib = require('./agents');
const { AGENTS } = agentsLib;
const sandbox = require('./sandbox');
const settings = require('./settings');
const git = require('./git');
const fileops = require('./fileops');
const { History } = require('./history');
const statusLib = require('./status');
const { StatusTracker } = statusLib;
const journalLib = require('./journal');
const buildLib = require('./build');
const testsLib = require('./tests');
const searchLib = require('./search');
const archLib = require('./arch');
const ci = require('./ci');
const changesLib = require('./changes');
const commitMsg = require('./commitmsg');
const specsLib = require('./specs');
const hooksLib = require('./hooks');
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

const APP_ID = 'io.github.pvanissem.hearth-windows';   // = build.appId: taskbar grouping and the installer's shortcut
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
  return { id: s.id, kind: s.kind, login: Boolean(s.login), name: AGENTS[s.kind].name, directory: s.directory, sandboxed: s.sandboxed, backend: s.backend, status: s.status.state, info: s.status.info,
    started: s.started, title: s.title, options: s.options, sessionID: s.status.sessionID || s.resumeID || null, restartPending: Boolean(s.restartPending) };
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
  // The taskbar button takes its icon from the program that runs (electron.exe while developing) unless the window
  // names its own: the .ico from the source tree, or the app's .exe once packaged (Windows cannot read inside app.asar).
  if (process.platform === 'win32') {
    const appIconPath = app.isPackaged ? process.execPath : path.join(__dirname, '..', 'renderer', 'assets', 'icon.ico');
    try { win.setAppDetails({ appId: APP_ID, appIconPath, appIconIndex: 0, relaunchDisplayName: 'Hearth IDE' }); } catch { /* older Windows */ }
  }
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ---- sandbox / settings / app ----
ipcMain.handle('env:detect', (_e, force) => sandbox.detect(Boolean(force), settings.load().backend));
ipcMain.handle('settings:get', () => settings.load());
ipcMain.handle('settings:set', (_e, next) => settings.save(next));
ipcMain.handle('agents:list', () => Object.entries(AGENTS).map(([id, a]) => ({ id, name: a.name, install: a.install, login: Boolean(a.login), models: a.models || [], efforts: a.efforts || [], commitMessages: commitMsg.SUPPORTED.includes(id) })));
ipcMain.handle('app:version', () => app.getVersion());
// The renderer tells us its theme colours so the native caption buttons match.
ipcMain.handle('win:theme', (_e, { bg, fg }) => {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!win || !hex.test(bg) || !hex.test(fg)) return;
  try { win.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 40 }); win.setBackgroundColor(bg); } catch { /* not supported */ }
});
// Links from the terminal (a click on the sign-in link of an agent, a dev server's address): https, or http to this PC only.
const OPENABLE = /^(https:\/\/[^\s]+|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/[^\s]*)?)$/;
// Electron loses the keyboard focus after a native alert() / confirm(): hand it back
ipcMain.handle('win:refocus', () => { if (win && !win.isDestroyed()) { win.blur(); win.focus(); win.webContents.focus(); } });
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

const history = new History(path.join(process.env.HEARTH_HOME || require('node:os').homedir(), '.hearth', 'sessions.json'));
ipcMain.handle('history:list', () => history.list().filter((x) => AGENTS[x.kind] && fs.existsSync(x.directory)));
ipcMain.handle('history:forget', (_e, { kind, directory }) => history.forget(kind, String(directory)));
/** Resumable conversations of an agent in a folder (the agent told Hearth their ids) and the model choice last used there. */
ipcMain.handle('history:sessions', (_e, { kind, directory }) => (AGENTS[kind]?.resume('x').length ? history.sessions(kind, String(directory)).slice(0, 12) : []));
ipcMain.handle('history:options', (_e, directory) => history.options(String(directory)));

/** Starts (or restarts) the agent process of a session record. */
async function launchSession(s) {
  const cfg = settings.load();
  const { kind, login } = s;
  const useJournal = cfg.journal && !login && ['claude', 'codex'].includes(kind);
  const lease = leases.acquire(s.directory);
  let launch; let term; let hookArgs = [];
  try {
    const mode = cfg.allowUnsandboxed && !(await sandbox.detect(false, cfg.backend)).backend ? 'none' : 'sandbox';
    const runDir = sandbox.runDirectory(s.id);
    const det = await sandbox.detect(false, cfg.backend);
    // status hooks (Claude Code hooks, Codex notify) through the helper copied into the run folder
    hookArgs = !login && mode === 'sandbox' && det.backend === 'native' && det.helper ? agentsLib.statusHookArgs(kind, journalLib.installHelper(runDir, det.helper), runDir) : [];
    const resume = s.resumeID && statusLib.validSessionID(s.resumeID) ? s.resumeID : undefined;
    launch = await sandbox.prepare({
      purpose: 'agent', kind, runID: s.id, directory: s.directory, settings: cfg, resumeID: login ? undefined : resume, mode,
      extraArgs: [...(login && AGENTS[kind].login ? AGENTS[kind].login : []), ...(!resume && s.continueLast && !login && AGENTS[kind].continueLast ? AGENTS[kind].continueLast : []),
        ...(login ? [] : agentsLib.optionArgs(kind, s.options)), ...hookArgs, ...(useJournal ? journalLib.agentArguments(kind) : [])],
      journal: cfg.journal && !login, secretEnv: creds.envValues(),
    });
    leases.attach(lease, launch);
    term = pty.spawn(launch.file, launch.args, { name: 'xterm-256color', cols: s.cols || 120, rows: s.rows || 32, cwd: launch.cwd, env: launch.env, useConpty: true });
  } catch (e) { leases.release(lease); throw e; }
  Object.assign(s, { sandboxed: launch.sandboxed, backend: launch.backend, lease, term });
  s.status.source = hookArgs.length ? (AGENTS[kind].statusSource || 'terminal') : 'terminal';
  s.status.exited = false;
  term.onData((d) => { if (s.term !== term) return; s.status.data(d); send('session:data', { id: s.id, data: d }); });
  term.onExit(({ exitCode }) => {
    if (s.term !== term) return;
    pollEvents(s);
    leases.release(s.lease);
    if (s.restartAfterExit && sessions.has(s.id)) {
      s.restartAfterExit = false; s.restartPending = false;
      s.resumeID = s.status.sessionID || s.resumeID; s.continueLast = !s.resumeID;
      send('session:data', { id: s.id, data: '\r\n\x1b[2m[restarting with the new rules]\x1b[0m\r\n' });
      launchSession(s).then(() => { s.status.set('starting'); send('session:info', publicSession(s)); }, (e) => { s.status.exit(1); send('session:exit', { id: s.id, code: 1, error: plainError(e) }); });
      return;
    }
    s.status.exit(exitCode); send('session:exit', { id: s.id, code: exitCode });
  });
}

ipcMain.handle('session:start', async (_e, { kind, directory, login = false, resumeID, cloneUrl, continueLast = false, options = {} }) => {
  if (!AGENTS[kind]) throw new Error('Unknown agent');
  // Folders the user started sessions in before (Hearth's own history, outside any project) count as chosen.
  const known = history.list().find((x) => path.resolve(x.directory).toLowerCase() === path.resolve(String(directory)).toLowerCase() && fs.existsSync(x.directory));
  if (known) workspaces.add(path.resolve(known.directory));
  let dir = requireWorkspace(directory);
  if (cloneUrl) dir = await cloneInto(cloneUrl, dir);
  // A session id to resume must be one Hearth saw for this agent and folder (never a free-form argument).
  if (resumeID && !history.sessions(kind, dir).some((x) => x.sessionID === resumeID)) throw new Error('Unknown session');
  const id = 'run_' + crypto.randomBytes(5).toString('hex');
  const opts = { model: options.model || null, effort: options.effort || null };
  const s = { id, kind, login, directory: dir, options: opts, resumeID: resumeID || null, continueLast, started: Date.now(), title: path.basename(dir), restartPending: false, restartAfterExit: false };
  s.status = new StatusTracker((info) => { send('session:status', { id, status: info.state, info }); if (s.restartPending && statusLib.restartsNow(info.state)) restartNow(s); });
  s.reader = new journalLib.JournalReader(path.join(sandbox.runDirectory(id), journalLib.FILE_NAME));
  s.events = new journalLib.LineReader(path.join(sandbox.runDirectory(id), 'events.jsonl'));
  if (resumeID) { const h = history.sessions(kind, dir).find((x) => x.sessionID === resumeID); if (h?.title) s.title = h.title; }
  await launchSession(s);
  sessions.set(id, s);
  if (!login) { history.record(kind, dir); history.setOptions(dir, opts); }
  return publicSession(s);
});
ipcMain.on('session:input', (_e, { id, data }) => { const s = sessions.get(id); if (!s) return; s.status.input(data); s.term.write(String(data)); });
ipcMain.on('session:resize', (_e, { id, cols, rows }) => {
  const s = sessions.get(id);
  if (s && cols > 0 && rows > 0) { s.cols = Math.floor(cols); s.rows = Math.floor(rows); try { s.term.resize(s.cols, s.rows); } catch { /* exited */ } }
});
ipcMain.handle('session:stop', (_e, id) => { const s = sessions.get(id); if (s) { s.restartAfterExit = false; try { s.term.kill(); } catch { /* exited */ } } });
ipcMain.handle('session:remove', (_e, id) => { const s = sessions.get(id); if (s) { s.restartAfterExit = false; sessions.delete(id); try { s.term.kill(); } catch { /* */ } leases.release(s.lease); } });
ipcMain.handle('session:list', () => [...sessions.values()].map(publicSession));
ipcMain.handle('session:rename', (_e, { id, title }) => { const s = session(id); s.title = String(title || '').trim().slice(0, 80) || s.title; s.customTitle = true; send('session:info', publicSession(s)); });
/** Types a prompt into the agent's terminal and submits it (Enter after a short pause, like a person would). */
function sendPrompt(id, text) {
  const s = sessions.get(id); if (!s || s.status.exited) throw new Error('The agent is not running');
  const one = String(text).replace(/\r?\n/g, ' ');
  s.term.write(one);
  setTimeout(() => { try { s.term.write('\r'); s.status.input('\r'); } catch { /* exited */ } }, 150);
}
ipcMain.handle('session:prompt', (_e, { id, text }) => sendPrompt(id, text));

// Restart after rule changes: waiting agents now, working ones after their current turn (no work is lost).
function restartNow(s) { s.restartPending = false; s.restartAfterExit = true; try { s.term.kill(); } catch { /* exited */ } }
ipcMain.handle('session:restartAll', () => {
  let now = 0; let later = 0;
  for (const s of sessions.values()) {
    if (s.login || s.status.exited) continue;
    if (statusLib.restartsNow(s.status.state)) { restartNow(s); now++; } else { s.restartPending = true; later++; send('session:info', publicSession(s)); }
  }
  return { now, later };
});

/** Events from Claude hooks / Codex notify. */
function pollEvents(s) {
  if (!s.events) return;
  for (const ev of s.events.poll()) {
    const r = s.status.applyEvent(ev);
    if (r.sessionID || r.title) {
      if (r.title && !s.customTitle && !s.resumeID) s.title = r.title;
      if (s.status.sessionID) history.remember(s.kind, s.directory, s.status.sessionID, s.title);
      send('session:info', publicSession(s));
    }
  }
}
setInterval(() => {
  for (const s of sessions.values()) if (!s.status.exited) pollEvents(s);
  try { hookEngine.tick(); } catch { /* next tick */ }
}, 500);

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

// ---- Git: details for the wide pane, commit message by an agent ----
for (const n of ['showCommit', 'stashShow', 'branchLog', 'untrackedDiff']) ipcMain.handle('git:' + n, gitOp((d, ...a) => git[n](d, ...a)));
ipcMain.handle('git:generateMessage', async (_e, dir, kind) => {
  const root = requireWorkspace(dir);
  if (!commitMsg.SUPPORTED.includes(kind)) throw new Error('This agent cannot write commit messages');
  const st = await git.status(root);
  const inp = await commitMsg.input((args) => git.raw(root, args), st.files);
  if (!inp) throw new Error('There are no changes to describe.');
  const cfg = settings.load();
  const runID = 'msg_' + crypto.randomBytes(5).toString('hex');
  const lease = leases.acquire(root);
  try {
    const launch = await sandbox.prepare({ purpose: 'agent', kind, runID, directory: root, settings: { ...cfg, network: 'internet' }, mode: 'sandbox', extraArgs: commitMsg.args(kind), secretEnv: creds.envValues() });
    leases.attach(lease, launch);
    const r = await commitMsg.runOnce(launch, commitMsg.prompt(inp));
    const message = commitMsg.clean(r.stdout);
    if (r.code !== 0 || !commitMsg.validMessage(message)) {
      const detail = commitMsg.clean((r.code === 0 ? r.stdout : `${r.stderr}\n${r.stdout}`).split(/\r?\n/).filter((l) => l.trim()).slice(-3).join('\n'));
      throw new Error(detail ? `The agent returned no message: ${detail}` : 'The agent returned no message.');
    }
    return message;
  } finally {
    leases.release(lease);
    fs.promises.rm(sandbox.runDirectory(runID), { recursive: true, force: true }).catch(() => {});
  }
});

// ---- merge / pull requests: review ----
async function crClient(dir) { return new changesLib.ChangeRequests(await ciClient(dir)); }
const crOp = (fn, writing = false) => async (_e, dir, ...a) => {
  const c = await crClient(dir);
  try { return await fn(c, ...a); } catch (e) { throw new Error(changesLib.describe(e, c.c.remote.provider, writing)); }
};
ipcMain.handle('cr:list', crOp((c, state) => c.list(state)));
ipcMain.handle('cr:detail', crOp((c, n) => c.detail(n)));
ipcMain.handle('cr:files', crOp((c, n) => c.files(n)));
ipcMain.handle('cr:comments', crOp((c, n) => c.comments(n)));
ipcMain.handle('cr:comment', crOp((c, n, body, anchor, refs) => c.comment(n, body, anchor, refs), true));
ipcMain.handle('cr:reply', crOp((c, n, thread, body) => c.reply(n, thread, body), true));
ipcMain.handle('cr:review', crOp((c, n, verdict, body) => c.review(n, verdict, body), true));
ipcMain.handle('cr:merge', crOp(async (c, n, opts) => c.merge(n, opts, await c.detail(n)), true));

// ---- specs ----
const lang = () => settings.load().language === 'de' ? 'de' : 'en';
ipcMain.handle('specs:scan', (_e, dir) => { const root = requireWorkspace(dir); return { specs: specsLib.scan(root), steering: specsLib.steering(root) }; });
ipcMain.handle('specs:create', (_e, dir, opts) => specsLib.create(requireWorkspace(dir), opts || {}).id);
ipcMain.handle('specs:approve', (_e, dir, id, phase) => specsLib.approve(requireWorkspace(dir), id, phase));
ipcMain.handle('specs:revoke', (_e, dir, id, phase) => specsLib.revoke(requireWorkspace(dir), id, phase));
ipcMain.handle('specs:update', (_e, dir, id, change) => specsLib.update(requireWorkspace(dir), id, change || {}));
ipcMain.handle('specs:setTask', (_e, dir, id, line, done) => specsLib.setTask(requireWorkspace(dir), id, line, done));
/** Sends a spec step to the agent of a session in that folder; the prompt is built here from the action name. */
ipcMain.handle('specs:send', (_e, { dir, sessionId, id, action, opts }) => {
  const root = requireWorkspace(dir);
  const s = session(sessionId);
  if (path.resolve(s.directory) !== root) throw new Error('That session works in another folder');
  sendPrompt(sessionId, specsLib.promptFor(root, id, action, opts || {}, lang()));
});

// ---- agent hooks ----
const hookTrust = new hooksLib.Trust(path.join(process.env.HEARTH_HOME || require('node:os').homedir(), '.hearth', 'hook-trust.json'));
const hookEngine = new hooksLib.Engine({
  trust: hookTrust,
  runs: () => [...sessions.values()].filter((s) => !s.login).map((s) => ({ id: s.id, directory: path.resolve(s.directory), status: s.status.state, running: !s.status.exited, selected: s.id === selectedSession })),
  send: (id, text) => { try { sendPrompt(id, text); } catch { /* exited meanwhile */ } },
  runCommand: (root, command, timeout) => new Promise((resolve) => {
    startTask(root, { dir: root, command, title: command }, 'hook').then(({ id }) => {
      const run = runs.get(id);
      const timer = setTimeout(() => run.stop(), Math.max(5, Math.min(3600, timeout || 600)) * 1000);
      const check = setInterval(() => { if (run.state !== 'running') { clearInterval(check); clearTimeout(timer); resolve({ code: run.state === 'stopped' ? null : run.code, output: run.text }); } }, 300);
    }, (e) => resolve({ code: -1, output: plainError(e) }));
  }),
});
let selectedSession = null;
hookEngine.onChange = () => { clearTimeout(hookEngine.notify); hookEngine.notify = setTimeout(() => send('hooks:changed'), 100); };
ipcMain.on('session:selected', (_e, id) => { selectedSession = typeof id === 'string' ? id : null; });
const hookView = (root) => {
  const set = hookEngine.hooks(root);
  return { hooks: set.hooks.map((h) => ({ ...h, trusted: hookEngine.isTrusted(root, h) })), problems: set.problems,
    files: Object.keys(set.hashes).map((f) => ({ file: f, trusted: hookTrust.isTrusted(root, f, set.hashes[f]) })),
    activity: hookEngine.activity.filter((a) => a.root === root), templates: hooksLib.TEMPLATES };
};
const hookById = (root, id) => { const h = hookEngine.hooks(root).hooks.find((x) => x.id === id); if (!h) throw new Error('Unknown hook'); return h; };
ipcMain.handle('hooks:get', (_e, dir) => { const root = requireWorkspace(dir); hookEngine.reload(root); return hookView(root); });
ipcMain.handle('hooks:create', (_e, dir, def) => { const root = requireWorkspace(dir); const rel = hooksLib.create(root, def || {}); hookEngine.wrote(root, rel, true); return rel; });
ipcMain.handle('hooks:setEnabled', (_e, dir, id, on) => { const root = requireWorkspace(dir); const h = hookById(root, id); const was = hookEngine.isTrusted(root, h); hooksLib.setEnabled(root, h, on); hookEngine.wrote(root, h.file, was); });
ipcMain.handle('hooks:remove', (_e, dir, id) => { const root = requireWorkspace(dir); const h = hookById(root, id); const was = hookEngine.isTrusted(root, h); hooksLib.remove(root, h); hookEngine.wrote(root, h.file, was); });
ipcMain.handle('hooks:allow', (_e, dir, file) => { const root = requireWorkspace(dir); hookEngine.allow(root, String(file)); });
ipcMain.handle('hooks:disallow', (_e, dir, file) => { const root = requireWorkspace(dir); hookEngine.disallow(root, String(file)); });
ipcMain.handle('hooks:run', (_e, dir, id) => hookEngine.runManually(path.resolve(requireWorkspace(dir)), id));

// ---- Explorer clipboard ----
ipcMain.handle('fs:clipCopy', (_e, paths) => fileops.setClipboardFiles((Array.isArray(paths) ? paths : []).map(requireWorkspace)));
/** Pastes the files Explorer put on the clipboard into a workspace folder (copies; the list is read here, not sent by the renderer). */
ipcMain.handle('fs:clipPaste', async (_e, dir) => {
  const dest = requireWorkspace(dir);
  const files = await fileops.clipboardFiles();
  const done = [];
  for (const f of files) {
    if (insideWorkspace(f) && path.resolve(f) === dest) continue;
    done.push(await fileops.copyInto(f, dest));
  }
  return done;
});
ipcMain.handle('fs:clipHasFiles', () => fileops.clipboardFiles());

// Smoke mode (tests): run a script in the renderer, print its JSON result, save a screenshot, quit.
async function smoke() {
  ipcMain.handle('smoke:shot', async (_e, name) => {
    const dir = path.dirname(process.env.HEARTH_SHOT);
    const file = path.join(dir, `${String(name).replace(/[^\w-]/g, '_')}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    return file;
  });
  // Screenshots for the landing page: window size, a region as PNG data URL, a file written next to HEARTH_SHOT.
  ipcMain.handle('smoke:size', (_e, w, h) => { win.setContentSize(Math.round(w), Math.round(h)); });
  ipcMain.handle('smoke:capture', async (_e, rect) => (await win.webContents.capturePage(rect || undefined)).toDataURL());
  ipcMain.handle('smoke:save', (_e, name, dataUrl) => {
    const file = path.join(path.dirname(process.env.HEARTH_SHOT), String(name).replace(/[^\w.-]/g, '_'));
    fs.writeFileSync(file, Buffer.from(String(dataUrl).replace(/^data:[^,]+,/, ''), 'base64'));
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

app.setAppUserModelId(APP_ID);
app.whenReady().then(() => { createWindow(); if (process.env.HEARTH_SMOKE) smoke(); });

// Leave no AppContainer grants behind, also when the app is closed or killed by a smoke test.
let cleaned = false;
function cleanupAll() {
  if (cleaned) return;
  cleaned = true;
  for (const r of runs.values()) r.stop();
  for (const s of sessions.values()) { s.restartAfterExit = false; try { s.term.kill(); } catch { /* exited */ } }
  hookEngine.close();
  leases.releaseAllSync();
}
app.on('before-quit', cleanupAll);
app.on('window-all-closed', () => { cleanupAll(); app.quit(); });
