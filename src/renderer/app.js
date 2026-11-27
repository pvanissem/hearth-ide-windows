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
/** A short message at the bottom of the window (gone after a moment). */
let toastTimer = null;
function toast(text) {
  let box = document.getElementById('toast');
  if (!box) { box = el('div', { id: 'toast', role: 'status' }); document.body.append(box); }
  box.textContent = text; box.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.remove('on'), 3500);
}
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
const STATUS = { starting: 'Starting', running: 'Running', 'needs-input': 'Needs input', blocked: 'Error', idle: 'Idle', done: 'Done', failed: 'Failed' };

// ---------- tabs ----------
function bindTabs(navSel, panePrefix, onSwitch) {
  document.querySelectorAll(`${navSel} > button`).forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll(`${navSel} > button`).forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll(`[id^="${panePrefix}"]`).forEach((p) => p.classList.toggle('active', p.id === panePrefix + b.dataset.tab));
    onSwitch?.(b.dataset.tab);
  }));
}
const showCenter = (view) => Layout.show(view);
const showInspector = (view) => Layout.show(view);
// a view became the visible tab of its pane
document.addEventListener("hearth:tab", (e) => { if (e.detail === "editor") state.editor?.layout(); if (e.detail === "agent") fitCurrent(); });
// per-pane text size ("AA"): terminals and the editor scale their font, the other views use CSS zoom
state.paneZoom = {};
document.addEventListener("hearth:zoom", (e) => { const { view, step } = e.detail; if (state.paneZoom[view] === step) return; state.paneZoom[view] = step; if (view === "agent" || view === "editor") applyZoom(); });

// ---------- inbox ----------
const PILL = { starting: ['', 'Starting'], running: ['run', 'Running'], 'needs-input': ['warn', 'Needs input'], blocked: ['bad', 'Error'], idle: ['', 'Idle'], done: ['ok', 'Done'], failed: ['bad', 'Failed'] };
/** A session "needs attention" when it asks something, failed, or finished and has not been looked at yet. */
const needsAttention = (s) => s.status === 'needs-input' || s.status === 'failed' || s.status === 'blocked' || (s.status === 'done' && !s.seen);

