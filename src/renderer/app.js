'use strict';
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
  for (const k of kids) n.append(k);
  return n;
};

const state = { sessions: new Map(), terms: new Map(), selected: null, env: null, settings: null, editor: null, openFile: null, dirty: false };
const LABEL = { starting: 'Starting', running: 'Running', 'needs-input': 'Needs input', idle: 'Idle', done: 'Done', failed: 'Failed' };

// ---------- tabs ----------
function bindTabs(navSel, panePrefix) {
  document.querySelectorAll(`${navSel} button`).forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll(`${navSel} button`).forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll(`[id^="${panePrefix}"]`).forEach((p) => p.classList.toggle('active', p.id === panePrefix + b.dataset.tab));
    if (b.dataset.tab === 'editor') layoutEditor();
    if (b.dataset.tab === 'agent') fitCurrent();
    if (b.dataset.tab === 'git') refreshGit();
  }));
}
bindTabs('#center-tabs', 'pane-');
bindTabs('#insp-tabs', 'insp-');

// ---------- inbox ----------
function renderInbox() {
  const ul = $('#session-list');
  ul.replaceChildren();
  const list = [...state.sessions.values()].sort((a, b) => b.started - a.started);
  for (const s of list) {
    const li = el('li', { class: s.id === state.selected ? 'sel' : '' },
      el('span', { class: `dot ${s.status}` }),
      el('div', {}, el('div', { class: 't' }, s.name), el('div', { class: 's' }, `${s.title} - ${LABEL[s.status] || s.status}`)),
      el('span', { class: `tag ${s.sandboxed ? '' : 'raw'}` }, s.sandboxed ? 'sandbox' : 'NO SANDBOX'));
    li.addEventListener('click', () => select(s.id));
    li.addEventListener('contextmenu', (e) => { e.preventDefault(); if (confirm(`Close "${s.name} - ${s.title}"?`)) closeSession(s.id); });
    ul.append(li);
  }
  $('#empty').hidden = state.sessions.size > 0;
  const sel = state.sessions.get(state.selected);
  $('#session-meta').textContent = sel ? sel.directory : '';
  const needs = list.filter((s) => s.status === 'needs-input').length;
  document.title = needs ? `(${needs}) Hearth IDE` : 'Hearth IDE';
}

function select(id) {
  state.selected = id;
  for (const [tid, t] of state.terms) t.host.classList.toggle('active', tid === id);
  const s = state.sessions.get(id);
  if (s) { loadTree(s.directory); refreshGit(); }
  renderInbox();
  fitCurrent();
}

async function closeSession(id) {
  await window.hearth.remove(id);
  const t = state.terms.get(id);
  if (t) { t.term.dispose(); t.host.remove(); state.terms.delete(id); }
  state.sessions.delete(id);
  if (state.selected === id) state.selected = [...state.sessions.keys()][0] || null;
  if (state.selected) select(state.selected); else renderInbox();
}

// ---------- terminals ----------
function themeTerm() {
  const dark = !matchMedia('(prefers-color-scheme: light)').matches;
  return dark ? { background: '#14151a', foreground: '#dfe1e5', cursor: '#f08a4b' } : { background: '#ffffff', foreground: '#1d1f23', cursor: '#d96a1f' };
}
function attachTerminal(s) {
  const host = el('div', { class: 'term' });
  $('#terminals').append(host);
  const term = new Terminal({ fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: 13, cursorBlink: true, scrollback: 10000, theme: themeTerm(), allowProposedApi: false });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  term.onData((d) => window.hearth.input(s.id, d));
  term.onResize(({ cols, rows }) => window.hearth.resize(s.id, cols, rows));
  state.terms.set(s.id, { term, fit, host });
}
function fitCurrent() {
  const t = state.terms.get(state.selected);
  if (!t) return;
  requestAnimationFrame(() => { try { t.fit.fit(); } catch { /* hidden */ } });
}
new ResizeObserver(fitCurrent).observe($('#terminals'));

