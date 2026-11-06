'use strict';
// Core of the window: inbox, terminals, start dialog, file tree, editor tabs, layout.
// The inspector views (git, overview, tests, ...) live in view-*.js and react to the events below:
//   hearth:select  (detail: session or null)   hearth:tab  (detail: inspector tab name)
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
  for (const k of kids) n.append(k);
  return n;
};
const errMsg = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const cur = () => state.sessions.get(state.selected) || null;
const base = (p) => String(p).split(/[\\/]/).pop();
const fire = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
/** Fill <i data-ico="name" data-size="16"> placeholders with the SVG icon. */
function hydrateIcons(root = document) {
  for (const n of root.querySelectorAll('i[data-ico]')) { n.outerHTML = Icons.html(n.dataset.ico, Number(n.dataset.size) || 16); }
}
const ago = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return t('now');
  if (s < 90) return t('{n} s ago', { n: s });
  if (s < 5400) return t('{n} min ago', { n: Math.round(s / 60) });
  return t('{n} h ago', { n: Math.round(s / 3600) });
};
const plainLine = (data) => data.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');

const state = { sessions: new Map(), terms: new Map(), selected: null, env: null, settings: null, editor: null, docs: new Map(), active: null, zoom: 0 };
const STATUS = { starting: 'Starting', running: 'Running', 'needs-input': 'Needs input', idle: 'Idle', done: 'Done', failed: 'Failed' };

// ---------- tabs ----------
function bindTabs(navSel, panePrefix, onSwitch) {
  document.querySelectorAll(`${navSel} > button`).forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll(`${navSel} > button`).forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll(`[id^="${panePrefix}"]`).forEach((p) => p.classList.toggle('active', p.id === panePrefix + b.dataset.tab));
    onSwitch?.(b.dataset.tab);
  }));
}
bindTabs('#center-tabs', 'pane-', (tab) => { if (tab === 'editor') state.editor?.layout(); if (tab === 'agent') fitCurrent(); });
bindTabs('#insp-tabs', 'insp-', (tab) => fire('hearth:tab', tab));
const showCenter = (tab) => document.querySelector(`#center-tabs [data-tab="${tab}"]`).click();
const showInspector = (tab) => document.querySelector(`#insp-tabs [data-tab="${tab}"]`).click();

// ---------- inbox ----------
const PILL = { starting: ['', 'Starting'], running: ['run', 'Running'], 'needs-input': ['warn', 'Needs input'], idle: ['', 'Idle'], done: ['ok', 'Done'], failed: ['bad', 'Failed'] };
/** A session "needs attention" when it asks something, failed, or finished and has not been looked at yet. */
const needsAttention = (s) => s.status === 'needs-input' || s.status === 'failed' || (s.status === 'done' && !s.seen);

function sessionCard(s) {
  const [cls, label] = PILL[s.status] || ['', s.status];
  const summary = s.last || '';
  const card = el('li', { class: `card ${s.id === state.selected ? 'sel' : ''} ${needsAttention(s) ? 'attn' : ''}` },
    el('span', { class: 'tile' }),
    el('div', { style: 'min-width:0' },
      el('div', { class: 'ttl' }, el('span', { class: 't' }, s.title), el('span', { class: `pill ${cls}` }, t(label))),
      el('div', { class: 's' }, `${s.name} · ${s.directory}`),
      summary ? el('div', { class: 'sum' }, summary) : '',
      el('div', { class: 's' }, `${s.sandboxed ? t('sandbox') : t('NO SANDBOX')} · ${ago(s.lastActivity || s.started)}`)));
  card.firstChild.innerHTML = Icons.html(Icons.agent(s.kind), 16);
  card.addEventListener('click', () => select(s.id));
  card.addEventListener('contextmenu', (e) => { e.preventDefault(); if (confirm(t('Close "{name}"?', { name: `${s.name} - ${s.title}` }))) closeSession(s.id); });
  return card;
}

