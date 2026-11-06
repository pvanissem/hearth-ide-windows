'use strict';
// Search Everywhere (Shift Shift / Ctrl+K), Ctrl+Shift+O (files), Ctrl+Shift+F (text), Ctrl+Shift+A (actions);
// Find usages (Alt+F7) and Go to definition (F12 / Ctrl+click).
(() => {
  const CATS = [['all', 'All'], ['files', 'Files'], ['symbols', 'Symbols'], ['text', 'Text'], ['chats', 'Chats'], ['sessions', 'Sessions'], ['tests', 'Tests'], ['actions', 'Actions']];
  let cat = 'all'; let items = []; let sel = 0; let seq = 0; let timer = null;

  // ----- actions -----
  const goTab = (tab, pane = 'inspector') => () => (pane === 'center' ? showCenter(tab) : showInspector(tab));
  function actions() {
    const a = [
      [t('Start agent'), () => $('#btn-start').click()], [t('Open settings'), () => $('#btn-settings').click()],
      [t('Show files'), goTab('files')], [t('Show Git'), goTab('git')], [t('Show overview'), goTab('overview')], [t('Show tests'), goTab('tests')],
      [t('Show architecture'), goTab('arch')], [t('Show build & deployment'), goTab('build')], [t('Show CI/CD'), goTab('ci')],
      [t('Show agent'), goTab('agent', 'center')], [t('Show editor'), goTab('editor', 'center')],
      [t('Git: fetch'), () => { showInspector('git'); $('#git-fetch').click(); }], [t('Git: pull'), () => { showInspector('git'); $('#git-pull').click(); }],
      [t('Git: push'), () => { showInspector('git'); $('#git-push').click(); }], [t('Run tests'), () => { showInspector('tests'); $('#tests-run').click(); }],
      [t('Check for updates'), () => { $('#btn-settings').click(); document.querySelector('#set-tabs [data-tab="about"]').click(); $('#btn-update').click(); }],
    ];
    for (const [id, name] of Themes.list) a.push([`${t('Theme')}: ${name}`, async () => { Themes.apply(id); state.settings = await window.hearth.setSettings({ ...state.settings, theme: id }); }]);
    a.push([`${t('Language')}: Deutsch`, async () => { I18n.set('de'); state.settings = await window.hearth.setSettings({ ...state.settings, language: 'de' }); renderInbox(); }]);
    a.push([`${t('Language')}: English`, async () => { I18n.set('en'); state.settings = await window.hearth.setSettings({ ...state.settings, language: 'en' }); renderInbox(); }]);
    return a;
  }

  // ----- matching -----
  const score = (q, s) => { const a = s.toLowerCase(); const b = q.toLowerCase(); return a === b ? 3 : a.startsWith(b) ? 2 : a.includes(b) ? 1 : 0; };

  async function gather(q, c) {
    const s = cur(); const dir = s?.directory;
    const out = [];
    const want = (x) => c === 'all' || c === x;
    const jobs = [];
    if (want('files') && dir && q) jobs.push(window.hearth.search.files(dir, q).then((r) => r.slice(0, c === 'all' ? 8 : 60).forEach((x) => out.push({ cat: 'files', label: base(x.file), detail: x.rel, run: () => openFile(x.file) }))));
    if (want('symbols') && dir && q.length > 1) jobs.push(window.hearth.search.symbols(dir, q).then((r) => r.slice(0, c === 'all' ? 6 : 60).forEach((x) => out.push({ cat: 'symbols', label: `${x.name}`, detail: `${x.kind} - ${x.rel}:${x.line}`, run: () => openFile(x.file, x.line, x.name) }))));
    if (want('text') && dir && q.length > 2) jobs.push(window.hearth.search.text(dir, q).then((r) => r.slice(0, c === 'all' ? 6 : 200).forEach((x) => out.push({ cat: 'text', label: x.text, detail: `${x.rel}:${x.line}`, run: () => openFile(x.file, x.line, q) }))));
    await Promise.all(jobs);
    if (want('sessions')) for (const x of state.sessions.values()) if (!q || score(q, `${x.name} ${x.title}`)) out.push({ cat: 'sessions', label: `${x.name} - ${x.title}`, detail: x.directory, run: () => { select(x.id); showCenter('agent'); } });
    if (want('chats') && q.length > 2) {
      for (const [id, tm] of state.terms) {
        const buf = tm.term.buffer.active; let n = 0;
        for (let i = 0; i < buf.length && n < (c === 'all' ? 3 : 30); i++) {
          const line = buf.getLine(i)?.translateToString(true) || '';
          if (line.toLowerCase().includes(q.toLowerCase())) { n++; out.push({ cat: 'chats', label: line.trim().slice(0, 160), detail: state.sessions.get(id)?.name || '', run: () => { select(id); showCenter('agent'); tm.term.scrollToLine(Math.max(0, i - 3)); } }); }
        }
      }
    }
    if (want('tests') && dir && q.length > 1) {
      const r = await window.hearth.tests.load(dir).catch(() => ({ cases: [] }));
      r.cases.filter((x) => score(q, `${x.suite} ${x.name}`)).slice(0, c === 'all' ? 4 : 60).forEach((x) => out.push({ cat: 'tests', label: x.name, detail: `${x.suite} - ${x.status}`, run: () => { showInspector('tests'); } }));
    }
    if (want('actions')) for (const [name, run] of actions()) if (!q || score(q, name)) out.push({ cat: 'actions', label: name, detail: '', run });
    return out;
  }

  function render() {
    const ul = $('#search-results'); ul.replaceChildren();
    items.forEach((it, i) => {
      const li = el('li', { class: i === sel ? 'sel' : '' }, el('span', {}, it.label), el('small', {}, cat === 'all' ? `${t(CATS.find((x) => x[0] === it.cat)[1])}  ${it.detail}` : it.detail));
      li.addEventListener('click', () => choose(i));
      ul.append(li);
    });
    $('#search-hint').textContent = items.length ? '' : (cur() ? t('No results') : t('Start an agent to search its project folder.'));
    ul.children[sel]?.scrollIntoView({ block: 'nearest' });
  }

  async function run() {
    const my = ++seq;
    const q = $('#search-input').value.trim();
    const res = await gather(q, cat).catch(() => []);
    if (my !== seq) return;
    items = res; sel = 0; render();
  }

  function choose(i) { const it = items[i]; if (!it) return; $('#dlg-search').close(); it.run(); }

  function setCat(c) {
    cat = c;
    document.querySelectorAll('#search-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.cat === c));
    run();
  }

  function open(c = 'all', text = '') {
    const dlg = $('#dlg-search');
    const tabs = $('#search-tabs');
    if (!tabs.children.length) for (const [id, name] of CATS) { const b = el('button', { 'data-cat': id }, t(name)); b.addEventListener('click', () => { setCat(id); $('#search-input').focus(); }); tabs.append(b); }
    $('#search-input').value = text;
    if (!dlg.open) dlg.showModal();
    setCat(c);
    $('#search-input').focus(); $('#search-input').select();
  }

  $('#search-input').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 140); });
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(sel); e.preventDefault(); }
    else if (e.key === 'Tab') { const i = CATS.findIndex((x) => x[0] === cat); setCat(CATS[(i + (e.shiftKey ? CATS.length - 1 : 1)) % CATS.length][0]); e.preventDefault(); }
  });
  $('#btn-search').addEventListener('click', () => open());
  document.addEventListener('hearth:search', () => open());

  // Shift Shift, Ctrl+K and the Navigate shortcuts
  let lastShift = 0;
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); return; }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); open('files'); return; }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); open('text'); return; }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); open('actions'); return; }
    if (e.key !== 'Shift') lastShift = 0;
  });
  document.addEventListener('keyup', (e) => {
    if (e.key !== 'Shift') return;
    const now = Date.now();
    if (lastShift && now - lastShift < 450) { lastShift = 0; open(); } else lastShift = now;
  });

  // ----- Find usages -----
  const filters = { definition: true, code: true, import: true, comment: true, all: false };
  let lastUsage = null; let lastHits = [];

  function drawUsages() {
    const list = $('#usages-list'); list.replaceChildren();
    const bar = el('div', { class: 'row wrap' });
    for (const k of ['definition', 'code', 'import', 'comment']) {
      const lb = el('label', { class: 'check' }, el('input', { type: 'checkbox' }), t({ definition: 'Definitions', code: 'Code', import: 'Imports', comment: 'Comments' }[k]));
      lb.firstChild.checked = filters[k];
      lb.firstChild.addEventListener('change', () => { filters[k] = lb.firstChild.checked; drawUsages(); });
      bar.append(lb);
    }
    const all = el('label', { class: 'check' }, el('input', { type: 'checkbox' }), t('All languages'));
    all.firstChild.checked = filters.all;
    all.firstChild.addEventListener('change', () => { filters.all = all.firstChild.checked; findUsages(lastUsage); });
    bar.append(all);
    list.append(bar);
    const shown = lastHits.filter((h) => filters[h.kind]);
    $('#usages-title').textContent = `${t('Usages of')} ${lastUsage?.word} (${shown.length})`;
    let file = null;
    for (const h of shown) {
      if (h.rel !== file) { file = h.rel; list.append(el('div', { class: 'usage' }, el('span', { class: 'grp' }, h.rel))); }
      const row = el('div', { class: 'usage' }, el('span', {}, `${h.line}:  ${h.text}`), el('small', {}, h.container ? `${t('in')} ${h.container}` : ''));
      row.addEventListener('click', () => openFile(h.file, h.line, lastUsage.word));
      list.append(row);
    }
    if (!shown.length) list.append(el('div', { class: 'hint' }, t('No results')));
  }

  async function findUsages(req) {
    const s = cur(); if (!s || !req) return;
    lastUsage = req;
    const overrides = {};
    for (const [f, d] of state.docs) if (d.dirty) overrides[f] = d.model.getValue();
    try { lastHits = await window.hearth.search.usages(s.directory, req.word, { file: req.file, allLanguages: filters.all, overrides }); } catch (err) { lastHits = []; alert(errMsg(err)); }
    $('#usages').hidden = false;
    drawUsages();
    state.editor?.layout();
  }
  document.addEventListener('hearth:usages', (e) => findUsages(e.detail));
  $('#usages-close').addEventListener('click', () => { $('#usages').hidden = true; state.editor?.layout(); });

  // ----- Go to definition (symbol index, no compiler) -----
  document.addEventListener('hearth:definition', async (e) => {
    const s = cur(); if (!s) return;
    const syms = (await window.hearth.search.symbols(s.directory, e.detail.word)).filter((x) => x.name === e.detail.word);
    if (!syms.length) { findUsages(e.detail); return; }
    const same = syms.find((x) => x.file === e.detail.file) || syms[0];
    openFile(same.file, same.line, e.detail.word);
  });
  window.SearchView = { open };
})();