/** "3:07" or "1:02:03" */
const fmtDur = (ms) => { const n = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(n / 3600); const m = Math.floor(n / 60) % 60; const x = n % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
/** How long the agent has been working / waiting / how long its last turn took. */
function timerText(s) {
  const c = s.info?.clock; if (!c) return '';
  const now = Date.now();
  if (s.status === 'running' && c.turnStarted) return t('working for {t}', { t: fmtDur(now - c.turnStarted) });
  if (s.status === 'needs-input') return t('waiting for you {t}', { t: fmtDur(now - c.since) });
  if (c.lastTurn != null && ['done', 'idle', 'blocked'].includes(s.status)) return t('done after {t}', { t: fmtDur(c.lastTurn) });
  return '';
}
function updateTimers() {
  for (const n of document.querySelectorAll('[data-timer]')) { const s = state.sessions.get(n.dataset.timer); const v = s ? timerText(s) : ''; if (n.textContent !== v) n.textContent = v; }
}
setInterval(updateTimers, 1000);

function sessionCard(s, board = false) {
  const [cls, label] = PILL[s.status] || ['', s.status];
  const detail = s.info?.detail ? t(s.info.detail) : '';
  const summary = detail || s.last || '';
  const progress = s.info?.progress;
  const card = el('li', { class: `card ${board ? 'bc' : ''} ${s.id === state.selected ? 'sel' : ''} ${needsAttention(s) ? 'attn' : ''}`, 'data-id': s.id },
    el('span', { class: 'tile' }),
    el('div', { style: 'min-width:0' },
      el('div', { class: 'ttl' }, el('span', { class: 't' }, s.title), el('span', { class: `pill ${cls}` }, t(label))),
      el('div', { class: 's' }, board ? s.name : `${s.name} · ${s.directory}`),
      summary ? el('div', { class: 'sum' }, summary) : '',
      progress != null ? el('div', { class: 'prog', title: `${progress} %` }, el('span', { style: `width:${progress}%` })) : '',
      el('div', { class: 's meta' }, el('span', { class: 'tmr', 'data-timer': s.id }),
        `${s.sandboxed ? t('sandbox') : t('NO SANDBOX')} · ${ago(s.lastActivity || s.started)}`, s.restartPending ? ` · ${t('restart pending')}` : '')));
  card.firstChild.innerHTML = Icons.html(Icons.agent(s.kind), 16);
  card.addEventListener('click', () => select(s.id));
  card.addEventListener('contextmenu', (e) => { e.preventDefault(); sessionMenu(card, s); });
  return card;
}
function sessionMenu(anchor, s) {
  const items = [
    { label: t('Rename...'), icon: 'file-text', run: () => { const v = prompt(t('Name of the session'), s.title); if (v && v.trim()) window.hearth.rename(s.id, v.trim()); } },
    { label: t('Stop agent'), icon: 'stop', disabled: s.status === 'done' || s.status === 'failed', run: () => window.hearth.stop(s.id) },
    '-', { label: t('Close session'), icon: 'x', run: () => { if (confirm(t('Close "{name}"?', { name: `${s.name} - ${s.title}` }))) closeSession(s.id); } }];
  Layout.menu(anchor, items);
}

// ---------- list or board ----------
state.board = (() => { try { return localStorage.getItem('hearth.board') === '1'; } catch { return false; } })();
const BOARD_COLS = [['needs', 'Needs you', (s) => s.status === 'needs-input' || s.status === 'blocked' || s.status === 'failed'],
  ['working', 'Working', (s) => s.status === 'running' || s.status === 'starting'], ['done', 'Done', (s) => s.status === 'done'], ['idle', 'Idle', (s) => s.status === 'idle']];
function setBoard(on) {
  state.board = on; try { localStorage.setItem('hearth.board', on ? '1' : '0'); } catch { /* private mode */ }
  document.querySelectorAll('#view-seg button').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'board') === on));
  renderInbox();
}
document.querySelectorAll('#view-seg button').forEach((b) => b.addEventListener('click', () => setBoard(b.dataset.mode === 'board')));
function renderBoard(list) {
  const box = $('#board');
  const live = list.filter((s) => !(s.status === 'done' && s.exited) && s.status !== 'failed' || needsAttention(s));
  const wide = $('#view-sessions').clientWidth > 620;
  box.classList.toggle('wide', wide);
  const cols = BOARD_COLS.map(([key, title, test]) => [key, title, live.filter(test)]).filter(([, , items]) => wide || items.length);
  swapIfChanged(box, cols.map(([key, title, items]) => el('div', { class: `bcol ${key}` },
    el('div', { class: 'sec' }, el('span', {}, t(title)), el('span', { class: 'cnt' }, String(items.length))),
    el('ul', { class: 'cards' }, ...items.map((s) => sessionCard(s, true))))));
  const ended = list.filter((s) => (s.exited || s.status === 'failed') && !needsAttention(s));
  swapIfChanged($('#session-list'), ended.map((s) => sessionCard(s)));
  $('#ended-sec').hidden = !ended.length;
}
new ResizeObserver(() => requestAnimationFrame(() => { if (state.board) renderInbox(); })).observe($('#view-sessions'));

/** Replace a list's cards only when their content changed: a status line that says the same must not make the list flash. */
function swapIfChanged(listEl, nodes) {
  const sig = nodes.map((n) => n.outerHTML).join('');
  if (listEl.dataset.sig === sig) return false;
  listEl.dataset.sig = sig;
  const scroller = listEl.closest('#inbox-scroll'); const top = scroller ? scroller.scrollTop : 0;
  listEl.replaceChildren(...nodes);
  if (scroller) scroller.scrollTop = top;
  return true;
}

