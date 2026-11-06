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
function renderInbox() {
  const ul = $('#session-list');
  ul.replaceChildren();
  const list = [...state.sessions.values()].sort((a, b) => b.started - a.started);
  for (const s of list) {
    const li = el('li', { class: s.id === state.selected ? 'sel' : '' },
      el('span', { class: `dot ${s.status}` }),
      el('div', {}, el('div', { class: 't' }, s.name), el('div', { class: 's' }, `${s.title} - ${t(STATUS[s.status] || s.status)}`)),
      el('span', { class: `tag ${s.sandboxed ? '' : 'raw'}` }, s.sandboxed ? t('sandbox') : t('NO SANDBOX')));
    li.addEventListener('click', () => select(s.id));
    li.addEventListener('contextmenu', (e) => { e.preventDefault(); if (confirm(t('Close "{name}"?', { name: `${s.name} - ${s.title}` }))) closeSession(s.id); });
    ul.append(li);
  }
  $('#empty').hidden = state.sessions.size > 0;
  const sel = cur();
  $('#session-meta').textContent = sel ? sel.directory : '';
  const needs = list.filter((s) => s.status === 'needs-input').length;
  document.title = needs ? `(${needs}) Hearth IDE` : 'Hearth IDE';
}

function select(id) {
  state.selected = id;
  for (const [tid, term] of state.terms) term.host.classList.toggle('active', tid === id);
  const s = cur();
  if (s) loadTree(s.directory);
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

window.hearth.onData(({ id, data }) => state.terms.get(id)?.term.write(data));
window.hearth.onStatus(({ id, status }) => { const s = state.sessions.get(id); if (s) { s.status = status; renderInbox(); notify(s); } });
window.hearth.onExit(({ id, code }) => {
  const s = state.sessions.get(id);
  state.terms.get(id)?.term.write(`\r\n\x1b[2m[${t('process exited with code {code}', { code })}]\x1b[0m\r\n`);
  if (s) { s.status = code === 0 ? 'done' : 'failed'; renderInbox(); }
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
  b.textContent = ok ? (state.env.backend === 'native' ? t('Sandbox ready (Windows AppContainer, no install needed)') : t('Sandbox ready (WSL2 {distro} + nono)', { distro: state.env.distro })) : t('No sandbox: {reason}', { reason: state.env.reason });
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
      } catch (err) { children.append(el('div', { class: 'hint' }, errMsg(err))); }
    }
  };
  const caret = el('span', { class: 'caret' }, '>');
  const label = el('div', { class: 'node' }, caret, base(dir) || dir);
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
    const x = el('button', { class: 'ghost x', title: t('Close') }, 'x');
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
  state.settings = await window.hearth.getSettings();
  Themes.apply(state.settings.theme);
  I18n.set(state.settings.language);
  Themes.onChange(() => { for (const { term } of state.terms.values()) term.options.theme = Themes.terminalTheme(); });
  await showSandboxState();
  renderInbox();
  fire('hearth:ready');
})();
