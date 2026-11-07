'use strict';
// File browser: select, copy / cut / paste, drag & drop (move; Ctrl = copy), rename, new file / folder, delete (recycle bin).
// Folders are loaded when opened; after every change only the affected folders are reloaded, and opened folders stay open.
const FT = { root: null, open: new Set(), dirs: new Map(), nodes: new Map(), sel: new Set(), anchor: null, clip: null };
const dirOf = (p) => String(p).replace(/[\\/][^\\/]*$/, '');
const sameOrUnder = (p, parent) => { const a = p.toLowerCase(); const b = parent.toLowerCase(); return a === b || a.startsWith(b + '\\') || a.startsWith(b + '/'); };

async function loadTree(root) {
  const host = $('#tree');
  if (FT.root !== root) { FT.open = new Set([root]); FT.sel.clear(); FT.anchor = null; FT.clip = null; }
  FT.root = root; FT.dirs.clear(); FT.nodes.clear();
  host.setAttribute('tabindex', '0');
  host.replaceChildren(await dirNode(root));
}

async function fillDir(dir, children) {
  let entries;
  try { entries = await window.hearth.list(dir); } catch (err) { children.replaceChildren(el('div', { class: 'hint' }, errMsg(err))); return; }
  const nodes = [];
  for (const e of entries) nodes.push(e.dir ? await dirNode(e.path) : fileNode(e));
  children.replaceChildren(...nodes);
}

function fileNode(e) {
  const n = el('div', { class: 'node', draggable: 'true' }, el('span', { class: 'caret' }), el('span', { class: 'ico' }), el('span', { class: 'name' }, e.name));
  n.children[1].innerHTML = Icons.html(Icons.forFile(e.name), 15);
  n.dataset.path = e.path; n.dataset.dir = '0';
  FT.nodes.set(e.path, n); paint(n);
  return n;
}

async function dirNode(dir) {
  const wrap = el('div');
  const children = el('div', { class: 'children' });
  const caret = el('span', { class: 'caret' }); const folder = el('span', { class: 'ico' });
  const label = el('div', { class: 'node dir', draggable: FT.root === dir ? 'false' : 'true' }, caret, folder, el('span', { class: 'name' }, base(dir) || dir));
  label.dataset.path = dir; label.dataset.dir = '1';
  let loaded = false;
  const setOpen = async (open) => {
    if (open) FT.open.add(dir); else FT.open.delete(dir);
    caret.innerHTML = Icons.html(open ? 'chevron-down' : 'chevron-right', 13);
    folder.innerHTML = Icons.html(open ? 'folder-open' : 'folder', 15);
    children.hidden = !open;
    if (open && !loaded) { loaded = true; await fillDir(dir, children); }
  };
  FT.dirs.set(dir, { setOpen, reload: async () => { if (loaded) await fillDir(dir, children); } });
  FT.nodes.set(dir, label); paint(label);
  wrap.append(label, children);
  children.hidden = true;
  if (FT.open.has(dir)) await setOpen(true); else await setOpen(false);
  return wrap;
}

/** Selection / cut look of one node. */
function paint(n) {
  const p = n.dataset.path;
  n.classList.toggle('sel', FT.sel.has(p));
  n.classList.toggle('cut', Boolean(FT.clip && FT.clip.cut && FT.clip.paths.includes(p)));
}
const repaint = () => { for (const n of FT.nodes.values()) paint(n); };

function selectNode(p, ev) {
  if (ev && (ev.ctrlKey || ev.metaKey)) { if (FT.sel.has(p)) FT.sel.delete(p); else FT.sel.add(p); }
  else if (ev && ev.shiftKey && FT.anchor) {
    const all = [...$('#tree').querySelectorAll('.node')].map((n) => n.dataset.path);
    const a = all.indexOf(FT.anchor); const b = all.indexOf(p);
    if (a >= 0 && b >= 0) { FT.sel = new Set(all.slice(Math.min(a, b), Math.max(a, b) + 1)); }
  } else FT.sel = new Set([p]);
  if (!ev || !ev.shiftKey) FT.anchor = p;
  repaint();
}

/** Where "new" and "paste" go: the selected folder, the folder of the selected file, else the root. */
function targetDir() {
  const p = [...FT.sel][0];
  if (!p) return FT.root;
  return FT.nodes.get(p)?.dataset.dir === '1' ? p : dirOf(p);
}
const topLevel = (paths) => paths.filter((p) => !paths.some((q) => q !== p && sameOrUnder(p, q)));