function renderInbox() {
  const list = [...state.sessions.values()].sort((a, b) => b.started - a.started);
  const attn = list.filter(needsAttention);
  const rest = list.filter((s) => !needsAttention(s));
  $('#board').hidden = !state.board;
  if (state.board) { $('#attn-wrap').hidden = true; renderBoard(list); } else {
    $('#ended-sec').hidden = true;
    $('#attn-wrap').hidden = attn.length === 0;
    $('#attn-count').textContent = String(attn.length);
    $('#attn-sub').textContent = t('{n} sessions with activity, results, questions or errors.', { n: attn.length });
    swapIfChanged($('#attn-list'), attn.map((s) => sessionCard(s)));
    swapIfChanged($('#session-list'), rest.map((s) => sessionCard(s)));
  }
  updateTimers();
  const active = list.filter((s) => s.status === 'running' || s.status === 'starting').length;
  $('#agents-count').textContent = list.length ? `(${t('{n} active', { n: active })})` : '';
  $('#empty-inbox').hidden = list.length > 0;
  $('#empty').hidden = list.length > 0 ? true : false;
  const sel = cur();
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
  const st = $('#ch-status'); st.className = `pill ${cls}`; st.textContent = t(label); st.title = s.info?.detail ? t(s.info.detail) : '';
  $('#ch-timer').dataset.timer = s.id;
  const sb = $('#ch-sandbox'); sb.className = `pill ${s.sandboxed ? 'ok' : 'raw'}`; sb.innerHTML = Icons.html('shield', 12) + (s.sandboxed ? t('sandbox') : t('NO SANDBOX'));
  $('#ch-stop').disabled = s.status === 'done' || s.status === 'failed';
  $('#login-hint').hidden = !(s.login && s.status !== 'done' && s.status !== 'failed');
}
$('#ch-stop').addEventListener('click', () => { const s = cur(); if (s) window.hearth.stop(s.id); });
$('#btn-start2').addEventListener('click', () => $('#btn-start').click());
setInterval(() => { if (state.sessions.size) renderInbox(); }, 30000);   // "2 min ago" stays current