window.hearth.onData(({ id, data }) => state.terms.get(id)?.term.write(data));
window.hearth.onStatus(({ id, status }) => { const s = state.sessions.get(id); if (s) { s.status = status; renderInbox(); notify(s); } });
window.hearth.onExit(({ id, code }) => {
  const s = state.sessions.get(id);
  state.terms.get(id)?.term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`);
  if (s) { s.status = code === 0 ? 'done' : 'failed'; renderInbox(); }
});
function notify(s) {
  if (s.status !== 'needs-input' || document.hasFocus() || !('Notification' in window)) return;
  const fire = () => new Notification(`${s.name} needs you`, { body: s.title });
  if (Notification.permission === 'granted') fire(); else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && fire());
}

// ---------- start dialog ----------
async function openStart() {
  const sel = $('#start-kind');
  if (!sel.options.length) for (const a of await window.hearth.agents()) sel.append(el('option', { value: a.id }, a.name));
  updateHint();
  $('#dlg-start').showModal();
}
async function updateHint() {
  const agents = await window.hearth.agents();
  const a = agents.find((x) => x.id === $('#start-kind').value);
  const env = state.env;
  let hint = a && a.install ? `Install: ${a.install} (inside WSL, in the sandbox)` : '';
  if (env && !(env.wsl && env.nono)) hint += (hint ? '\n' : '') + env.reason;
  $('#start-hint').textContent = hint;
}
$('#start-kind').addEventListener('change', updateHint);
$('#btn-start').addEventListener('click', openStart);
$('#btn-pick').addEventListener('click', async () => { const d = await window.hearth.pickFolder(); if (d) $('#start-dir').value = d; });
$('#btn-go').addEventListener('click', async (e) => {
  const kind = $('#start-kind').value; const directory = $('#start-dir').value;
  if (!directory) { e.preventDefault(); return; }
  try {
    const s = await window.hearth.start({ kind, directory });
    state.sessions.set(s.id, s);
    attachTerminal(s);
    select(s.id);
    document.querySelector('#center-tabs [data-tab="agent"]').click();
  } catch (err) { alert(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
});

// ---------- settings ----------
async function openSettings() {
  const s = state.settings = await window.hearth.getSettings();
  state.env = await window.hearth.detect(true);
  $('#set-domains').value = s.domains.join('\n');
  $('#set-ports').value = s.ports.join(', ');
  $('#set-ssh').checked = s.gitSSH;
  $('#set-unsandboxed').checked = s.allowUnsandboxed;
  const e = state.env;
  $('#env-info').textContent = e.wsl ? `WSL2: ${e.distro} - nono: ${e.nono ? 'installed' : 'missing'}` : 'WSL2: not installed';
  $('#dlg-settings').showModal();
}
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-save-settings').addEventListener('click', async () => {
  state.settings = await window.hearth.setSettings({
    ...state.settings,
    domains: $('#set-domains').value.split(/\s+/).filter(Boolean),
    ports: $('#set-ports').value.split(/[,\s]+/).filter(Boolean).map(Number),
    gitSSH: $('#set-ssh').checked, allowUnsandboxed: $('#set-unsandboxed').checked,
  });
});

async function showSandboxState() {
  state.env = await window.hearth.detect();
  const b = $('#sandbox-banner');
  const ok = state.env.wsl && state.env.nono;
  b.hidden = false;
  b.className = ok ? 'ok' : '';
  b.textContent = ok ? `Sandbox ready (WSL2 ${state.env.distro} + nono)` : `No sandbox: ${state.env.reason}`;
}

// ---------- file tree ----------
async function loadTree(root) {
  const host = $('#tree');
  host.replaceChildren();
  host.append(await dirNode(root, true));
}
async function dirNode(dir, open) {
  const wrap = el('div');
  const children = el('div', { class: 'children' });
  let loaded = false; let isOpen = false;
  const toggle = async () => {
    isOpen = !isOpen; caret.textContent = isOpen ? 'v' : '>';
    children.hidden = !isOpen;
    if (isOpen && !loaded) {
      loaded = true;
      try {
        for (const e of await window.hearth.list(dir)) {
          if (e.dir) children.append(await dirNode(e.path, false));
          else { const n = el('div', { class: 'node' }, el('span', { class: 'caret' }, ''), e.name); n.addEventListener('click', () => openFile(e.path)); children.append(n); }
        }
      } catch (err) { children.append(el('div', { class: 'hint' }, String(err.message))); }
    }
  };
  const caret = el('span', { class: 'caret' }, '>');
  const label = el('div', { class: 'node' }, caret, dir.split(/[\\/]/).pop() || dir);
  label.addEventListener('click', toggle);
  wrap.append(label, children);
  children.hidden = true;
  if (open) await toggle();
  return wrap;
}

// ---------- editor ----------
function langOf(file) {
  const ext = file.split('.').pop().toLowerCase();
  return { js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown', py: 'python', java: 'java', swift: 'swift',
    html: 'html', css: 'css', xml: 'xml', yml: 'yaml', yaml: 'yaml', sh: 'shell', rs: 'rust', go: 'go', kt: 'kotlin', cs: 'csharp', sql: 'sql', toml: 'ini' }[ext] || 'plaintext';
}
function ensureEditor() {
  if (state.editor) return Promise.resolve(state.editor);
  return new Promise((resolve) => {
    require.config({ paths: { vs: '../../node_modules/monaco-editor/min/vs' } });
    window.MonacoEnvironment = { getWorkerUrl: () => 'data:text/javascript;charset=utf-8,' + encodeURIComponent('self.MonacoEnvironment={baseUrl:"' + new URL('../../node_modules/monaco-editor/min/', location.href).href + '"};importScripts("' + new URL('../../node_modules/monaco-editor/min/vs/base/worker/workerMain.js', location.href).href + '");') };
    require(['vs/editor/editor.main'], () => {
      state.editor = monaco.editor.create($('#monaco'), { value: '', language: 'plaintext', theme: matchMedia('(prefers-color-scheme: light)').matches ? 'vs' : 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontSize: 13 });
      state.editor.onDidChangeModelContent(() => { if (state.openFile && !state.loading) { state.dirty = true; $('#btn-save').disabled = false; $('#editor-status').textContent = 'modified'; } });
      state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFile);
      resolve(state.editor);
    });
  });
}
function layoutEditor() { state.editor?.layout(); }
async function openFile(file) {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  document.querySelector('#center-tabs [data-tab="editor"]').click();
  const editor = await ensureEditor();
  try {
    const text = await window.hearth.read(file);
    state.loading = true;
    const model = monaco.editor.createModel(text, langOf(file));
    editor.getModel()?.dispose();
    editor.setModel(model);
    state.loading = false; state.openFile = file; state.dirty = false;
    $('#btn-save').disabled = true; $('#editor-status').textContent = file;
    $('#editor-file').textContent = file.split(/[\\/]/).pop();
  } catch (err) { $('#editor-status').textContent = String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
}
async function saveFile() {
  if (!state.openFile || !state.dirty) return;
  await window.hearth.write(state.openFile, state.editor.getValue());
  state.dirty = false; $('#btn-save').disabled = true; $('#editor-status').textContent = `${state.openFile} - saved`;
  refreshGit();
}
$('#btn-save').addEventListener('click', saveFile);

// ---------- git ----------
let selectedDiff = null;
async function refreshGit() {
  const s = state.sessions.get(state.selected);
  const head = $('#git-head'); const list = $('#git-files');
  list.replaceChildren(); $('#git-log').replaceChildren();
  if (!s) { head.textContent = 'No session selected'; return; }
  if (!(await window.hearth.git.isRepo(s.directory))) { head.textContent = 'Not a Git repository'; $('#git-count').textContent = ''; return; }
  const st = await window.hearth.git.status(s.directory);
  head.textContent = `${st.branch || '(detached)'}${st.upstream ? ' -> ' + st.upstream : ''}${st.ahead ? '  up ' + st.ahead : ''}${st.behind ? '  down ' + st.behind : ''}`;
  $('#git-count').textContent = st.files.length ? `(${st.files.length})` : '';
  for (const f of st.files) {
    const code = f.untracked ? 'U' : (f.staged ? f.index : f.worktree);
    const row = el('div', { class: 'gf' }, el('span', { class: `st ${code}` }, code), el('span', {}, f.path),
      el('button', { class: 'ghost' }, f.staged ? 'Unstage' : 'Stage'));
    row.querySelector('button').addEventListener('click', async (e) => {
      e.stopPropagation();
      await (f.staged ? window.hearth.git.unstage(s.directory, [f.path]) : window.hearth.git.stage(s.directory, [f.path]));
      refreshGit();
    });
    row.addEventListener('click', () => showDiff(s.directory, f));
    list.append(row);
  }
  if (selectedDiff) { const f = st.files.find((x) => x.path === selectedDiff.path); if (f) showDiff(s.directory, f); }
  for (const c of await window.hearth.git.log(s.directory).catch(() => [])) $('#git-log').append(el('li', {}, `${c.subject} `, el('small', {}, `${c.hash} - ${c.author}, ${c.when}`)));
}
async function showDiff(dir, f) {
  selectedDiff = f;
  const pre = $('#git-diff'); pre.replaceChildren();
  const text = f.untracked ? '(untracked file - stage it to include in the commit)' : await window.hearth.git.diff(dir, f.path, f.staged && !f.unstaged);
  for (const line of text.split('\n')) pre.append(el('div', { class: line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : '' }, line || ' '));
}
$('#btn-refresh').addEventListener('click', refreshGit);
$('#btn-commit').addEventListener('click', async () => {
  const s = state.sessions.get(state.selected); if (!s) return;
  try { await window.hearth.git.commit(s.directory, $('#commit-msg').value); $('#commit-msg').value = ''; selectedDiff = null; $('#git-diff').replaceChildren(); }
  catch (err) { alert(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  refreshGit();
});
setInterval(() => { if ($('#insp-git').classList.contains('active') && document.hasFocus()) refreshGit(); }, 5000);

showSandboxState();
renderInbox();
