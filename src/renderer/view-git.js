'use strict';
// Git pane: branch card, changes with diff stats, commit, stash, branches (local/remote, filter), history, MR/PR.
// Uses the host Git (hooks and fsmonitor disabled in the main process), never forces a push.
//
// Refreshing never empties the pane first: the data is fetched, compared with what is shown, and only a real change is
// swapped in (in one step, scroll position kept). Otherwise the polling every few seconds made the pane flash and jump.
(() => {
  const H = window.hearth.git;
  let selectedDiff = null;
  let busy = false;
  let scope = 'local';
  let allBranches = [];
  let current = null;
  let lastSig = null;      // what the pane currently shows (as a string); equal data = nothing to do
  let lastDiff = null;
  let running = false;
  let again = false;
  let renders = 0;         // how often the lists were really rebuilt (tests check that polling does not do it)
  let diffRenders = 0;

  const dir = () => cur()?.directory;
  const guard = async (fn) => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (err) { alert(errMsg(err)); } finally { busy = false; refresh(); }
  };
  const icon = (name, size = 14) => { const s = el('span', { class: 'ico-wrap' }); s.innerHTML = Icons.html(name, size); return s; };

  function drawBranches() {
    const q = $('#branch-filter').value.trim().toLowerCase();
    const shown = allBranches.filter((b) => (scope === 'remote') === b.remote && (!q || b.name.toLowerCase().includes(q)));
    $('#branch-count').textContent = String(allBranches.filter((b) => (scope === 'remote') === b.remote).length);
    const d = dir();
    const cards = shown.map((b) => {
      const card = el('div', { class: `bcard ${b.current ? 'cur' : ''}`, 'data-key': b.name + (b.remote ? '#remote' : '') }, icon(b.current ? 'check-circle' : 'git-branch', 16),
        el('div', { style: 'min-width:0' }, el('b', {}, b.name), el('small', {}, [b.date, b.subject].filter(Boolean).join(' · '))));
      if (!b.current && !b.remote) {
        const co = el('button', { class: 'ghost' }, t('Checkout')); co.addEventListener('click', () => guard(() => H.checkout(d, b.name)));
        const mg = el('button', { class: 'ib', title: t('Merge into current') }, icon('git-merge', 15));
        mg.addEventListener('click', () => guard(() => (confirm(t('Merge {name} into {current}?', { name: b.name, current })) ? H.merge(d, b.name) : null)));
        card.append(el('span', { class: 'row', style: 'gap:2px' }, co, mg));
      } else card.append(el('span'));
      return card;
    });
    if (!shown.length) cards.push(el('div', { class: 'hint', style: 'margin:0 12px' }, t('No results')));
    $('#branch-list').replaceChildren(...cards);
  }

  /** Not a repository / no session: show a short text, once. */
  function showEmpty(text) {
    const sig = 'empty:' + text + I18n.lang;
    if (sig === lastSig) return;
    lastSig = sig; lastDiff = null; selectedDiff = null; allBranches = [];
    $('#git-head').textContent = text; Layout.badge('git', ''); $('#git-count2').textContent = '0';
    for (const id of ['#git-branch', '#git-files', '#stash-list', '#git-log', '#git-diff', '#branch-list']) $(id).replaceChildren();
    $('#branch-count').textContent = '0';
  }

  async function refresh() {
    if (running) { again = true; return; }          // one at a time: two overlapping refreshes would overwrite each other
    running = true;
    try { await load(); } catch (err) { /* a repository in the middle of an operation: try again at the next refresh */ } finally { running = false; if (again) { again = false; refresh(); } }
  }

  async function load() {
    const d = dir();
    if (!d) { showEmpty(t('No session selected')); return; }
    if (!(await H.isRepo(d))) { showEmpty(t('Not a Git repository')); return; }
    const [st, branches, stashes, merging, nums, log] = await Promise.all([H.status(d), H.branches(d).catch(() => []), H.stashList(d).catch(() => []), H.mergeInProgress(d).catch(() => false), H.numstat(d).catch(() => ({})), H.log(d).catch(() => [])]);
    if (d !== dir()) return;                          // the user switched sessions meanwhile
    // "5 seconds ago" changes with every query: it is not part of the comparison, the texts are updated in place instead
    const without = (list, key) => list.map((item) => { const { [key]: _drop, ...rest } = item; return rest; });
    const sig = JSON.stringify([d, I18n.lang, st, without(branches, 'date'), stashes, merging, nums, without(log, 'when')]);
    if (sig !== lastSig) { lastSig = sig; render(d, st, branches, stashes, merging, nums, log); } else patchTimes(branches, log);
    // the open diff follows the file; it is only redrawn when its text changed
    if (selectedDiff) {
      const f = st.files.find((x) => x.path === selectedDiff.path);
      if (f) await showDiff(d, f, true); else { selectedDiff = null; lastDiff = null; $('#git-diff').replaceChildren(); }
    }
  }

  /** Keep the relative times ("2 minutes ago") current without rebuilding any list. */
  function patchTimes(branches, log) {
    document.querySelectorAll('#git-log .commit small').forEach((node, i) => { if (log[i] && node.textContent !== log[i].when) node.textContent = log[i].when; });
    const byKey = new Map(branches.map((b) => [b.name + (b.remote ? '#remote' : ''), b]));
    document.querySelectorAll('#branch-list .bcard[data-key]').forEach((card) => {
      const b = byKey.get(card.dataset.key); const small = card.querySelector('small');
      const text = b ? [b.date, b.subject].filter(Boolean).join(' · ') : '';
      if (small && b && small.textContent !== text) small.textContent = text;
    });
  }

  function render(d, st, branches, stashes, merging, nums, log) {
    const scroller = $('#insp-git'); const top = scroller.scrollTop;
    renders++;
    current = st.branch;
    $('#git-head').textContent = st.upstream ? `${st.upstream}${st.ahead ? `  ↑${st.ahead}` : ''}${st.behind ? `  ↓${st.behind}` : ''}` : t('No upstream');
    $('#git-pull').disabled = !st.upstream;
    Layout.badge('git', st.files.length ? `(${st.files.length})` : '');
    $('#git-count2').textContent = String(st.files.length);
    $('#merge-bar').hidden = !merging;

    const sel = $('#git-branch');
    sel.replaceChildren(...branches.filter((x) => !x.remote).map((b) => el('option', { value: b.name }, b.name)));
    sel.value = st.branch || '';
    allBranches = branches; drawBranches();

    const rows = st.files.map((f) => {
      const code = f.untracked ? 'U' : (f.staged ? f.index : f.worktree);
      const parts = f.path.split('/'); const name = parts.pop(); const where = parts.join('/');
      const n = nums[f.path];
      const row = el('div', { class: 'gf' }, el('span', { class: `st ${code}` }, code),
        el('span', { class: 'nm' }, el('b', {}, name), where ? el('small', {}, where) : ''),
        el('span', { class: 'num' }, n ? [el('span', { class: 'a' }, `+${n.add} `), el('span', { class: 'd' }, `−${n.del}`)] : ''),
        el('button', { class: 'ghost', title: f.staged ? t('Unstage') : t('Stage') }, f.staged ? t('Unstage') : t('Stage')));
      row.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); guard(() => (f.staged ? H.unstage(d, [f.path]) : H.stage(d, [f.path]))); });
      row.addEventListener('click', () => showDiff(d, f));
      row.addEventListener('dblclick', () => openFile(`${d}\\${f.path.replace(/\//g, '\\')}`));
      return row;
    });
    if (!st.files.length) rows.push(el('div', { class: 'hint', style: 'margin:4px 12px' }, t('Working tree clean.')));
    $('#git-files').replaceChildren(...rows);

    $('#stash-list').replaceChildren(...stashes.map((s) => {
      const row = el('div', { class: 'bcard' }, icon('archive', 16), el('div', { style: 'min-width:0' }, el('b', {}, s.ref), el('small', {}, s.subject)));
      const acts = el('span', { class: 'row', style: 'gap:0' });
      for (const [label, fn] of [[t('Apply'), H.stashApply], [t('Pop'), H.stashPop], [t('Drop'), H.stashDrop]]) {
        const b = el('button', { class: 'ghost' }, label);
        b.addEventListener('click', () => guard(() => (label === t('Drop') && !confirm(t('Discard this stash?')) ? null : fn(d, s.ref))));
        acts.append(b);
      }
      row.append(acts);
      return row;
    }));

    const commits = log.map((c) => el('div', { class: 'commit' }, el('span', { class: 'h' }, c.hash), el('span', { class: 'm', title: c.subject }, c.subject), el('small', {}, c.when)));
    if (!log.length) commits.push(el('div', { class: 'hint', style: 'margin:0 12px' }, t('No commits yet.')));
    $('#git-log').replaceChildren(...commits);
    scroller.scrollTop = top;                        // the pane does not jump
  }

  async function showDiff(d, f, fromRefresh = false) {
    selectedDiff = f;
    const text = f.untracked ? t('(untracked file - stage it to include it in the commit)') : await H.diff(d, f.path, f.staged && !f.unstaged);
    const key = [d, f.path, f.staged, f.unstaged].join('|');
    if (lastDiff && lastDiff.key === key && lastDiff.text === text) return;     // same diff: leave it alone (and where the user scrolled to)
    lastDiff = { key, text };
    diffRenders++;
    const pre = $('#git-diff'); const top = pre.scrollTop;
    pre.replaceChildren(...text.split('\n').map((line) => el('div', { class: line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : '' }, line || ' ')));
    pre.scrollTop = fromRefresh ? top : 0;
  }
  const clearDiff = () => { selectedDiff = null; lastDiff = null; $('#git-diff').replaceChildren(); };

  $('#git-branch').addEventListener('change', (e) => guard(() => H.checkout(dir(), e.target.value)));
  $('#git-newbranch').addEventListener('click', () => { const n = prompt(t('Name of the new branch')); if (n) guard(() => H.createBranch(dir(), n.trim())); });
  $('#git-fetch').addEventListener('click', () => guard(() => H.fetch(dir())));
  $('#git-pull').addEventListener('click', () => guard(() => H.pull(dir())));
  $('#git-push').addEventListener('click', () => guard(() => H.push(dir())));
  $('#git-stageall').addEventListener('click', () => guard(() => H.stageAll(dir())));
  $('#git-unstageall').addEventListener('click', () => guard(() => H.unstageAll(dir())));
  $('#stash-save').addEventListener('click', () => guard(() => H.stashSave(dir(), prompt(t('Stash message (optional)')) || '')));
  $('#merge-abort').addEventListener('click', () => guard(() => H.mergeAbort(dir())));
  $('#btn-refresh').addEventListener('click', refresh);
  $('#branch-filter').addEventListener('input', drawBranches);
  document.querySelectorAll('#branch-seg button').forEach((b) => b.addEventListener('click', () => {
    scope = b.dataset.scope;
    document.querySelectorAll('#branch-seg button').forEach((x) => x.classList.toggle('on', x === b));
    drawBranches();
  }));
  $('#btn-commit').addEventListener('click', () => guard(async () => {
    await H.commit(dir(), $('#commit-msg').value);
    $('#commit-msg').value = ''; clearDiff();
  }));

  // MR / PR
  $('#git-pr').addEventListener('click', async () => {
    const d = dir(); if (!d) return;
    try {
      const st = await H.status(d);
      const info = await window.hearth.ci.info(d);
      if (!info) { alert(t('No GitHub or GitLab remote found in this repository.')); return; }
      if (!st.branch) { alert(t('Detached HEAD: nothing to push')); return; }
      $('#pr-source').value = st.branch;
      $('#pr-title').value = ''; $('#pr-body').value = '';
      const branches = await H.branches(d);
      $('#pr-target').value = ['main', 'master', 'develop'].find((n) => branches.some((b) => b.name === n && !b.remote) && n !== st.branch) || '';
      $('#dlg-pr').showModal();
    } catch (err) { alert(errMsg(err)); }
  });
  $('#pr-create').addEventListener('click', async (e) => {
    e.preventDefault();
    const d = dir();
    try {
      const url = await window.hearth.ci.changeRequest(d, { title: $('#pr-title').value.trim(), source: $('#pr-source').value, target: $('#pr-target').value.trim(), description: $('#pr-body').value });
      $('#dlg-pr').close();
      if (url) window.hearth.open(url);
    } catch (err) { alert(errMsg(err)); }
  });

  document.addEventListener('hearth:select', () => { lastSig = null; clearDiff(); refresh(); });   // another project: show it from scratch
  document.addEventListener('hearth:saved', refresh);
  document.addEventListener('hearth:lang', () => { lastSig = null; refresh(); });
  document.addEventListener('hearth:tab', (e) => { if (e.detail === 'git') refresh(); });
  setInterval(() => { if ($('#insp-git').classList.contains('active') && document.hasFocus() && !busy) refresh(); }, 6000);
  window.GitView = { refresh, get renders() { return renders; }, get diffRenders() { return diffRenders; } };
})();