function select(id) {
  state.selected = id;
  for (const [tid, term] of state.terms) term.host.classList.toggle('active', tid === id);
  const s = cur();
  window.hearth.selected(id);
  if (s) { s.seen = true; loadTree(s.directory); }
  renderInbox();
  fitCurrent();
  fire('hearth:select', s);
  setTimeout(focusTerminal, 80);
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
  const term = new Terminal({ fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: BASE_FONT + state.zoom + (state.paneZoom.agent || 0), cursorBlink: true, scrollback: 10000, theme: Themes.terminalTheme() });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  // Links in the output (also long ones that wrap, and OSC 8 hyperlinks like Claude's sign-in link) open in the browser on click:
  // the sandboxed agent cannot open a browser itself.
  const openLink = (uri) => window.hearth.open(uri).catch((err) => alert(errMsg(err)));
  term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => openLink(uri)));
  term.options.linkHandler = { activate: (_e, uri) => openLink(uri), allowNonHttpProtocols: false };
  // Copy and paste like Windows Terminal (Ctrl+C copies a selection, right-click copies or pastes).
  const copySelection = async () => { const sel = term.getSelection(); if (!sel) return; await window.hearth.clipboard.write(TermKeys.cleanCopy(sel)); term.clearSelection(); toast(t('Copied')); };
  const pasteClipboard = async () => {
    const text = await window.hearth.clipboard.read();
    if (!text) { toast(t('The clipboard is empty')); return; }
    // A sign-in run waits for the code from the browser page. The link is still in the clipboard after copying it from the
    // terminal, and pasting that gives "That code wasn't accepted": stop it here.
    let odd = false;
    if (s.login && s.status !== 'done' && s.status !== 'failed') {
      const kind = TermKeys.classifySignInPaste(text);
      if (kind === 'link') { toast(t('That is the sign-in link, not the code. Open the link in your browser, sign in, press "Copy code" on that page, then paste again.')); return; }
      odd = kind === 'odd';
    }
    if (TermKeys.needsConfirm(text) && !confirm(t('Paste {n} lines into the terminal?', { n: text.replace(/[\r\n]+$/, '').split(/\r?\n/).length }))) return;
    term.paste(text);
    term.focus();
    // Some prompts (the sign-in code of an agent) show nothing while you paste: say that it arrived.
    const n = text.replace(/[\r\n]+$/, '').length;
    toast(odd ? t('Pasted {n} characters, but this does not look like the sign-in code (it looks like abc123...#xyz456...). Check the page in your browser.', { n }) : t('Pasted {n} characters. Some prompts do not show them; press Enter to send.', { n }));
  };
  term.attachCustomKeyEventHandler((e) => {
    const a = TermKeys.action(e, term.hasSelection());
    if (a === 'pass') return true;
    e.preventDefault();
    if (a === 'search') fire('hearth:search'); else if (a === 'copy') copySelection(); else pasteClipboard();
    return false;
  });
  host.addEventListener('contextmenu', (e) => { e.preventDefault(); if (term.hasSelection()) copySelection(); else pasteClipboard(); });
  // A click anywhere in the pane (also on its padding) puts the cursor into the terminal, so typing and Ctrl+V work.
  host.addEventListener('mousedown', () => setTimeout(() => { if (!term.hasSelection()) term.focus(); }, 0));
  s.focusTerminal = () => term.focus();
  term.onData((d) => window.hearth.input(s.id, d));
  term.onResize(({ cols, rows }) => window.hearth.resize(s.id, cols, rows));
  state.terms.set(s.id, { term, fit, host });
}
/** Give the keyboard to the selected session's terminal (when nothing else, like a dialog or an input, has it). */
// After a native alert / confirm Electron leaves the window without keyboard focus (typing then does nothing).
for (const name of ['alert', 'confirm']) {
  const native = window[name].bind(window);
  window[name] = (...a) => { const prev = document.activeElement; const r = native(...a); window.hearth.refocus().then(() => { if (prev && prev.isConnected && prev !== document.body) prev.focus(); else focusTerminal(); }); return r; };
}
function focusTerminal() {
  const t0 = state.terms.get(state.selected);
  const a = document.activeElement;
  const free = !a || a === document.body || a.id === 'tree' || a.classList?.contains('xterm-helper-textarea');
  if (t0 && free && !document.querySelector('dialog[open]') && Layout.isActive('agent')) t0.term.focus();
}
// Coming back from the browser (sign-in!) the window has the focus but no element does: Ctrl+V would go nowhere.
window.addEventListener('focus', () => setTimeout(focusTerminal, 50));
document.addEventListener('hearth:tab', (e) => { if (e.detail === 'agent') setTimeout(focusTerminal, 50); });
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
window.hearth.onStatus(({ id, status, info }) => {
  const s = state.sessions.get(id); if (!s) return;
  const was = s.status; s.status = status; s.info = info;
  if (status !== 'done') s.exited = false;
  if (id === state.selected && status === 'done' && document.hasFocus() && Layout.isActive('agent')) s.seen = true;
  else if (status === 'done' && was !== 'done') s.seen = false;
  renderInbox(); notify(s, was); fire('hearth:status', s);
});
window.hearth.onInfo((p) => { const s = state.sessions.get(p.id); if (!s) return; Object.assign(s, { title: p.title, info: p.info, restartPending: p.restartPending, sessionID: p.sessionID, sandboxed: p.sandboxed }); s.status = p.status; renderInbox(); });
window.hearth.onExit(({ id, code, error }) => {
  const s = state.sessions.get(id);
  state.terms.get(id)?.term.write(`\r\n\x1b[2m[${t('process exited with code {code}', { code })}${error ? ': ' + error : ''}]\x1b[0m\r\n`);
  if (s) { s.status = code === 0 ? 'done' : 'failed'; s.exited = true; if (id === state.selected && code === 0) s.seen = true; renderInbox(); fire('hearth:status', s); }
});
/** Types a prompt into the agent of the selected (or given) session and submits it. */
async function sendToAgent(text, id = state.selected) {
  const s = state.sessions.get(id);
  if (!s || s.exited) { alert(t('Start an agent first: the request goes to the agent of the selected session.')); return false; }
  try { await window.hearth.prompt(id, text); showCenter('agent'); return true; } catch (err) { alert(errMsg(err)); return false; }
}
window.sendToAgent = sendToAgent;
function notify(s, was) {
  const attention = ['needs-input', 'done', 'blocked'].includes(s.status) && was !== s.status && !s.login;
  if (!attention || document.hasFocus() || !('Notification' in window)) return;
  const title = s.status === 'needs-input' ? t('{name} needs you', { name: s.name }) : s.status === 'done' ? t('{name} is done', { name: s.name }) : t('{name} reports an error', { name: s.name });
  const fireIt = () => { const n = new Notification(title, { body: s.info?.detail ? `${s.title}: ${t(s.info.detail)}` : s.title }); n.onclick = () => { window.focus(); select(s.id); showCenter('agent'); }; };
  if (Notification.permission === 'granted') fireIt(); else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && fireIt());
}

