'use strict';
// CI/CD: GitHub Actions and GitLab pipelines of the repository's remote.
// Polling (15 s while something runs, else 60 s) never empties the pane: data is fetched first and only a change is
// drawn, so an opened job log and the scroll position stay where they are.
(() => {
  const C = window.hearth.ci;
  let info = null; let selected = null; let timer = null; let pipelines = [];
  let lastSig = null; let lastJobsSig = null;
  const ICON = { success: '✓', failed: '✗', running: '↻', pending: '…', canceled: '⊘', skipped: '–', manual: '▶' };
  const active = () => $('#insp-ci').classList.contains('active');

  /** Another project (or first start): show it from scratch. */
  function reset() {
    lastSig = null; lastJobsSig = null; selected = null; pipelines = [];
    $('#ci-list').replaceChildren(); $('#ci-jobs').replaceChildren(); $('#ci-jobs-title').textContent = ''; $('#ci-log').hidden = true;
  }

  function drawList() {
    const rows = pipelines.map((p) => {
      const row = el('div', { class: `pipe ${p.id === selected ? 'sel' : ''}`, 'data-id': String(p.id) }, el('span', { class: `st-${p.status}` }, ICON[p.status] || '?'), el('span', {}, `${p.name}  ${p.ref || ''}`, el('small', { class: 'hint' }, `  ${p.sha}`)), el('small', { class: 'hint' }, p.created ? new Date(p.created).toLocaleString(I18n.lang === 'de' ? 'de-DE' : 'en-GB') : ''));
      row.addEventListener('click', () => openPipeline(p));
      return row;
    });
    if (!pipelines.length) rows.push(el('div', { class: 'hint' }, t('No pipelines yet.')));
    const scroller = $('#insp-ci'); const top = scroller.scrollTop;
    $('#ci-list').replaceChildren(...rows);
    scroller.scrollTop = top;
  }

  async function load() {
    const s = cur();
    const head = $('#ci-head');
    if (!s) { head.textContent = t('No session selected'); return; }
    let nextInfo; let nextPipes = [];
    try {
      nextInfo = await C.info(s.directory);
      if (!nextInfo) { head.textContent = t('No GitHub or GitLab remote found in this repository.'); info = null; return; }
      head.textContent = `${nextInfo.provider === 'github' ? 'GitHub Actions' : 'GitLab'} - ${nextInfo.host}/${nextInfo.path}${nextInfo.hasToken ? '' : ' - ' + t('no token (Settings > Credentials)')}`;
      info = nextInfo;
      if (!nextInfo.hasToken) return;
      nextPipes = await C.pipelines(s.directory);
    } catch (err) { head.textContent = errMsg(err); return; }
    if (s !== cur()) return;                          // the user switched sessions meanwhile
    pipelines = nextPipes;
    const sig = JSON.stringify([s.id, I18n.lang, pipelines, selected]);
    if (sig !== lastSig) { lastSig = sig; drawList(); }
    if (selected) { const p = pipelines.find((x) => x.id === selected); if (p) await openPipeline(p, true); }
    schedule();
  }

  async function openPipeline(p, keep) {
    const s = cur(); selected = p.id;
    if (!keep) { $('#ci-log').hidden = true; lastJobsSig = null; }
    document.querySelectorAll('#ci-list .pipe').forEach((r) => r.classList.toggle('sel', r.dataset.id === String(p.id)));
    $('#ci-jobs-title').textContent = `${p.name} - ${t(p.status)}`;
    let jobs;
    try { jobs = await C.jobs(s.directory, p.id); } catch (err) { $('#ci-jobs').replaceChildren(el('div', { class: 'hint' }, errMsg(err))); lastJobsSig = null; return; }
    const sig = JSON.stringify([p.id, p.status, jobs, I18n.lang]);
    if (sig === lastJobsSig) return;                  // same jobs: leave the list (and the open log) alone
    lastJobsSig = sig;

    const nodes = [];
    const bar = el('div', { class: 'row wrap' });
    for (const [label, fn] of [[t('Retry'), () => C.retry(s.directory, p.id)], [t('Cancel'), () => C.cancel(s.directory, p.id)], [t('Open in browser'), () => window.hearth.open(p.url)]]) {
      const b = el('button', { class: 'ghost' }, label);
      b.addEventListener('click', async () => { try { await fn(); setTimeout(load, 800); } catch (err) { alert(errMsg(err)); } });
      bar.append(b);
    }
    nodes.push(bar);
    for (const j of jobs) {
      const row = el('div', { class: 'pipe' }, el('span', { class: `st-${j.status}` }, ICON[j.status] || '?'), el('span', {}, j.name, el('small', { class: 'hint' }, `  ${j.stage}`)), el('span', {}));
      row.addEventListener('click', async () => {
        const pre = $('#ci-log'); pre.hidden = false; pre.textContent = t('Loading...');
        try { pre.textContent = await C.log(s.directory, j.id); pre.scrollTop = pre.scrollHeight; } catch (err) { pre.textContent = errMsg(err); }
      });
      const acts = row.lastChild;
      const rb = el('button', { class: 'ghost' }, t('Retry'));
      rb.addEventListener('click', async (e) => { e.stopPropagation(); try { await C.retryJob(s.directory, j.id); setTimeout(load, 800); } catch (err) { alert(errMsg(err)); } });
      acts.append(rb);
      if (j.status === 'manual') { const pb = el('button', { class: 'ghost' }, t('Play')); pb.addEventListener('click', async (e) => { e.stopPropagation(); try { await C.playJob(s.directory, j.id); setTimeout(load, 800); } catch (err) { alert(errMsg(err)); } }); acts.append(pb); }
      nodes.push(row);
    }
    $('#ci-jobs').replaceChildren(...nodes);
  }

  // 15 s while something runs, otherwise 60 s - only while the tab is visible
  function schedule() {
    clearTimeout(timer);
    const busy = pipelines.some((p) => p.status === 'running' || p.status === 'pending');
    timer = setTimeout(() => { if (active() && document.hasFocus()) load(); else schedule(); }, busy ? 15000 : 60000);
  }

  $('#ci-reload').addEventListener('click', load);
  $('#ci-run').addEventListener('click', async () => {
    const s = cur(); if (!s || !info) return;
    try {
      const st = await window.hearth.git.status(s.directory);
      let workflow;
      if (info.provider === 'github') {
        const wf = await C.workflows(s.directory);
        if (!wf.length) { alert(t('No active workflows found.')); return; }
        const pick = prompt(`${t('Workflow to run on')} ${st.branch}:\n${wf.map((w, i) => `${i + 1}  ${w.name}`).join('\n')}`, '1');
        if (!pick) return;
        workflow = wf[Number(pick) - 1]?.id;
      } else if (!confirm(t('Run a pipeline for {branch}?', { branch: st.branch }))) return;
      await C.run(s.directory, st.branch, workflow);
      setTimeout(load, 1500);
    } catch (err) { alert(errMsg(err)); }
  });
  $('#ci-token').addEventListener('click', () => { $('#btn-settings').click(); document.querySelector('#set-tabs [data-tab="creds"]').click(); if (info) $('#cred-host').value = info.host; });

  document.addEventListener('hearth:select', () => { reset(); load(); });
  document.addEventListener('hearth:lang', () => { lastSig = null; lastJobsSig = null; if (active()) load(); });
  document.addEventListener('hearth:tab', (e) => { if (e.detail === 'ci') load(); });
  window.CIView = { load };
})();
