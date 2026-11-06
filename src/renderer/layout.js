'use strict';
// Pane layout: tab groups in a tree of splits (model: layout-model.js). Tabs can be dragged to another group
// (centre of a pane) or to a pane's edge (a new column / row, shown as a flame preview), panes can be split,
// maximised, closed and zoomed, dividers can be dragged. The layout is saved and restored.
(() => {
  const M = window.LayoutModel;
  const KEY = 'hearth.layout.v1';
  const DEF = {
    sessions: ['inbox', 'Sessions'], agent: ['sparkles', 'Agent'], editor: ['file-code', 'Editor'], files: ['folder', 'Files'], git: ['git-branch', 'Git'],
    overview: ['tree', 'Overview'], tests: ['flask', 'Tests'], arch: ['workflow', 'Architecture'], build: ['wrench', 'Build'], ci: ['activity', 'CI/CD'],
  };
  const FONT_VIEWS = new Set(['agent', 'editor']);   // these scale their font, the others use CSS zoom

  let tree = null;
  let maximized = null;
  let dragView = null;
  const roots = new Map();      // view name -> its DOM root (moved between panes, never recreated)
  const badges = new Map();
  const lastActive = new Map(); // group id -> active view at the last render
  let host; let parking;

  const icon = (name, size = 15) => { const s = document.createElement('span'); s.className = 'ico-wrap'; s.innerHTML = Icons.html(name, size); return s; };
  const title = (v) => t(DEF[v][1]);

  function load() {
    try { const raw = JSON.parse(localStorage.getItem(KEY)); const ok = raw && M.sanitize(raw); if (ok) return ok; } catch { /* first start or private mode */ }
    return M.defaultLayout();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(tree)); } catch { /* private mode */ } }
  function set(next, { keepMax = false } = {}) { tree = next; if (!keepMax && maximized && !M.findById(tree, maximized)) maximized = null; save(); render(); }

  // ---------- menu ----------
  let openMenu = null;
  function closeMenu() { openMenu?.remove(); openMenu = null; }
  function popMenu(anchor, items) {
    closeMenu();
    const m = el('div', { class: 'menu' });
    for (const it of items) {
      if (it === '-') { m.append(el('div', { class: 'sep' })); continue; }
      const b = el('button', { class: 'mi' }, it.icon ? icon(it.icon, 14) : el('span', { class: 'ico-wrap', style: 'width:14px' }), it.label);
      if (it.disabled) b.disabled = true;
      b.addEventListener('click', () => { closeMenu(); it.run(); });
      m.append(b);
    }
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = `${Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8)}px`;
    m.style.left = `${Math.max(8, Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - 8))}px`;
    openMenu = m;
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('mousedown', off); } }), 0);
  }

  // ---------- rendering ----------
  function render() {
    closeMenu();
    for (const r of roots.values()) parking.append(r);          // park the views so they survive rebuilding the panes
    for (const r of roots.values()) { r.classList.remove('active'); r.style.zoom = ''; }
    host.replaceChildren(build(tree));
    host.classList.toggle('has-max', Boolean(maximized));
    const now = new Map();
    for (const g of M.groups(tree)) {
      for (const v of g.views) {
        const r = roots.get(v); if (!r) continue;
        if (!FONT_VIEWS.has(v) && g.zoom) r.style.zoom = String(1 + 0.08 * g.zoom);
        document.dispatchEvent(new CustomEvent('hearth:zoom', { detail: { view: v, step: g.zoom } }));
      }
      if (g.active) {
        roots.get(g.active)?.classList.add('active');
        now.set(g.id, g.active);
        if (lastActive.get(g.id) !== g.active) document.dispatchEvent(new CustomEvent('hearth:tab', { detail: g.active }));
      }
    }
    lastActive.clear(); for (const [k, v] of now) lastActive.set(k, v);
  }

  function build(n) {
    if (n.type === 'group') return buildGroup(n);
    const box = el('div', { class: `split sp-${n.dir}`, 'data-id': n.id });
    n.children.forEach((c, i) => {
      const child = build(c);
      child.style.flex = `${n.sizes[i]} 1 0`;
      box.append(child);
      if (i < n.children.length - 1) box.append(gutter(n, i, box));
    });
    return box;
  }

  function gutter(n, i, box) {
    const g = el('div', { class: `gutter sp-${n.dir}`, role: 'separator' });
    g.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const base = tree;
      const row = n.dir === 'row';
      const size = row ? box.getBoundingClientRect().width : box.getBoundingClientRect().height;
      const start = row ? e.clientX : e.clientY;
      const a = g.previousElementSibling; const b = g.nextElementSibling;
      g.classList.add('drag'); document.body.classList.add(row ? 'rs-col' : 'rs-row');
      const move = (ev) => {
        const delta = ((row ? ev.clientX : ev.clientY) - start) / size;
        const next = M.resize(base, n.id, i, delta);
        const s = M.findById(next, n.id).sizes;
        a.style.flex = `${s[i]} 1 0`; b.style.flex = `${s[i + 1]} 1 0`;
        tree = next;
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        g.classList.remove('drag'); document.body.classList.remove('rs-col', 'rs-row');
        save();
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    g.addEventListener('dblclick', () => { const s = M.findById(tree, n.id).sizes; const pair = s[i] + s[i + 1]; tree = M.resize(tree, n.id, i, pair / 2 - s[i]); save(); render(); });
    return g;
  }

  function tabButton(g, v) {
    const compact = g.views.length > 4 && g.active !== v;
    const b = el('button', { class: `gtab ${g.active === v ? 'on' : ''} ${compact ? 'compact' : ''}`, draggable: 'true', 'data-view-tab': v, title: title(v) },
      icon(DEF[v][0], 15), el('span', { class: 'lbl' }, title(v)), el('span', { class: 'bdg' }, badges.get(v) || ''));
    b.addEventListener('click', () => { const t2 = M.clone(tree); M.findById(t2, g.id).active = v; set(t2); });
    b.addEventListener('auxclick', (e) => { if (e.button === 1) set(M.hideView(tree, v)); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); popMenu(b, [{ label: t('Close view'), icon: 'x', run: () => set(M.hideView(tree, v)) }]); });
    b.addEventListener('dragstart', (e) => {
      dragView = v;
      e.dataTransfer.setData('text/x-hearth-view', v); e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => document.body.classList.add('dragging'));
    });
    b.addEventListener('dragend', endDrag);
    return b;
  }

  function buildGroup(g) {
    const el0 = el('div', { class: `group ${g.id === maximized ? 'max' : ''} ${g.views.length === 1 && g.views[0] === 'sessions' ? 'side' : ''}`, 'data-id': g.id });
    const strip = el('div', { class: 'gstrip' });
    const tabs = el('div', { class: 'gtabs' }, ...g.views.map((v) => tabButton(g, v)));
    strip.append(tabs);
    const hidden = M.hiddenViews(tree);

    const act = (name, ic, label, run, cls = 'opt') => { const b = el('button', { class: `ib gbtn ${cls}`, title: label }); b.append(icon(ic, 15)); b.addEventListener('click', (e) => { e.stopPropagation(); run(b); }); return b; };
    const zoomMenu = (anchor) => popMenu(anchor, [
      { label: t('Larger text'), icon: 'plus', run: () => set(M.setZoom(tree, g.id, g.zoom + 1)) },
      { label: t('Smaller text'), icon: 'minimize', run: () => set(M.setZoom(tree, g.id, g.zoom - 1)) },
      { label: t('Reset text size'), icon: 'undo', disabled: !g.zoom, run: () => set(M.setZoom(tree, g.id, 0)) }]);
    const addMenu = (anchor) => popMenu(anchor, hidden.map((v) => ({ label: title(v), icon: DEF[v][0], run: () => set(M.moveView(tree, v, g.id, 'center')) })));
    const moreMenu = (anchor) => popMenu(anchor, [
      { label: t('Split right'), icon: 'split-h', run: () => set(M.splitGroup(tree, g.id, 'row')) },
      { label: t('Split down'), icon: 'split-v', run: () => set(M.splitGroup(tree, g.id, 'col')) },
      { label: g.id === maximized ? t('Restore size') : t('Maximize'), icon: g.id === maximized ? 'minimize' : 'maximize', run: () => toggleMax(g.id) },
      { label: t('Text size'), icon: 'text-size', run: () => setTimeout(() => zoomMenu(anchor), 0) },
      ...(hidden.length ? ['-', { label: t('Add view'), icon: 'plus', run: () => setTimeout(() => addMenu(anchor), 0) }] : []),
      '-', { label: t('Close pane'), icon: 'x', run: () => set(M.closeGroup(tree, g.id)) },
      { label: t('Reset layout'), icon: 'layout', run: () => api.reset() }]);

    const bar = el('div', { class: 'gactions' },
      hidden.length ? act('add', 'plus', t('Add view'), addMenu, 'opt') : '',
      act('zoom', 'text-size', t('Text size'), zoomMenu), act('sr', 'split-h', t('Split right'), () => set(M.splitGroup(tree, g.id, 'row'))), act('sd', 'split-v', t('Split down'), () => set(M.splitGroup(tree, g.id, 'col'))),
      act('max', g.id === maximized ? 'minimize' : 'maximize', g.id === maximized ? t('Restore size') : t('Maximize'), () => toggleMax(g.id)),
      act('close', 'x', t('Close pane'), () => set(M.closeGroup(tree, g.id))),
      act('more', 'more', t('More'), moreMenu, 'more'));
    strip.append(bar);

    const body = el('div', { class: 'gbody' });
    if (g.views.length) for (const v of g.views) { const r = roots.get(v); if (r) body.append(r); }
    else body.append(chooser(g));

    // the strip accepts tabs too: drop = into this pane, at the position under the pointer
    strip.addEventListener('dragover', (e) => { if (!dragView) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; showPreview(el0, 'center'); });
    strip.addEventListener('dragleave', (e) => { if (!strip.contains(e.relatedTarget)) hidePreview(el0); });
    strip.addEventListener('drop', (e) => {
      if (!dragView) return; e.preventDefault();
      const tabEls = [...tabs.children]; let index = tabEls.length;
      tabEls.forEach((tb, i) => { const r = tb.getBoundingClientRect(); if (e.clientX < r.left + r.width / 2 && index === tabEls.length) index = i; });
      const v = dragView; endDrag(); set(M.moveView(tree, v, g.id, 'center', index));
    });

    const zone = el('div', { class: 'dropzone' }, el('div', { class: 'dz-preview' }));
    const zoneOf = (e) => {
      const r = zone.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
      const edge = 0.24;
      if (x < edge && x <= y && x <= 1 - y) return 'left';
      if (x > 1 - edge && 1 - x <= y && 1 - x <= 1 - y) return 'right';
      if (y < edge) return 'top';
      if (y > 1 - edge) return 'bottom';
      return 'center';
    };
    const noop = (z) => { const src = M.groupOf(tree, dragView); return z !== 'center' && src && src.id === g.id && g.views.length === 1; };
    zone.addEventListener('dragover', (e) => { if (!dragView) return; const z = zoneOf(e); if (noop(z)) { hidePreview(el0); return; } e.preventDefault(); e.dataTransfer.dropEffect = 'move'; showPreview(el0, z); });
    zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) hidePreview(el0); });
    zone.addEventListener('drop', (e) => { if (!dragView) return; e.preventDefault(); const z = zoneOf(e); const v = dragView; endDrag(); if (!noop(z)) set(M.moveView(tree, v, g.id, z)); });

    el0.append(strip, body, zone);
    return el0;
  }

  function showPreview(groupEl, zone) {
    const p = groupEl.querySelector('.dz-preview'); if (!p) return;
    p.dataset.zone = zone; p.style.display = 'block';
  }
  function hidePreview(groupEl) { const p = groupEl.querySelector('.dz-preview'); if (p) p.style.display = 'none'; }
  function endDrag() { dragView = null; document.body.classList.remove('dragging'); document.querySelectorAll('.dz-preview').forEach((p) => { p.style.display = 'none'; }); }

  function chooser(g) {
    const box = el('div', { class: 'chooser' }, el('h3', {}, t('Choose a view')), el('p', { class: 'hint' }, t('Pick what this pane should show.')));
    const grid = el('div', { class: 'cgrid' });
    for (const v of M.VIEWS) {
      const b = el('button', { class: 'cbtn' }, icon(DEF[v][0], 18), el('span', {}, title(v)));
      b.addEventListener('click', () => set(M.moveView(tree, v, g.id, 'center')));
      grid.append(b);
    }
    box.append(grid);
    return box;
  }

  function toggleMax(id) { maximized = maximized === id ? null : id; render(); setTimeout(() => window.dispatchEvent(new Event('resize')), 30); }

  // ---------- public API ----------
  const api = {
    init() {
      host = $('#layout'); parking = $('#views');
      for (const n of parking.querySelectorAll(':scope > [data-view]')) roots.set(n.dataset.view, n);
      tree = load();
      render();
      document.addEventListener('hearth:lang', render);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && maximized) { maximized = null; render(); } });
    },
    /** Show a view (and make it the active tab of its pane). */
    show(view) { set(M.showView(tree, view)); },
    hide(view) { set(M.hideView(tree, view)); },
    reset() { maximized = null; set(M.defaultLayout()); },
    badge(view, text) {
      badges.set(view, text || '');
      for (const b of document.querySelectorAll(`.gtab[data-view-tab="${view}"] .bdg`)) b.textContent = text || '';
    },
    isVisible: (view) => Boolean(M.groupOf(tree, view)),
    isActive: (view) => M.groups(tree).some((g) => g.active === view),
    groupCount: () => M.groups(tree).length,
    hidden: () => M.hiddenViews(tree),
    get tree() { return tree; },
    model: M,
  };
  window.Layout = api;
})();