// ---------- welcome screen: recent folders (click: continue the last conversation, +: new session) ----------
async function drawWelcome() {
  const box = $('#welcome-recent'); if (!box) return;
  const items = (await window.hearth.history.list().catch(() => [])).slice(0, 6);
  const agents = await window.hearth.agents();
  const name = (k) => agents.find((a) => a.id === k)?.name || k;
  const go = async (x, mode) => {
    const resume = mode === 'continue' ? (await window.hearth.history.sessions(x.kind, x.directory).catch(() => []))[0] : null;
    const options = await window.hearth.history.options(x.directory).catch(() => ({}));
    try {
      const s = await window.hearth.start({ kind: x.kind, directory: x.directory, resumeID: resume?.sessionID, continueLast: mode === 'continue' && !resume && Boolean(AGENT_CONTINUE[x.kind]), options });
      state.sessions.set(s.id, s); attachTerminal(s); select(s.id); showCenter('agent');
    } catch (err) { alert(errMsg(err)); }
  };
  box.replaceChildren(...(items.length ? [el('div', { class: 'hint' }, t('Recent sessions'))] : []), ...items.map((x) => {
    const row = el('div', { class: 'recent-row', title: t('Continue the last conversation in this folder') + '\n' + x.directory }, el('span', { class: 'rn' }, x.title), el('small', { class: 'hint' }, name(x.kind)));
    row.addEventListener('click', () => go(x, AGENT_CONTINUE[x.kind] ? 'continue' : 'new'));
    const plus = el('button', { type: 'button', class: 'ib', title: t('New session') }); plus.innerHTML = Icons.html('plus', 13);
    plus.addEventListener('click', (e) => { e.stopPropagation(); go(x, 'new'); });
    row.append(plus); return row;
  }));
}
document.addEventListener('hearth:lang', drawWelcome);

// ---------- start dialog ----------
async function openStart() {
  const sel = $('#start-kind');
  if (!sel.options.length) for (const a of await window.hearth.agents()) sel.append(el('option', { value: a.id }, a.name));
  $('#start-login').parentElement.hidden = false;
  await drawRecent();
  updateHint();
  $('#dlg-start').showModal();
}
/** Sessions of earlier runs: pick one to come back to that folder (and its last conversation). */
async function drawRecent() {
  const box = $('#start-recent'); const items = (await window.hearth.history.list()).slice(0, 6);
  const names = Object.fromEntries((await window.hearth.agents()).map((a) => [a.id, a.name]));
  box.hidden = !items.length;
  box.replaceChildren(...(items.length ? [el('div', { class: 'hint' }, t('Recent sessions'))] : []), ...items.map((x) => {
    const row = el('div', { class: 'recent-row', title: x.directory }, el('span', { class: 'rn' }, x.title), el('small', { class: 'hint' }, `${names[x.kind] || x.kind} - ${new Date(x.last).toLocaleDateString(I18n.lang === 'de' ? 'de-DE' : 'en-GB')}`));
    row.addEventListener('click', async () => { $('#start-kind').value = x.kind; $('#start-source').value = 'folder'; $('#start-dir').value = x.directory; await updateHint(); const sel = $('#start-session'); if (sel.options.length > 1) sel.selectedIndex = 1; });
    const del = el('button', { type: 'button', class: 'ib x', title: t('Remove from list') }); del.innerHTML = Icons.html('x', 12);
    del.addEventListener('click', async (e) => { e.stopPropagation(); await window.hearth.history.forget(x.kind, x.directory); drawRecent(); });
    row.append(del); return row;
  }));
}
const AGENT_CONTINUE = { claude: true, codex: true };