function renderInbox() {
  const list = [...state.sessions.values()].sort((a, b) => b.started - a.started);
  const attn = list.filter(needsAttention);
  const rest = list.filter((s) => !needsAttention(s));
  $('#attn-wrap').hidden = attn.length === 0;
  $('#attn-count').textContent = String(attn.length);
  $('#attn-sub').textContent = t('{n} sessions with activity, results, questions or errors.', { n: attn.length });
  $('#attn-list').replaceChildren(...attn.map(sessionCard));
  $('#session-list').replaceChildren(...rest.map(sessionCard));
  const active = list.filter((s) => s.status === 'running' || s.status === 'starting').length;
  $('#agents-count').textContent = list.length ? `(${t('{n} active', { n: active })})` : '';
  $('#empty-inbox').hidden = list.length > 0;
  $('#empty').hidden = list.length > 0 ? true : false;
  const sel = cur();
  $('#session-meta').textContent = sel ? sel.directory : '';
  const needs = list.filter((s) => s.status === 'needs-input').length;
  document.title = needs ? `(${needs}) Hearth IDE` : 'Hearth IDE';
  renderChatHead();
}

function renderChatHead() {
  const s = cur();
  $('#chat-head').hidden = !s;
  if (!s) return;
  const [cls, label] = PILL[s.status] || ['', s.status];
  $('#ch-icon').innerHTML = Icons.html(Icons.agent(s.kind), 17);
  $('#ch-title').textContent = s.title;
  $('#ch-sub').textContent = `${s.name} · ${s.directory}`;
  const st = $('#ch-status'); st.className = `pill ${cls}`; st.textContent = t(label);
  const sb = $('#ch-sandbox'); sb.className = `pill ${s.sandboxed ? 'ok' : 'raw'}`; sb.innerHTML = Icons.html('shield', 12) + (s.sandboxed ? t('sandbox') : t('NO SANDBOX'));
  $('#ch-stop').disabled = s.status === 'done' || s.status === 'failed';
}
$('#ch-stop').addEventListener('click', () => { const s = cur(); if (s) window.hearth.stop(s.id); });
$('#btn-start2').addEventListener('click', () => $('#btn-start').click());
setInterval(() => { if (state.sessions.size) renderInbox(); }, 30000);   // "2 min ago" stays current

function select(id) {
  state.selected = id;
  for (const [tid, term] of state.terms) term.host.classList.toggle('active', tid === id);
  const s = cur();
  if (s) { s.seen = true; loadTree(s.directory); }
  renderInbox();
  fitCurrent();
  fire('hearth:select', s);
}

async function closeSession(id) {
  await window.hearth.remove(id);
  const term = state.terms.get(id);
  if (term) { term.term.dispose(); term.host.remove(); state.terms.delete(id); }
  state.sessions.delete(id);
  if (state.selected === id) state.selected = [...state.sessions.keys()][0] || null;
  if (state.selected) select(state.selected); else { renderInbox(); fire('hearth:select', null); }
}

// ---------- terminals ----------
const BASE_FONT = 13;
function attachTerminal(s) {
  const host = el('div', { class: 'term' });
  $('#terminals').append(host);
  const term = new Terminal({ fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: BASE_FONT + state.zoom, cursorBlink: true, scrollback: 10000, theme: Themes.terminalTheme() });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  term.attachCustomKeyEventHandler((e) => !(e.ctrlKey && !e.altKey && ['k', 'K'].includes(e.key) && e.type === 'keydown' && (fire('hearth:search'), true)));
  term.onData((d) => window.hearth.input(s.id, d));
  term.onResize(({ cols, rows }) => window.hearth.resize(s.id, cols, rows));
  state.terms.set(s.id, { term, fit, host });
}
function fitCurrent() {
  const term = state.terms.get(state.selected);
  if (!term) return;
  requestAnimationFrame(() => { try { term.fit.fit(); } catch { /* hidden */ } });
}
new ResizeObserver(fitCurrent).observe($('#terminals'));