// ---- open editor tabs follow renames / moves / deletes ----
function movedPath(f, from, to) { if (f.toLowerCase() === from.toLowerCase()) return to; return sameOrUnder(f, from) ? to + f.slice(from.length) : f; }
function remapDocs(from, to) {
  if (![...state.docs.keys()].some((f) => sameOrUnder(f, from))) return;
  const next = new Map();
  for (const [f, d] of state.docs) {
    const nf = movedPath(f, from, to);
    if (nf !== f && window.monaco) monaco.editor.setModelLanguage(d.model, langOf(nf));
    next.set(nf, d);
  }
  state.docs = next;
  if (state.active) state.active = movedPath(state.active, from, to);
  renderDocs();
}
function dropDocs(path) {
  for (const f of [...state.docs.keys()].filter((x) => sameOrUnder(x, path))) {
    state.docs.get(f).model.dispose(); state.docs.delete(f);
    if (state.active === f) state.active = null;
  }
  if (!state.active) {
    const next = [...state.docs.keys()].pop();
    if (next) activateDoc(next); else if (state.editor) { state.editor.setModel(monaco.editor.createModel('', 'plaintext')); renderDocs(); }
  } else renderDocs();
}

// ---- operations ----
async function reloadDirs(dirs, openDir) {
  if (openDir) { FT.open.add(openDir); await FT.dirs.get(openDir)?.setOpen(true); }
  for (const d of new Set(dirs)) await FT.dirs.get(d)?.reload();
  repaint();
}
async function transfer(paths, destDir, cut) {
  const touched = [destDir]; const done = [];
  for (const p of topLevel(paths)) {
    try {
      if (cut) { const to = await window.hearth.files.move(p, destDir); if (to !== p) { touched.push(dirOf(p)); remapDocs(p, to); } done.push(to); }
      else done.push(await window.hearth.files.copy(p, destDir));
    } catch (err) { toast(errMsg(err)); }
  }
  if (cut) FT.clip = null;
  await reloadDirs(touched, destDir);
  FT.sel = new Set(done); repaint();
}
const copySelection = (cut) => { const paths = [...FT.sel]; if (!paths.length) return; FT.clip = { paths, cut }; repaint(); toast(t(cut ? '{n} item(s) cut' : '{n} item(s) copied', { n: paths.length })); };
async function pasteInto(dir) { if (!FT.clip) return; const c = FT.clip; await transfer(c.paths, dir, c.cut); }

async function trashSelection() {
  const paths = topLevel([...FT.sel].filter((p) => p !== FT.root));
  if (!paths.length) return;
  if (!confirm(paths.length === 1 ? t('Move "{name}" to the Recycle Bin?', { name: base(paths[0]) }) : t('Move {n} items to the Recycle Bin?', { n: paths.length }))) return;
  const touched = [];
  for (const p of paths) {
    try { await window.hearth.files.trash(p); touched.push(dirOf(p)); dropDocs(p); } catch (err) { toast(errMsg(err)); }
  }
  FT.sel.clear();
  await reloadDirs(touched);
}

/** A text field inside the tree: Enter confirms, Esc or leaving it cancels. */
function nameInput(initial, commit, cancel) {
  const input = el('input', { class: 'tree-input', spellcheck: 'false' });
  input.value = initial;
  let finished = false;
  const end = (ok) => { if (finished) return; finished = true; if (ok && input.value.trim() && input.value.trim() !== initial) commit(input.value.trim()); else cancel(); };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') end(true); else if (e.key === 'Escape') end(false); });
  input.addEventListener('blur', () => end(false));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  return input;
}
function renameSelection() {
  const p = [...FT.sel][0];
  if (!p || p === FT.root) return;
  const node = FT.nodes.get(p); const name = node.querySelector('.name');
  const input = nameInput(base(p), async (value) => {
    try { const to = await window.hearth.files.rename(p, value); remapDocs(p, to); FT.sel = new Set([to]); await reloadDirs([dirOf(p)]); }
    catch (err) { toast(errMsg(err)); finish(); }
  }, () => finish());
  const finish = () => { input.remove(); name.hidden = false; };
  name.hidden = true; name.after(input); input.focus();
  const dot = base(p).lastIndexOf('.'); input.setSelectionRange(0, dot > 0 && node.dataset.dir === '0' ? dot : input.value.length);
}
async function createIn(dir, folder) {
  await reloadDirs([], dir);
  const host = FT.dirs.get(dir) && FT.nodes.get(dir).nextElementSibling;
  if (!host) return;
  const ico = el('span', { class: 'ico' }); ico.innerHTML = Icons.html(folder ? 'folder' : 'file', 15);
  const row = el('div', { class: 'node' }, el('span', { class: 'caret' }), ico);
  const done = () => row.remove();
  const input = nameInput('', async (value) => {
    try {
      const to = await window.hearth.files.create(dir, value, folder);
      done(); await reloadDirs([dir]); FT.sel = new Set([to]); repaint();
      if (!folder) openFile(to);
    } catch (err) { toast(errMsg(err)); done(); }
  }, done);
  row.append(input); host.prepend(row); input.focus();
}