/** "New session", "Continue the last conversation" and the conversations Hearth knows for this agent and folder. */
async function drawSessionChoice() {
  const kind = $('#start-kind').value; const dir = $('#start-dir').value; const sel = $('#start-session');
  const known = dir && $('#start-source').value === 'folder' ? await window.hearth.history.sessions(kind, dir).catch(() => []) : [];
  const opts = [el('option', { value: 'new' }, t('New session'))];
  if (AGENT_CONTINUE[kind] && dir) opts.push(el('option', { value: 'continue' }, t('Continue the last conversation in this folder')));
  for (const x of known) opts.push(el('option', { value: 'id:' + x.sessionID }, `${x.title} - ${new Date(x.last).toLocaleString(I18n.lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}`));
  sel.replaceChildren(...opts);
  $('#row-session').hidden = opts.length < 2;
}
/** Model and reasoning effort (Claude Code: model + effort, Codex: effort); the last choice per folder is preselected. */
async function drawModelChoice() {
  const kind = $('#start-kind').value; const a = (await window.hearth.agents()).find((x) => x.id === kind) || {};
  const last = $('#start-dir').value ? await window.hearth.history.options($('#start-dir').value).catch(() => ({})) : {};
  const fill = (sel, values, chosen, labels = {}) => { sel.replaceChildren(el('option', { value: '' }, t('Default')), ...values.map((v) => el('option', { value: v }, labels[v] || v))); sel.value = values.includes(chosen) ? chosen : ''; };
  fill($('#start-model'), a.models || [], last.model, { sonnet: 'Sonnet', haiku: 'Haiku', opus: 'Opus', fable: 'Fable' });
  fill($('#start-effort'), a.efforts || [], last.effort);
  $('#lbl-model').hidden = !(a.models || []).length; $('#lbl-effort').hidden = !(a.efforts || []).length;
  $('#row-model').hidden = !(a.models || []).length && !(a.efforts || []).length;
}

