'use strict';
// Git pane: branch card, changes with diff stats, commit, stash, branches (local/remote, filter), history, MR/PR.
// Uses the host Git (hooks and fsmonitor disabled in the main process), never forces a push.
(() => {
  const H = window.hearth.git;
  let selectedDiff = null;
  let busy = false;
  let scope = 'local';
  let allBranches = [];
  let current = null;

  const dir = () => cur()?.directory;
  const guard = async (fn) => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (err) { alert(errMsg(err)); } finally { busy = false; refresh(); }
  };
  const icon = (name, size = 14) => { const s = el('span', { class: 'ico-wrap' }); s.innerHTML = Icons.html(name, size); return s; };

  function drawBranches() {
    const list = $('#branch-list'); list.replaceChildren();
    const q = $('#branch-filter').value.trim().toLowerCase();
    const shown = allBranches.filter((b) => (scope === 'remote') === b.remote && (!q || b.name.toLowerCase().includes(q)));
    $('#branch-count').textContent = String(allBranches.filter((b) => (scope === 'remote') === b.remote).length);
    const d = dir();
    for (const b of shown) {
      const card = el('div', { class: `bcard ${b.current ? 'cur' : ''}` }, icon(b.current ? 'check-circle' : 'git-branch', 16),
        el('div', { style: 'min-width:0' }, el('b', {}, b.name), el('small', {}, [b.date, b.subject].filter(Boolean).join(' · '))));
      if (!b.current && !b.remote) {
        const co = el('button', { class: 'ghost' }, t('Checkout')); co.addEventListener('click', () => guard(() => H.checkout(d, b.name)));
        const mg = el('button', { class: 'ib', title: t('Merge into current') }, icon('git-merge', 15));
        mg.addEventListener('click', () => guard(() => (confirm(t('Merge {name} into {current}?', { name: b.name, current })) ? H.merge(d, b.name) : null)));
        card.append(el('span', { class: 'row', style: 'gap:2px' }, co, mg));
      } else card.append(el('span'));
      list.append(card);
    }
    if (!shown.length) list.append(el('div', { class: 'hint', style: 'margin:0 12px' }, t('No results')));
  }

  async function refresh() {
    const d = dir();
    const list = $('#git-files'); list.replaceChildren();
    $('#git-log').replaceChildren(); $('#stash-list').replaceChildren();
    const head = $('#git-head');
    if (!d) { head.textContent = t('No session selected'); $('#git-branch').replaceChildren(); return; }
    if (!(await H.isRepo(d))) { head.textContent = t('Not a Git repository'); $('#git-count').textContent = ''; $('#git-count2').textContent = '0'; $('#git-branch').replaceChildren(); allBranches = []; drawBranches(); return; }
    const [st, branches, stashes, merging, nums, log] = await Promise.all([H.status(d), H.branches(d).catch(() => []), H.stashList(d).catch(() => []), H.mergeInProgress(d).catch(() => false), H.numstat(d).catch(() => ({})), H.log(d).catch(() => [])]);
    current = st.branch;
    head.textContent = st.upstream ? `${st.upstream}${st.ahead ? `  ↑${st.ahead}` : ''}${st.behind ? `  ↓${st.behind}` : ''}` : t('No upstream');
    $('#git-pull').disabled = !st.upstream;
    $('#git-count').textContent = st.files.length ? `(${st.files.length})` : '';
    $('#git-count2').textContent = String(st.files.length);
    $('#merge-bar').hidden = !merging;

    const sel = $('#git-branch'); sel.replaceChildren();
    for (const b of branches.filter((x) => !x.remote)) sel.append(el('option', { value: b.name }, b.name));
    sel.value = st.branch || '';
    allBranches = branches; drawBranches();

    for (const f of st.files) {
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
      list.append(row);
    }
    if (!st.files.length) list.append(el('div', { class: 'hint', style: 'margin:4px 12px' }, t('Working tree clean.')));
    if (selectedDiff) { const f = st.files.find((x) => x.path === selectedDiff.path); if (f) showDiff(d, f); }

    for (const s of stashes) {
      const row = el('div', { class: 'bcard' }, icon('archive', 16), el('div', { style: 'min-width:0' }, el('b', {}, s.ref), el('small', {}, s.subject)));
      const acts = el('span', { class: 'row', style: 'gap:0' });
      for (const [label, fn] of [[t('Apply'), H.stashApply], [t('Pop'), H.stashPop], [t('Drop'), H.stashDrop]]) {
        const b = el('button', { class: 'ghost' }, label);
        b.addEventListener('click', () => guard(() => (label === t('Drop') && !confirm(t('Discard this stash?')) ? null : fn(d, s.ref))));
        acts.append(b);
      }
      row.append(acts); $('#stash-list').append(row);
    }
    for (const c of log) $('#git-log').append(el('div', { class: 'commit' }, el('span', { class: 'h' }, c.hash), el('span', { class: 'm', title: c.subject }, c.subject), el('small', {}, c.when)));
    if (!log.length) $('#git-log').append(el('div', { class: 'hint', style: 'margin:0 12px' }, t('No commits yet.')));
  }

  async function showDiff(d, f) {
    selectedDiff = f;
    const pre = $('#git-diff'); pre.replaceChildren();
    const text = f.untracked ? t('(untracked file - stage it to include it in the commit)') : await H.diff(d, f.path, f.staged && !f.unstaged);
    for (const line of text.split('\n')) pre.append(el('div', { class: line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : '' }, line || ' '));
  }

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
    $('#commit-msg').value = ''; selectedDiff = null; $('#git-diff').replaceChildren();
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

  document.addEventListener('hearth:select', () => { selectedDiff = null; $('#git-diff').replaceChildren(); refresh(); });
  document.addEventListener('hearth:saved', refresh);
  document.addEventListener('hearth:lang', refresh);
  document.addEventListener('hearth:tab', (e) => { if (e.detail === 'git') refresh(); });
  setInterval(() => { if ($('#insp-git').classList.contains('active') && document.hasFocus() && !busy) refresh(); }, 6000);
  window.GitView = { refresh };
})();