let inboxTimer = null;
const renderInboxSoon = () => { if (!inboxTimer) inboxTimer = setTimeout(() => { inboxTimer = null; renderInbox(); }, 1200); };
window.hearth.onData(({ id, data }) => {
  state.terms.get(id)?.term.write(data);
  const s = state.sessions.get(id);
  if (!s) return;
  s.lastActivity = Date.now();
  // The card shows the agent's latest line, so the inbox says what is going on without opening the chat.
  const line = plainLine(data).split(/\r?\n|\r/).map((l) => l.trim()).filter((l) => l.length > 2 && /[\p{L}\p{N}]/u.test(l) && !/^(PS )?[A-Za-z]:\\[^>]*>\s*$/.test(l) && !/^[$>%#]\s*$/.test(l)).pop();
  if (line) { s.last = line.slice(0, 140); renderInboxSoon(); }
});
window.hearth.onStatus(({ id, status }) => { const s = state.sessions.get(id); if (s) { s.status = status; if (id === state.selected && status === 'done') s.seen = true; renderInbox(); notify(s); } });
window.hearth.onExit(({ id, code }) => {
  const s = state.sessions.get(id);
  state.terms.get(id)?.term.write(`\r\n\x1b[2m[${t('process exited with code {code}', { code })}]\x1b[0m\r\n`);
  if (s) { s.status = code === 0 ? 'done' : 'failed'; if (id === state.selected && code === 0) s.seen = true; renderInbox(); }
});
function notify(s) {
  if (s.status !== 'needs-input' || document.hasFocus() || !('Notification' in window)) return;
  const fireIt = () => new Notification(t('{name} needs you', { name: s.name }), { body: s.title });
  if (Notification.permission === 'granted') fireIt(); else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && fireIt());
}

// ---------- start dialog ----------
async function openStart() {
  const sel = $('#start-kind');
  if (!sel.options.length) for (const a of await window.hearth.agents()) sel.append(el('option', { value: a.id }, a.name));
  $('#start-login').parentElement.hidden = false;
  updateHint();
  $('#dlg-start').showModal();
}
async function updateHint() {
  const agents = await window.hearth.agents();
  const a = agents.find((x) => x.id === $('#start-kind').value);
  $('#start-login').parentElement.hidden = !(a && a.login);
  let hint = a && a.install ? t('Install: {cmd} (the sandbox reads it from your PATH)', { cmd: a.install }) : '';
  if (state.env && !state.env.backend) hint += (hint ? '\n' : '') + state.env.reason;
  $('#start-hint').textContent = hint;
  const clone = $('#start-source').value === 'clone';
  $('#row-clone').hidden = !clone;
  $('#lbl-dir').textContent = clone ? t('Clone into folder') : t('Folder');
}
$('#start-kind').addEventListener('change', updateHint);
$('#start-source').addEventListener('change', updateHint);
$('#btn-start').addEventListener('click', openStart);
$('#btn-pick').addEventListener('click', async () => { const d = await window.hearth.pickFolder(); if (d) $('#start-dir').value = d; });
$('#btn-go').addEventListener('click', async (e) => {
  const kind = $('#start-kind').value; const directory = $('#start-dir').value;
  const clone = $('#start-source').value === 'clone';
  if (!directory || (clone && !$('#start-url').value.trim())) { e.preventDefault(); return; }
  try {
    const s = await window.hearth.start({ kind, directory, login: $('#start-login').checked, cloneUrl: clone ? $('#start-url').value.trim() : undefined });
    state.sessions.set(s.id, s);
    attachTerminal(s);
    select(s.id);
    showCenter('agent');
  } catch (err) { alert(errMsg(err)); }
});

async function showSandboxState() {
  state.env = await window.hearth.detect();
  const b = $('#sandbox-banner');
  const ok = Boolean(state.env.backend);
  b.hidden = false;
  b.className = ok ? 'ok' : '';
  const full = ok ? (state.env.backend === 'native' ? t('Sandbox ready (Windows AppContainer, no install needed)') : t('Sandbox ready (WSL2 {distro} + nono)', { distro: state.env.distro })) : t('No sandbox: {reason}', { reason: state.env.reason });
  b.title = full;
  b.innerHTML = Icons.html('shield', 13) + `<span>${ok ? (state.env.backend === 'native' ? 'AppContainer' : 'WSL2 · nono') : t('No sandbox')}</span>`;
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
    isOpen = !isOpen;
    caret.innerHTML = Icons.html(isOpen ? 'chevron-down' : 'chevron-right', 13);
    folder.innerHTML = Icons.html(isOpen ? 'folder-open' : 'folder', 15);
    children.hidden = !isOpen;
    if (isOpen && !loaded) {
      loaded = true;
      try {
        for (const e of await window.hearth.list(dir)) {
          if (e.dir) children.append(await dirNode(e.path, false));
          else {
            const n = el('div', { class: 'node' }, el('span', { class: 'caret' }), el('span', {}), e.name);
            n.children[1].innerHTML = Icons.html(Icons.forFile(e.name), 15);
            n.addEventListener('click', () => openFile(e.path)); children.append(n);
          }
        }
      } catch (err) { children.append(el('div', { class: 'hint' }, errMsg(err))); }
    }
  };
  const caret = el('span', { class: 'caret' });
  const folder = el('span', {});
  caret.innerHTML = Icons.html('chevron-right', 13); folder.innerHTML = Icons.html('folder', 15);
  const label = el('div', { class: 'node dir' }, caret, folder, base(dir) || dir);
  label.addEventListener('click', toggle);
  wrap.append(label, children);
  children.hidden = true;
  if (open) await toggle();
  return wrap;
}