async function updateHint() {
  const agents = await window.hearth.agents();
  const a = agents.find((x) => x.id === $('#start-kind').value);
  $('#start-login').parentElement.hidden = !(a && a.login);
  await Promise.all([drawSessionChoice(), drawModelChoice()]);
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
$('#btn-pick').addEventListener('click', async () => { const d = await window.hearth.pickFolder(); if (d) { $('#start-dir').value = d; updateHint(); } });
$('#btn-go').addEventListener('click', async (e) => {
  const kind = $('#start-kind').value; const directory = $('#start-dir').value;
  const clone = $('#start-source').value === 'clone';
  if (!directory || (clone && !$('#start-url').value.trim())) { e.preventDefault(); return; }
  const choice = $('#row-session').hidden ? 'new' : $('#start-session').value;
  const login = $('#start-login').checked;
  try {
    const s = await window.hearth.start({ kind, directory, login, continueLast: choice === 'continue' && !login, resumeID: choice.startsWith('id:') && !login ? choice.slice(3) : undefined,
      options: { model: $('#start-model').value || null, effort: $('#start-effort').value || null }, cloneUrl: clone ? $('#start-url').value.trim() : undefined });
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

// ---------- file tree: see tree.js ----------

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
      EditorLang.api = EditorLang.setup(monaco, () => cur()?.directory);
      // VS Code feel: minimap, bracket colours and guides, sticky scroll, smooth caret, suggestions while typing
      state.editor = monaco.editor.create($('#monaco'), {
        value: '', language: 'plaintext', theme: Themes.monacoTheme(monaco), automaticLayout: true, fontSize: BASE_FONT + state.zoom + (state.paneZoom.editor || 0),
        fontFamily: "'Cascadia Code', 'Azeret Mono', Consolas, monospace", lineHeight: 0, minimap: { enabled: true, renderCharacters: false, scale: 1 },
        bracketPairColorization: { enabled: true }, guides: { bracketPairs: 'active', indentation: true }, stickyScroll: { enabled: true }, smoothScrolling: true,
        cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on', renderWhitespace: 'selection', renderLineHighlight: 'all', folding: true, showFoldingControls: 'mouseover',
        linkedEditing: true, formatOnPaste: true, formatOnType: true, autoClosingBrackets: 'languageDefined', autoClosingQuotes: 'languageDefined', autoSurround: 'languageDefined',
        quickSuggestions: { other: true, comments: false, strings: true }, suggestOnTriggerCharacters: true, acceptSuggestionOnEnter: 'on', tabCompletion: 'on', snippetSuggestions: 'top',
        suggest: { preview: true, showStatusBar: true, showIcons: true, showWords: true, insertMode: 'replace' }, parameterHints: { enabled: true, cycle: true },
        wordBasedSuggestions: 'currentDocument', inlayHints: { enabled: 'on' }, occurrencesHighlight: 'singleFile', matchBrackets: 'always', scrollBeyondLastLine: false,
        padding: { top: 6 }, mouseWheelZoom: false, multiCursorModifier: 'alt', dragAndDrop: true, emptySelectionClipboard: true, copyWithSyntaxHighlighting: true, tabSize: 4, detectIndentation: true,
      });
      state.editor.onDidChangeModelContent(() => { const d = state.docs.get(state.active); if (d && !d.loading) { d.dirty = true; renderDocs(); scheduleAutosave(state.active); } });
      state.editor.onDidBlurEditorText(() => { if (autosaveMode() === 'onFocusChange') saveDoc(state.active, true); });
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
  Layout.badge('editor', d ? base(state.active) : '');
}

function activateDoc(file) {
  if (state.active && state.active !== file && autosaveMode() !== 'off') saveDoc(state.active, true);
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
  if (d.dirty && autosaveMode() !== 'off') { saveDoc(file, true).then(() => { if (state.docs.get(file) && !state.docs.get(file).dirty) closeDoc(file); }); return; }
  if (d.dirty && !confirm(t('Discard unsaved changes?'))) return;
  clearTimeout(d.autoTimer);
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
/** Write one open file. `auto` (autosave): no dialog on errors, the status line shows them instead. */
async function saveDoc(file, auto = false) {
  const d = state.docs.get(file);
  if (!d || !d.dirty || d.saving) return;
  clearTimeout(d.autoTimer);
  const version = d.model.getAlternativeVersionId();
  d.saving = true;
  try {
    await window.hearth.write(file, d.model.getValue());
    if (d.model.isDisposed()) return;
    d.dirty = d.model.getAlternativeVersionId() !== version;   // typed on while writing: stays modified
    d.status = `${file} - ${auto ? t('saved automatically') : t('saved')}`; renderDocs(); fire('hearth:saved', file);
  } catch (err) { if (!auto) alert(errMsg(err)); d.status = errMsg(err); renderDocs(); }
  finally { d.saving = false; if (d.dirty && auto) scheduleAutosave(file); }
}
function saveFile() { return saveDoc(state.active); }
// ---------- autosave (Settings > General): after a short pause, or when the editor loses focus ----------
const autosaveMode = () => state.settings?.autosave || 'off';
function scheduleAutosave(file) {
  const d = state.docs.get(file);
  if (!d || autosaveMode() !== 'afterDelay') return;
  clearTimeout(d.autoTimer);
  d.autoTimer = setTimeout(() => saveDoc(file, true), 1000);
}
function autosaveAll() { if (autosaveMode() !== 'off') for (const file of state.docs.keys()) saveDoc(file, true); }
window.addEventListener('blur', autosaveAll);
$('#btn-save').addEventListener('click', saveFile);

// ---------- zoom (Ctrl +/-/0) ----------
function applyZoom() {
  for (const { term, fit } of state.terms.values()) { term.options.fontSize = BASE_FONT + state.zoom + (state.paneZoom.agent || 0); try { fit.fit(); } catch { /* hidden */ } }
  state.editor?.updateOptions({ fontSize: BASE_FONT + state.zoom + (state.paneZoom.editor || 0) });
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


document.addEventListener('hearth:lang', () => { renderInbox(); if (state.env) showSandboxState(); });

// ---------- startup ----------
(async () => {
  hydrateIcons();
  Layout.init();
  state.settings = await window.hearth.getSettings();
  Themes.onChange((_name, p) => {
    for (const { term } of state.terms.values()) term.options.theme = Themes.terminalTheme();
    window.hearth.setTitleBar(p.window, p.editorForeground);       // native caption buttons follow the theme
  });
  Themes.apply(state.settings.theme);
  I18n.set(state.settings.language);
  await showSandboxState();
  renderInbox();
  drawWelcome();
  fire('hearth:ready');
})();
