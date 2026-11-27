'use strict';
// Git pane: branch card with ahead/behind and fetch/pull/push, then tabs: Changes, Merge/Pull requests, Branches,
// History, Stashes. Wide (maximised or own column): list and details side by side - the diff of a file with line
// numbers, a commit, a stash, a branch with its last commits, a merge/pull request with review. Narrow: details open
// in place with a back button. Uses the host Git (hooks and fsmonitor off in the main process), never forces a push.
//
// Refreshing never empties the pane first: the data is fetched, compared with what is shown, and only a real change
// is swapped in (in one step, scroll position kept).
(() => {
  const H = window.hearth.git;
  let busy = false;
  let scope = 'local';
  let allBranches = [];
  let current = null;
  let lastSig = null;
  let running = false;
  let again = false;
  let renders = 0;
  let diffRenders = 0;
  let tab = 'changes';
  let detail = null;         // { type: 'file'|'commit'|'stash'|'branch'|'cr', key, ... }
  let lastDetail = null;     // { key, text } of the shown diff
  let ciInfo = null;
  let crState = 'open';
  let generator = (() => { try { return localStorage.getItem('hearth.commitAgent') || 'claude'; } catch { return 'claude'; } })();

  const dir = () => cur()?.directory;
  const guard = async (fn) => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (err) { alert(errMsg(err)); } finally { busy = false; refresh(); }
  };
  const icon = (name, size = 14) => { const s = el('span', { class: 'ico-wrap' }); s.innerHTML = Icons.html(name, size); return s; };
  const wide = () => $('#insp-git').clientWidth >= 760;

  // ---------- tabs and the detail column ----------
  function setTab(name) {
    tab = name;
    document.querySelectorAll('#git-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.gtab === name));
    document.querySelectorAll('#git-split .gpage').forEach((p) => p.classList.toggle('on', p.dataset.gpage === name));
    if (detail && detail.tab !== name) closeDetail();
    if (name === 'cr') loadCRs();
    layoutSplit();
  }
  document.querySelectorAll('#git-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.gtab)));
  function layoutSplit() {
    const w = wide();
    $('#git-split').classList.toggle('wide', w);
    $('#git-split').classList.toggle('detail-open', Boolean(detail));
    $('#git-detail').hidden = !detail && !w;
    $('#gd-back').hidden = w;
  }
  new ResizeObserver(() => requestAnimationFrame(layoutSplit)).observe($('#insp-git'));
  function openDetail(d) { detail = d; lastDetail = null; $('#gd-title').textContent = d.title || ''; $('#gd-actions').replaceChildren(...(d.actions || [])); layoutSplit(); }
  function closeDetail() { detail = null; lastDetail = null; $('#git-diff').replaceChildren(); $('#gd-title').textContent = ''; $('#gd-actions').replaceChildren(); layoutSplit(); }
  $('#gd-back').addEventListener('click', closeDetail);

  /** Shows diff text in the detail column; nothing happens when it is the same text (scroll position stays). */
  function showText(key, text, { empty = t('No changes'), keepScroll = false, pre } = {}) {
    if (lastDetail && lastDetail.key === key && lastDetail.text === text) return;
    lastDetail = { key, text };
    diffRenders++;
    const box = $('#git-diff'); const top = box.scrollTop;
    const nodes = pre ? [el('pre', { class: 'gd-pre' }, pre)] : [];
    box.replaceChildren(...nodes, Diff.render(text, { empty }));
    box.scrollTop = keepScroll ? top : 0;
  }

  // ---------- branches ----------
  function drawBranches() {
    const q = $('#branch-filter').value.trim().toLowerCase();
    const shown = allBranches.filter((b) => (scope === 'remote') === b.remote && (!q || b.name.toLowerCase().includes(q)));
    $('#branch-count').textContent = String(allBranches.filter((b) => !b.remote).length);
    const d = dir();
    const cards = shown.map((b) => {
      const card = el('div', { class: `bcard ${b.current ? 'cur' : ''} ${detail?.type === 'branch' && detail.key === b.name ? 'sel' : ''}`, 'data-key': b.name + (b.remote ? '#remote' : '') }, icon(b.current ? 'check-circle' : 'git-branch', 16),
        el('div', { style: 'min-width:0' }, el('b', {}, b.name), el('small', {}, [b.date, b.subject].filter(Boolean).join(' · '))));
      if (!b.current && !b.remote) {
        const co = el('button', { class: 'ghost' }, t('Checkout')); co.addEventListener('click', (e) => { e.stopPropagation(); guard(() => H.checkout(d, b.name)); });
        const mg = el('button', { class: 'ib', title: t('Merge into current') }, icon('git-merge', 15));
        mg.addEventListener('click', (e) => { e.stopPropagation(); guard(() => (confirm(t('Merge {name} into {current}?', { name: b.name, current })) ? H.merge(d, b.name) : null)); });
        card.append(el('span', { class: 'row', style: 'gap:2px' }, co, mg));
      } else card.append(el('span'));
      card.addEventListener('click', () => showBranch(b));
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (b.remote || b.current) return;
        Layout.menu(card, [{ label: t('Checkout'), icon: 'check', run: () => guard(() => H.checkout(d, b.name)) }, { label: t('Merge into current'), icon: 'git-merge', run: () => guard(() => (confirm(t('Merge {name} into {current}?', { name: b.name, current })) ? H.merge(d, b.name) : null)) }]);
      });
      return card;
    });
    if (!shown.length) cards.push(el('div', { class: 'hint', style: 'margin:0 12px' }, t('No results')));
    $('#branch-list').replaceChildren(...cards);
  }
  async function showBranch(b) {
    const d = dir();
    openDetail({ type: 'branch', tab: 'branches', key: b.name, title: b.name });
    drawBranches();
    const log = await H.branchLog(d, b.name).catch(() => []);
    if (detail?.key !== b.name) return;
    diffRenders++;
    $('#git-diff').replaceChildren(el('div', { class: 'gd-list' }, ...log.map((c) => commitRow(c, () => showCommit(c, 'branches')))));
  }

  // ---------- load ----------
  function showEmpty(text) {
    const sig = 'empty:' + text + I18n.lang;
    if (sig === lastSig) return;
    lastSig = sig; allBranches = []; ciInfo = null; closeDetail();
    $('#git-head').textContent = text; Layout.badge('git', ''); $('#git-count2').textContent = '0';
    for (const id of ['#git-branch', '#git-files', '#stash-list', '#git-log', '#branch-list', '#cr-list']) $(id).replaceChildren();
    $('#branch-count').textContent = '0'; $('#stash-count').textContent = ''; $('#cr-count').textContent = '';
  }

  async function refresh() {
    if (running) { again = true; return; }
    running = true;
    try { await load(); } catch { /* a repository in the middle of an operation: next refresh */ } finally { running = false; if (again) { again = false; refresh(); } }
  }

  async function load() {
    const d = dir();
    if (!d) { showEmpty(t('No session selected')); return; }
    if (!(await H.isRepo(d))) { showEmpty(t('Not a Git repository')); return; }
    const [st, branches, stashes, merging, nums, log] = await Promise.all([H.status(d), H.branches(d).catch(() => []), H.stashList(d).catch(() => []), H.mergeInProgress(d).catch(() => false), H.numstat(d).catch(() => ({})), H.log(d).catch(() => [])]);
    if (d !== dir()) return;
    const without = (list, key) => list.map((item) => { const { [key]: _drop, ...rest } = item; return rest; });
    const sig = JSON.stringify([d, I18n.lang, st, without(branches, 'date'), stashes, merging, nums, without(log, 'when')]);
    if (sig !== lastSig) { lastSig = sig; render(d, st, branches, stashes, merging, nums, log); } else patchTimes(branches, log);
    if (detail?.type === 'file') {
      const f = st.files.find((x) => x.path === detail.key);
      if (f) await showFile(d, f, true); else closeDetail();
    }
    if (!ciInfo || ciInfo.dir !== d) { ciInfo = { dir: d, info: await window.hearth.ci.info(d).catch(() => null) }; labelCR(); }
  }
  function labelCR() {
    const p = ciInfo?.info?.provider;
    $('#git-cr-label').textContent = p === 'gitlab' ? t('Merge requests') : p === 'github' ? t('Pull requests') : t('MR / PR');
  }

  function patchTimes(branches, log) {
    document.querySelectorAll('#git-log .commit small').forEach((node, i) => { if (log[i] && node.textContent !== log[i].when) node.textContent = log[i].when; });
    const byKey = new Map(branches.map((b) => [b.name + (b.remote ? '#remote' : ''), b]));
    document.querySelectorAll('#branch-list .bcard[data-key]').forEach((card) => {
      const b = byKey.get(card.dataset.key); const small = card.querySelector('small');
      const text = b ? [b.date, b.subject].filter(Boolean).join(' · ') : '';
      if (small && b && small.textContent !== text) small.textContent = text;
    });
  }

  function commitRow(c, onClick) {
    const row = el('div', { class: `commit ${detail?.type === 'commit' && detail.key === c.hash ? 'sel' : ''}` }, el('span', { class: 'h' }, c.hash), el('span', { class: 'm', title: c.subject }, c.subject), el('small', {}, c.when));
    row.addEventListener('click', onClick);
    return row;
  }

  function render(d, st, branches, stashes, merging, nums, log) {
    const scroller = $('#git-split .glist'); const top = scroller.scrollTop;
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
      const row = el('div', { class: `gf ${detail?.type === 'file' && detail.key === f.path ? 'sel' : ''}` }, el('span', { class: `st ${code}` }, code),
        el('span', { class: 'nm' }, el('b', {}, name), where ? el('small', {}, where) : ''),
        el('span', { class: 'num' }, ...(n ? [el('span', { class: 'a' }, `+${n.add} `), el('span', { class: 'd' }, `−${n.del}`)] : [])),
        el('button', { class: 'ghost', title: f.staged ? t('Unstage') : t('Stage') }, f.staged ? t('Unstage') : t('Stage')));
      row.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); guard(() => (f.staged ? H.unstage(d, [f.path]) : H.stage(d, [f.path]))); });
      row.addEventListener('click', () => showFile(d, f));
      row.addEventListener('dblclick', () => openFile(`${d}\\${f.path.replace(/\//g, '\\')}`));
      return row;
    });
    if (!st.files.length) rows.push(el('div', { class: 'hint', style: 'margin:4px 12px' }, t('Working tree clean.')));
    $('#git-files').replaceChildren(...rows);

    $('#stash-count').textContent = stashes.length ? String(stashes.length) : '';
    $('#stash-list').replaceChildren(...stashes.map((s) => {
      const row = el('div', { class: `bcard ${detail?.type === 'stash' && detail.key === s.ref ? 'sel' : ''}` }, icon('archive', 16), el('div', { style: 'min-width:0' }, el('b', {}, s.ref), el('small', {}, s.subject)));
      const acts = el('span', { class: 'row', style: 'gap:0' });
      for (const [label, fn] of [[t('Apply'), H.stashApply], [t('Pop'), H.stashPop], [t('Drop'), H.stashDrop]]) {
        const b = el('button', { class: 'ghost' }, label);
        b.addEventListener('click', (e) => { e.stopPropagation(); guard(() => (label === t('Drop') && !confirm(t('Discard this stash?')) ? null : fn(d, s.ref))); });
        acts.append(b);
      }
      row.append(acts);
      row.addEventListener('click', async () => { openDetail({ type: 'stash', tab: 'stashes', key: s.ref, title: `${s.ref} · ${s.subject}` }); showText('stash:' + s.ref, await H.stashShow(d, s.ref).catch((e) => String(e.message))); });
      return row;
    }));
    if (!stashes.length) $('#stash-list').append(el('div', { class: 'hint', style: 'margin:4px 12px' }, t('No stashes.')));

    const commits = log.map((c) => commitRow(c, () => showCommit(c, 'history')));
    if (!log.length) commits.push(el('div', { class: 'hint', style: 'margin:0 12px' }, t('No commits yet.')));
    $('#git-log').replaceChildren(...commits);
    scroller.scrollTop = top;
  }

  async function showCommit(c, fromTab) {
    const d = dir();
    openDetail({ type: 'commit', tab: fromTab, key: c.hash, title: `${c.hash} · ${c.subject}` });
    const text = await H.showCommit(d, c.hash).catch((e) => String(e.message));
    if (detail?.key !== c.hash) return;
    const at = text.indexOf('\ndiff --git');
    showText('commit:' + c.hash, at >= 0 ? text.slice(at + 1) : '', { pre: at >= 0 ? text.slice(0, at) : text });
  }

  async function showFile(d, f, fromRefresh = false) {
    if (!fromRefresh) openDetail({ type: 'file', tab: 'changes', key: f.path, title: f.path });
    const text = f.untracked ? await H.untrackedDiff(d, f.path).catch(() => '') : await H.diff(d, f.path, f.staged && !f.unstaged);
    showText(['file', d, f.path, f.staged, f.unstaged].join('|'), text, { keepScroll: fromRefresh, empty: t('No changes') });
    if (!fromRefresh) document.querySelectorAll('#git-files .gf').forEach((r) => r.classList.toggle('sel', r.querySelector('b')?.textContent === f.path.split('/').pop()));
  }

  // ---------- actions ----------
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
    $('#commit-msg').value = ''; closeDetail();
  }));

  // commit message by an agent (one-shot, in its sandbox, without tools)
  const GEN = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };
  function labelGenerate() { $('#btn-generate').title = t('Write a commit message with {agent}', { agent: GEN[generator] || generator }); }
  labelGenerate();
  $('#btn-generate-menu').addEventListener('click', (e) => Layout.menu(e.currentTarget, Object.entries(GEN).map(([k, name]) => ({
    label: name + (k === generator ? ' ✓' : ''), icon: Icons.agent ? Icons.agent(k) : 'sparkles',
    run: () => { generator = k; try { localStorage.setItem('hearth.commitAgent', k); } catch { /* private mode */ } labelGenerate(); generate(); } }))));
  async function generate() {
    const d = dir(); if (!d) return;
    const b = $('#btn-generate'); const box = $('#commit-msg');
    b.disabled = true; b.classList.add('busy'); const ph = box.placeholder; box.placeholder = t('{agent} is writing the message...', { agent: GEN[generator] });
    try { const msg = await H.generateMessage(d, generator); box.value = msg; box.focus(); } catch (err) { alert(errMsg(err)); }
    finally { b.disabled = false; b.classList.remove('busy'); box.placeholder = ph; }
  }
  $('#btn-generate').addEventListener('click', generate);

  // ---------- merge / pull requests ----------
  async function newChangeRequest() {
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
  }
  $('#git-pr').addEventListener('click', newChangeRequest);
  $('#pr-create').addEventListener('click', async (e) => {
    e.preventDefault();
    const d = dir();
    try {
      const url = await window.hearth.ci.changeRequest(d, { title: $('#pr-title').value.trim(), source: $('#pr-source').value, target: $('#pr-target').value.trim(), description: $('#pr-body').value });
      $('#dlg-pr').close();
      if (url) window.hearth.open(url);
      loadCRs();
    } catch (err) { alert(errMsg(err)); }
  });
  document.querySelectorAll('#cr-seg button').forEach((b) => b.addEventListener('click', () => {
    crState = b.dataset.state; document.querySelectorAll('#cr-seg button').forEach((x) => x.classList.toggle('on', x === b)); loadCRs();
  }));
  $('#cr-reload').addEventListener('click', () => { loadCRs(); if (detail?.type === 'cr') showCR(detail.number); });

  const prefix = () => (ciInfo?.info?.provider === 'gitlab' ? '!' : '#');
  async function loadCRs() {
    const d = dir(); if (!d) return;
    const list = $('#cr-list');
    const info = ciInfo?.info || await window.hearth.ci.info(d).catch(() => null);
    if (!info) { list.replaceChildren(el('div', { class: 'hint gpad' }, t('No GitHub or GitLab remote found in this repository.'))); return; }
    if (!info.hasToken) { list.replaceChildren(el('div', { class: 'hint gpad' }, t('No token for {host}. Add a read token in Settings > Credentials.', { host: info.host }))); return; }
    list.classList.add('loading');
    try {
      const items = await window.hearth.cr.list(d, crState);
      if (d !== dir()) return;
      if (crState === 'open') $('#cr-count').textContent = items.length ? String(items.length) : '';
      const mine = items.find((x) => x.source === current);
      $('#cr-current').textContent = mine ? t('Your branch {branch} is in {n}.', { branch: current, n: prefix() + mine.number }) : '';
      list.replaceChildren(...items.map((x) => {
        const row = el('div', { class: `crrow ${detail?.type === 'cr' && detail.number === x.number ? 'sel' : ''}` },
          el('span', { class: `pill ${x.state === 'open' ? (x.draft ? '' : 'run') : x.state === 'merged' ? 'ok' : 'bad'}` }, x.draft ? t('Draft') : t(x.state === 'open' ? 'Open' : x.state === 'merged' ? 'Merged' : 'Closed')),
          el('div', { style: 'min-width:0' }, el('b', {}, `${prefix()}${x.number} ${x.title}`), el('small', {}, `${x.source} → ${x.target} · ${x.author}`)));
        row.addEventListener('click', () => showCR(x.number));
        return row;
      }));
      if (!items.length) list.append(el('div', { class: 'hint gpad' }, t('Nothing here.')));
    } catch (err) { list.replaceChildren(el('div', { class: 'hint gpad danger' }, errMsg(err))); }
    finally { list.classList.remove('loading'); }
  }

  const MERGE_TEXT = { ready: 'Ready to merge', conflict: 'Merge conflicts', checking: 'Checking mergeability...', notOpen: 'Not open' };
  async function showCR(n) {
    const d = dir();
    openDetail({ type: 'cr', tab: 'cr', key: 'cr' + n, number: n, title: prefix() + n });
    const box = $('#git-diff'); box.replaceChildren(el('div', { class: 'hint gpad' }, t('Loading...')));
    diffRenders++;
    let det; let files; let comments;
    try { [det, files, comments] = await Promise.all([window.hearth.cr.detail(d, n), window.hearth.cr.files(d, n), window.hearth.cr.comments(d, n)]); }
    catch (err) { box.replaceChildren(el('div', { class: 'hint gpad danger' }, errMsg(err))); return; }
    if (detail?.number !== n) return;
    const s = det.summary; const gh = ciInfo?.info?.provider === 'github';
    $('#gd-title').textContent = `${prefix()}${n} ${s.title}`;
    const open = el('button', { class: 'ib', title: t('Open in the browser') }, icon('external', 14)); open.addEventListener('click', () => s.url && window.hearth.open(s.url));
    $('#gd-actions').replaceChildren(open);

    const m = det.mergeability;
    const mText = m.text ? t(m.text) : t(MERGE_TEXT[m.kind] || m.kind);
    const head = el('div', { class: 'crhead' },
      el('div', { class: 'row wrap' }, el('span', { class: `pill ${m.kind === 'ready' ? 'ok' : m.kind === 'conflict' ? 'bad' : m.kind === 'warning' ? 'warn' : ''}` }, mText),
        det.pipeline ? el('span', { class: 'pill' }, `${t('Pipeline')}: ${det.pipeline}`) : '',
        det.approvedBy.length ? el('span', { class: 'pill ok' }, t('Approved by {names}', { names: det.approvedBy.join(', ') })) : '',
        det.changesRequestedBy.length ? el('span', { class: 'pill warn' }, t('Changes requested by {names}', { names: det.changesRequestedBy.join(', ') })) : ''),
      el('div', { class: 'hint' }, `${s.source} → ${s.target} · ${s.author}`),
      det.body ? el('div', { class: 'crbody' }, det.body) : '');

    // conversation (comments that are not on a line)
    const general = comments.filter((c) => !c.anchor);
    const conv = el('div', { class: 'crconv' }, el('h4', {}, t('Conversation')), ...general.map(commentNode),
      general.length ? '' : el('div', { class: 'hint' }, t('No comments yet.')));

    // review box
    const text = el('textarea', { placeholder: t('Comment or review (optional)'), rows: '3' });
    const doReview = (verdict) => async () => {
      try { await window.hearth.cr.review(d, n, verdict, text.value); text.value = ''; toast(t('Review sent')); showCR(n); } catch (err) { alert(errMsg(err)); }
    };
    const comment = el('button', {}, t('Comment')); comment.addEventListener('click', async () => {
      try { await window.hearth.cr.comment(d, n, text.value, null, det.refs); text.value = ''; showCR(n); } catch (err) { alert(errMsg(err)); }
    });
    const approve = el('button', { class: 'primary' }, t('Approve')); approve.addEventListener('click', doReview('approve'));
    const request = el('button', {}, t('Request changes')); request.addEventListener('click', doReview('requestChanges'));
    const review = el('div', { class: 'crreview' }, text, el('div', { class: 'row wrap' }, comment, approve, gh ? request : ''));
    if (s.state !== 'open') review.hidden = true;

    // merge
    const methods = gh ? ['merge', 'squash', 'rebase'] : ['merge', 'squash'];
    const methodSel = el('select', { style: 'width:auto' }, ...methods.map((x) => el('option', { value: x }, t({ merge: 'Merge commit', squash: 'Squash and merge', rebase: 'Rebase and merge' }[x]))));
    const del = el('input', { type: 'checkbox' });
    const mergeBtn = el('button', { class: 'primary' }, icon('git-merge', 14), t('Merge'));
    mergeBtn.disabled = !(m.kind === 'ready' || m.kind === 'warning');
    mergeBtn.addEventListener('click', async () => {
      if (!confirm(t('Merge {name} into {target}?', { name: prefix() + n, target: s.target }))) return;
      try { await window.hearth.cr.merge(d, n, { method: methodSel.value, deleteSource: del.checked }); toast(t('Merged')); loadCRs(); showCR(n); } catch (err) { alert(errMsg(err)); }
    });
    const merge = el('div', { class: 'crmerge row wrap' }, methodSel, el('label', { class: 'check' }, del, el('span', {}, t('Delete the source branch'))), mergeBtn,
      el('span', { class: 'hint' }, t('Only the reviewed state is merged.')));
    if (s.state !== 'open') merge.hidden = true;

    // files with line comments
    const filesBox = el('div', { class: 'crfiles' }, el('h4', {}, t('{n} changed files', { n: files.length })));
    for (const f of files) {
      const onLine = comments.filter((c) => c.anchor && c.anchor.path === f.path);
      const fileHead = el('div', { class: 'crfile' }, el('span', { class: `st ${f.status[0].toUpperCase()}` }, { added: 'A', removed: 'D', renamed: 'R', modified: 'M' }[f.status]), el('b', {}, f.path),
        el('span', { class: 'num' }, el('span', { class: 'a' }, `+${f.added} `), el('span', { class: 'd' }, `−${f.removed}`)));
      const body = Diff.render(f.diff, {
        empty: t('No text diff (binary or too large).'), commentTitle: t('Comment on this line'),
        onComment: s.state === 'open' ? (line, row) => lineCommentBox(row, async (txt) => {
          await window.hearth.cr.comment(d, n, txt, { path: f.path, oldPath: f.oldPath, oldLine: line.kind === 'added' ? null : line.oldLine, newLine: line.kind === 'removed' ? null : line.newLine }, det.refs);
          showCR(n);
        }) : null,
        comments: (line) => {
          const here = onLine.filter((c) => (c.anchor.newLine != null && c.anchor.newLine === line.newLine && line.kind !== 'removed') || (c.anchor.newLine == null && c.anchor.oldLine != null && c.anchor.oldLine === line.oldLine && line.kind === 'removed'));
          return here.length ? [thread(here, d, n)] : [];
        },
      });
      fileHead.addEventListener('click', () => body.classList.toggle('folded'));
      filesBox.append(fileHead, body);
      const outdated = onLine.filter((c) => c.outdated);
      if (outdated.length) filesBox.append(el('div', { class: 'hint gpad' }, t('{n} comments on lines that changed since', { n: outdated.length })));
    }
    box.replaceChildren(head, merge, conv, review, filesBox);
    box.scrollTop = 0;
  }
  function commentNode(c) {
    const kind = { approved: t('approved'), changesRequested: t('requested changes'), system: '' }[c.kind] || '';
    return el('div', { class: `crc ${c.kind}` }, el('div', { class: 'who' }, el('b', {}, c.author), kind ? el('span', { class: 'pill' }, kind) : '', el('small', {}, c.created ? new Date(c.created).toLocaleString() : '')), c.body ? el('div', { class: 'body' }, c.body) : '');
  }
  function thread(list, d, n) {
    const box = el('div', { class: 'crthread' }, ...list.map(commentNode));
    const root = list.find((c) => c.thread)?.thread;
    if (root) {
      const b = el('button', { class: 'ghost' }, t('Reply'));
      b.addEventListener('click', () => lineCommentBox(b, async (txt) => { await window.hearth.cr.reply(d, n, root, txt); showCR(n); }, true));
      box.append(b);
    }
    return box;
  }
  function lineCommentBox(after, send, replace = false) {
    const ta = el('textarea', { rows: '3', placeholder: t('Comment') });
    const ok = el('button', { class: 'primary' }, t('Comment')); const cancel = el('button', { class: 'ghost' }, t('Cancel'));
    const box = el('div', { class: 'crthread new' }, ta, el('div', { class: 'row' }, ok, cancel));
    cancel.addEventListener('click', () => { box.remove(); if (replace) after.hidden = false; });
    ok.addEventListener('click', async () => { if (!ta.value.trim()) return; ok.disabled = true; try { await send(ta.value); } catch (err) { alert(errMsg(err)); ok.disabled = false; } });
    if (replace) { after.hidden = true; after.after(box); } else after.after(box);
    ta.focus();
  }

  document.addEventListener('hearth:select', () => { lastSig = null; ciInfo = null; closeDetail(); $('#cr-list').replaceChildren(); $('#cr-count').textContent = ''; refresh(); if (tab === 'cr') loadCRs(); });
  document.addEventListener('hearth:saved', refresh);
  document.addEventListener('hearth:lang', () => { lastSig = null; labelCR(); labelGenerate(); refresh(); });
  document.addEventListener('hearth:tab', (e) => { if (e.detail === 'git') { refresh(); layoutSplit(); } });
  setInterval(() => { if ($('#insp-git').classList.contains('active') && document.hasFocus() && !busy) refresh(); }, 6000);
  window.GitView = { refresh, setTab, showCR, get renders() { return renders; }, get diffRenders() { return diffRenders; } };
})();
