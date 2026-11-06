'use strict';
// Git pane: branches, status, stage, commit, fetch/pull/push, merge, stash, MR/PR. Uses the host Git
// (hooks and fsmonitor disabled in the main process), never forces a push.
(() => {
  const H = window.hearth.git;
  let selectedDiff = null;
  let busy = false;

  const dir = () => cur()?.directory;
  const guard = async (fn) => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (err) { alert(errMsg(err)); } finally { busy = false; refresh(); }
  };

  async function refresh() {
    const d = dir();
    const list = $('#git-files'); list.replaceChildren();
    $('#git-log').replaceChildren(); $('#stash-list').replaceChildren(); $('#branch-list').replaceChildren();
    const head = $('#git-head');
    if (!d) { head.textContent = t('No session selected'); $('#git-branch').replaceChildren(); return; }
    if (!(await H.isRepo(d))) { head.textContent = t('Not a Git repository'); $('#git-count').textContent = ''; $('#git-branch').replaceChildren(); return; }
    const [st, branches, stashes, merging] = await Promise.all([H.status(d), H.branches(d).catch(() => []), H.stashList(d).catch(() => []), H.mergeInProgress(d).catch(() => false)]);
    head.textContent = `${st.branch || t('(detached)')}${st.upstream ? ' -> ' + st.upstream : ''}${st.ahead ? '  ↑' + st.ahead : ''}${st.behind ? '  ↓' + st.behind : ''}`;
    $('#git-count').textContent = st.files.length ? `(${st.files.length})` : '';
    $('#merge-bar').hidden = !merging;

    const sel = $('#git-branch'); sel.replaceChildren();
    for (const b of branches.filter((x) => !x.remote)) sel.append(el('option', { value: b.name }, b.name));
    sel.value = st.branch || '';

    for (const f of st.files) {
      const code = f.untracked ? 'U' : (f.staged ? f.index : f.worktree);
      const row = el('div', { class: 'gf' }, el('span', { class: `st ${code}` }, code), el('span', {}, f.path), el('button', { class: 'ghost' }, f.staged ? t('Unstage') : t('Stage')));
      row.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); guard(() => (f.staged ? H.unstage(d, [f.path]) : H.stage(d, [f.path]))); });
      row.addEventListener('click', () => showDiff(d, f));
      row.addEventListener('dblclick', () => openFile(`${d}\\${f.path.replace(/\//g, '\\')}`));
      list.append(row);
    }
    if (selectedDiff) { const f = st.files.find((x) => x.path === selectedDiff.path); if (f) showDiff(d, f); }

    for (const s of stashes) {
      const li = el('li', { class: 'gf' }, el('span', {}, '⚑'), el('span', {}, `${s.ref}: ${s.subject}`));
      const acts = el('span', {});
      for (const [label, fn] of [[t('Apply'), H.stashApply], [t('Pop'), H.stashPop], [t('Drop'), H.stashDrop]]) {
        const b = el('button', { class: 'ghost' }, label);
        b.addEventListener('click', () => guard(() => (label === t('Drop') && !confirm(t('Discard this stash?')) ? null : fn(d, s.ref))));
        acts.append(b);
      }
      li.append(acts); $('#stash-list').append(li);
    }
    for (const b of branches) {
      const li = el('li', { class: 'gf' }, el('span', {}, b.current ? '*' : ''), el('span', {}, b.name + (b.upstream ? `  → ${b.upstream}` : '')));
      if (!b.current && !b.remote) {
        const acts = el('span', {});
        const co = el('button', { class: 'ghost' }, t('Checkout')); co.addEventListener('click', () => guard(() => H.checkout(d, b.name)));
        const mg = el('button', { class: 'ghost' }, t('Merge into current')); mg.addEventListener('click', () => guard(() => (confirm(t('Merge {name} into {current}?', { name: b.name, current: st.branch })) ? H.merge(d, b.name) : null)));
        acts.append(co, mg); li.append(acts);
      }
      $('#branch-list').append(li);
    }
    for (const c of await H.log(d).catch(() => [])) $('#git-log').append(el('li', {}, `${c.subject} `, el('small', {}, `${c.hash} - ${c.author}, ${c.when}`)));
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
  document.addEventListener('hearth:tab', (e) => { if (e.detail === 'git') refresh(); });
  setInterval(() => { if ($('#insp-git').classList.contains('active') && document.hasFocus() && !busy) refresh(); }, 6000);
  window.GitView = { refresh };
})();