// ---------- editor (Monaco, one tab per file) ----------
function langOf(file) {
  const ext = file.split('.').pop().toLowerCase();
  return { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown', py: 'python', java: 'java', swift: 'swift',
    html: 'html', css: 'css', xml: 'xml', yml: 'yaml', yaml: 'yaml', sh: 'shell', rs: 'rust', go: 'go', kt: 'kotlin', cs: 'csharp', sql: 'sql', toml: 'ini', c: 'c', h: 'c', cpp: 'cpp', rb: 'ruby', php: 'php', gradle: 'groovy' }[ext] || 'plaintext';
}
function ensureEditor() {
  if (state.editor) return Promise.resolve(state.editor);
  return new Promise((resolve) => {
    require.config({ paths: { vs: '../../node_modules/monaco-editor/min/vs' } });
    window.MonacoEnvironment = { getWorkerUrl: () => 'data:text/javascript;charset=utf-8,' + encodeURIComponent('self.MonacoEnvironment={baseUrl:"' + new URL('../../node_modules/monaco-editor/min/', location.href).href + '"};importScripts("' + new URL('../../node_modules/monaco-editor/min/vs/base/worker/workerMain.js', location.href).href + '");') };
    require(['vs/editor/editor.main'], () => {
      state.editor = monaco.editor.create($('#monaco'), { value: '', language: 'plaintext', theme: Themes.monacoTheme(monaco), automaticLayout: true, minimap: { enabled: false }, fontSize: BASE_FONT + state.zoom });
      state.editor.onDidChangeModelContent(() => { const d = state.docs.get(state.active); if (d && !d.loading) { d.dirty = true; renderDocs(); } });
      state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFile);
      state.editor.addAction({ id: 'hearth.usages', label: t('Find usages'), keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F7], contextMenuGroupId: 'navigation', contextMenuOrder: 1.5,
        run: (ed) => { const w = ed.getModel().getWordAtPosition(ed.getPosition()); if (w) fire('hearth:usages', { word: w.word, file: state.active }); } });
      state.editor.addAction({ id: 'hearth.definition', label: t('Go to definition'), keybindings: [monaco.KeyCode.F12], contextMenuGroupId: 'navigation', contextMenuOrder: 1.4,
        run: (ed) => { const w = ed.getModel().getWordAtPosition(ed.getPosition()); if (w) fire('hearth:definition', { word: w.word, file: state.active }); } });
      state.editor.onMouseDown((e) => {
        if (!(e.event.ctrlKey && e.target.position)) return;
        const w = state.editor.getModel().getWordAtPosition(e.target.position);
        if (w) fire('hearth:definition', { word: w.word, file: state.active });
      });
      Themes.onChange(() => monaco.editor.setTheme(Themes.monacoTheme(monaco)));
      resolve(state.editor);
    });
  });
}

function renderDocs() {
  const bar = $('#editor-bar');
  let tabs = $('#doc-tabs');
  if (!tabs) { tabs = el('div', { id: 'doc-tabs', class: 'doc-tabs' }); bar.prepend(tabs); }
  tabs.replaceChildren();
  for (const [file, d] of state.docs) {
    const b = el('button', { class: `doc ${file === state.active ? 'active' : ''}`, title: file }, base(file) + (d.dirty ? ' *' : ''));
    b.addEventListener('click', () => activateDoc(file));
    const x = el('button', { class: 'ib x', title: t('Close') });
    x.innerHTML = Icons.html('x', 13);
    x.addEventListener('click', (ev) => { ev.stopPropagation(); closeDoc(file); });
    tabs.append(el('span', { class: 'doc-wrap' }, b, x));
  }
  const d = state.docs.get(state.active);
  $('#btn-save').disabled = !(d && d.dirty);
  $('#editor-status').textContent = d ? (d.dirty ? t('modified') : d.status || state.active) : '';
  $('#editor-file').textContent = d ? base(state.active) : '';
}