// ---- context menu ----
let ctx = null;
function closeCtx() { ctx?.remove(); ctx = null; }
function showCtx(x, y, items) {
  closeCtx();
  const m = el('div', { class: 'menu' });
  for (const it of items) {
    if (it === '-') { m.append(el('div', { class: 'sep' })); continue; }
    const b = el('button', { class: 'mi' }, el('span', {}, it.label), el('span', { class: 'key' }, it.key || ''));
    if (it.disabled) b.disabled = true;
    b.addEventListener('click', () => { closeCtx(); it.run(); });
    m.append(b);
  }
  document.body.append(m);
  m.style.left = `${Math.max(8, Math.min(x, window.innerWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(y, window.innerHeight - m.offsetHeight - 8))}px`;
  ctx = m;
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { closeCtx(); document.removeEventListener('mousedown', off); } }), 0);
}
function treeMenu(e) {
  e.preventDefault();
  const node = e.target.closest('.node');
  if (node && !FT.sel.has(node.dataset.path)) selectNode(node.dataset.path);
  if (!node) { FT.sel.clear(); repaint(); }
  const p = node?.dataset.path; const isDir = node ? node.dataset.dir === '1' : true;
  const dir = node ? (isDir ? p : dirOf(p)) : FT.root;
  const isRoot = p === FT.root;
  const items = [
    { label: t('New file'), run: () => createIn(dir, false) }, { label: t('New folder'), run: () => createIn(dir, true) }, '-',
    { label: t('Cut'), key: 'Ctrl+X', disabled: !p || isRoot, run: () => copySelection(true) },
    { label: t('Copy'), key: 'Ctrl+C', disabled: !p || isRoot, run: () => copySelection(false) },
    { label: t('Paste'), key: 'Ctrl+V', disabled: !FT.clip, run: () => pasteInto(dir) },
    { label: t('Duplicate'), disabled: !p || isRoot, run: async () => { for (const q of topLevel([...FT.sel])) { try { await window.hearth.files.copy(q, dirOf(q)); } catch (err) { toast(errMsg(err)); } } await reloadDirs([...FT.sel].map(dirOf)); } }, '-',
    { label: t('Rename'), key: 'F2', disabled: !p || isRoot, run: renameSelection },
    { label: t('Delete'), key: 'Del', disabled: !p || isRoot, run: trashSelection }, '-',
    { label: t('Copy path'), disabled: !p, run: () => window.hearth.clipboard.write(p) },
    { label: t('Show in Explorer'), disabled: !p, run: () => window.hearth.files.reveal(p) },
  ];
  showCtx(e.clientX, e.clientY, items);
}

// ---- wiring (once) ----
(() => {
  const host = $('#tree');
  host.addEventListener('click', async (e) => {
    const node = e.target.closest('.node');
    if (!node || e.target.closest('.tree-input')) return;
    const p = node.dataset.path;
    selectNode(p, e);
    if (e.ctrlKey || e.shiftKey) return;
    if (node.dataset.dir === '1') { const d = FT.dirs.get(p); d && await d.setOpen(!FT.open.has(p)); }
    else openFile(p);
  });
  host.addEventListener('contextmenu', treeMenu);
  host.addEventListener('keydown', (e) => {
    if (e.target.closest('.tree-input')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(false); }
    else if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); copySelection(true); }
    else if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteInto(targetDir()); }
    else if (e.key === 'F2') { e.preventDefault(); renameSelection(); }
    else if (e.key === 'Delete') { e.preventDefault(); trashSelection(); }
    else if (e.key === 'Enter') { const p = [...FT.sel][0]; if (p && FT.nodes.get(p)?.dataset.dir === '0') openFile(p); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = [...host.querySelectorAll('.node')].filter((n) => n.offsetParent);
      const i = all.findIndex((n) => n.dataset.path === [...FT.sel][0]);
      const n = all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n) { selectNode(n.dataset.path); n.scrollIntoView({ block: 'nearest' }); }
    }
  });

  // drag & drop: move into a folder; with Ctrl pressed: copy
  let over = null;
  const clearOver = () => { over?.classList.remove('drop'); over = null; };
  const dropTarget = (e) => { const n = e.target.closest('.node'); return n ? (n.dataset.dir === '1' ? n : FT.nodes.get(dirOf(n.dataset.path))) : FT.nodes.get(FT.root); };
  host.addEventListener('dragstart', (e) => {
    const node = e.target.closest('.node'); if (!node) return;
    if (!FT.sel.has(node.dataset.path)) selectNode(node.dataset.path);
    e.dataTransfer.setData('application/x-hearth-paths', JSON.stringify([...FT.sel]));
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  host.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-hearth-paths')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
    const t2 = dropTarget(e); if (t2 !== over) { clearOver(); over = t2; over?.classList.add('drop'); }
  });
  host.addEventListener('dragleave', (e) => { if (!host.contains(e.relatedTarget)) clearOver(); });
  host.addEventListener('drop', async (e) => {
    const raw = e.dataTransfer.getData('application/x-hearth-paths'); if (!raw) return;
    e.preventDefault();
    const target = dropTarget(e)?.dataset.path; clearOver();
    if (target) await transfer(JSON.parse(raw), target, !e.ctrlKey);
  });
  host.addEventListener('dragend', clearOver);
  document.addEventListener('hearth:saved', () => { /* a saved file can be new to the tree */ });
})();