function activateDoc(file) {
  const prev = state.docs.get(state.active);
  if (prev) prev.view = state.editor.saveViewState();
  const d = state.docs.get(file);
  if (!d) return;
  state.active = file;
  state.editor.setModel(d.model);
  if (d.view) state.editor.restoreViewState(d.view);
  renderDocs();
}

function closeDoc(file) {
  const d = state.docs.get(file);
  if (!d) return;
  if (d.dirty && !confirm(t('Discard unsaved changes?'))) return;
  d.model.dispose();
  state.docs.delete(file);
  if (state.active === file) {
    const next = [...state.docs.keys()].pop();
    state.active = null;
    if (next) activateDoc(next); else { state.editor.setModel(monaco.editor.createModel('', 'plaintext')); renderDocs(); }
  } else renderDocs();
}

/** Open a file in the editor; optionally jump to a line and mark every occurrence of `mark`. */
async function openFile(file, line, mark) {
  showCenter('editor');
  const editor = await ensureEditor();
  try {
    if (!state.docs.has(file)) {
      const text = await window.hearth.read(file);
      const model = monaco.editor.createModel(text, langOf(file));
      state.docs.set(file, { model, dirty: false, loading: false, status: file });
    }
    activateDoc(file);
    if (mark) {
      const matches = state.docs.get(file).model.findMatches(mark, false, false, false, null, false);
      state.decorations?.clear();
      state.decorations = editor.createDecorationsCollection(matches.map((m) => ({ range: m.range, options: { inlineClassName: 'find-hit' } })));
    }
    if (line) { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 }); editor.focus(); }
  } catch (err) { $('#editor-status').textContent = errMsg(err); }
}
async function saveFile() {
  const d = state.docs.get(state.active);
  if (!d || !d.dirty) return;
  try { await window.hearth.write(state.active, d.model.getValue()); d.dirty = false; d.status = `${state.active} - ${t('saved')}`; renderDocs(); fire('hearth:saved', state.active); }
  catch (err) { alert(errMsg(err)); }
}
$('#btn-save').addEventListener('click', saveFile);

// ---------- zoom (Ctrl +/-/0) ----------
function applyZoom() {
  for (const { term, fit } of state.terms.values()) { term.options.fontSize = BASE_FONT + state.zoom; try { fit.fit(); } catch { /* hidden */ } }
  state.editor?.updateOptions({ fontSize: BASE_FONT + state.zoom });
  try { localStorage.setItem('zoom', String(state.zoom)); } catch { /* private mode */ }
}
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey) return;
  if (e.key === '=' || e.key === '+') state.zoom = Math.min(10, state.zoom + 1);
  else if (e.key === '-') state.zoom = Math.max(-5, state.zoom - 1);
  else if (e.key === '0') state.zoom = 0;
  else return;
  e.preventDefault(); applyZoom();
});
try { state.zoom = Number(localStorage.getItem('zoom')) || 0; } catch { /* private mode */ }

// ---------- layout: resizable inspector ----------
(() => {
  const split = $('#splitter');
  const apply = (w) => document.documentElement.style.setProperty('--insp-w', `${Math.max(280, Math.min(900, w))}px`);
  try { const w = Number(localStorage.getItem('inspW')); if (w) apply(w); } catch { /* private mode */ }
  split.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const move = (ev) => apply(window.innerWidth - ev.clientX);
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); try { localStorage.setItem('inspW', String(Math.round(window.innerWidth - split.getBoundingClientRect().right + 6))); } catch { /* */ } fitCurrent(); state.editor?.layout(); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
})();

document.addEventListener('hearth:lang', () => { renderInbox(); if (state.env) showSandboxState(); });

// ---------- startup ----------
(async () => {
  hydrateIcons();
  state.settings = await window.hearth.getSettings();
  Themes.onChange((_name, p) => {
    for (const { term } of state.terms.values()) term.options.theme = Themes.terminalTheme();
    window.hearth.setTitleBar(p.window, p.editorForeground);       // native caption buttons follow the theme
  });
  Themes.apply(state.settings.theme);
  I18n.set(state.settings.language);
  await showSandboxState();
  renderInbox();
  fire('hearth:ready');
})();
