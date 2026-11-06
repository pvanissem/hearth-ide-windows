'use strict';
// Build & Deployment (tasks and services, run in the sandbox) and Tests (JUnit reports + test runs).
(() => {
  const B = window.hearth.build;
  const strip = (s) => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  let run = null;   // { id, title, from, el, onEnd }

  async function follow(id, title, out, onEnd) {
    if (run && run.timer) clearInterval(run.timer);
    run = { id, title, from: 0 };
    out.hidden = false; out.textContent = '';
    $('#build-stop').disabled = false;
    const tick = async () => {
      try {
        const r = await B.output(id, run.from);
        if (r.text) { const atEnd = out.scrollTop + out.clientHeight >= out.scrollHeight - 20; out.textContent += strip(r.text); if (atEnd) out.scrollTop = out.scrollHeight; }
        run.from = r.next;
        if (r.state !== 'running') {
          clearInterval(run.timer); $('#build-stop').disabled = true;
          out.textContent += `\n[${t(r.state === 'done' ? 'finished' : r.state === 'stopped' ? 'stopped' : 'failed')}${r.code != null ? ` - exit ${r.code}` : ''}]\n`;
          out.scrollTop = out.scrollHeight;
          onEnd?.(r);
          loadTasks();
        }
      } catch { clearInterval(run.timer); }
    };
    run.timer = setInterval(tick, 500); tick();
  }

  // ----- Build & Deployment -----
  async function loadTasks() {
    const s = cur(); const box = $('#build-tasks'); box.replaceChildren();
    if (!s) { box.append(el('div', { class: 'hint' }, t('No session selected'))); return; }
    let tasks = [];
    try { tasks = await B.tasks(s.directory); } catch (err) { box.append(el('div', { class: 'hint' }, errMsg(err))); return; }
    if (!tasks.length) { box.append(el('div', { class: 'hint' }, t('No build tasks found (package.json, Maven, Gradle, Go, Cargo, Makefile or .hearth/tasks.json).'))); return; }
    let tool = null;
    for (const task of tasks) {
      if (task.tool !== tool) { tool = task.tool; box.append(el('div', { class: 'tool' }, el('span', {}, ''), el('span', { class: 'pill' }, tool))); box.lastChild.firstChild.innerHTML = Icons.html('package', 16); }
      const running = run && run.taskId === task.id && $('#build-stop').disabled === false;
      const b = el('button', { class: running ? '' : 'primary', title: running ? t('Running...') : task.kind === 'service' ? t('Start') : t('Run') });
      b.innerHTML = Icons.html(running ? 'refresh' : 'play', 13);
      b.disabled = Boolean(running);
      b.addEventListener('click', async () => {
        try {
          const r = await B.start(s.directory, task.id);
          $('#build-title').textContent = `${task.title} (${task.command})`;
          follow(r.id, task.title, $('#build-out'));
          run.taskId = task.id; loadTasks();
          if (task.port) $('#build-title').textContent += `  - http://localhost:${task.port}`;
        } catch (err) { alert(errMsg(err)); }
      });
      const ti = el('span', { class: 'ti' }); ti.innerHTML = Icons.html(task.kind === 'service' ? 'globe' : task.test ? 'flask' : 'wrench', 15);
      box.append(el('div', { class: `task ${task.kind}` }, ti,
        el('span', { class: 'tn' }, el('b', {}, task.title), ' ', task.kind === 'service' ? el('span', { class: 'pill mono' }, t('service')) : '', el('small', { title: task.command }, task.command)), b));
    }
  }
  $('#build-stop').addEventListener('click', () => { if (run) B.stop(run.id); });

  // ----- Tests -----
  async function loadTests() {
    const s = cur(); const list = $('#tests-list'); list.replaceChildren();
    if (!s) { $('#tests-summary').textContent = t('No session selected'); return; }
    let r;
    try { r = await window.hearth.tests.load(s.directory); } catch (err) { $('#tests-summary').textContent = errMsg(err); return; }
    const m = r.summary;
    $('#tests-summary').textContent = m.total ? t('{total} tests: {passed} passed, {failed} failed, {skipped} skipped', m) : t('No test reports found (JUnit XML under target/surefire-reports, build/test-results, junit.xml ...).');
    const bySuite = new Map();
    for (const c of r.cases) { if (!bySuite.has(c.suite)) bySuite.set(c.suite, []); bySuite.get(c.suite).push(c); }
    const suites = [...bySuite.entries()].sort((a, b) => b[1].filter((x) => x.status === 'failed').length - a[1].filter((x) => x.status === 'failed').length);
    for (const [name, cases] of suites) {
      const failed = cases.filter((x) => x.status === 'failed').length;
      list.append(el('h4', {}, `${name}  (${cases.length}${failed ? `, ${failed} ${t('failed')}` : ''})`));
      for (const c of cases.sort((a, b) => (b.status === 'failed') - (a.status === 'failed'))) {
        list.append(el('div', { class: `trow ${c.status === 'failed' ? 'fail' : ''}` }, el('span', { class: c.status === 'failed' ? 'st-failed' : c.status === 'skipped' ? 'st-skipped' : 'st-success' }, c.status === 'failed' ? '✗' : c.status === 'skipped' ? '–' : '✓'), el('span', {}, c.name), el('small', {}, `${c.time.toFixed(2)}s`)));
        if (c.message) list.append(el('div', { class: 'tmsg' }, c.message));
      }
    }
  }
  $('#tests-reload').addEventListener('click', loadTests);
  $('#tests-run').addEventListener('click', async () => {
    const s = cur(); if (!s) return;
    try {
      const r = await window.hearth.tests.run(s.directory);
      $('#tests-run').disabled = true;
      follow(r.id, r.title, $('#tests-out'), () => { $('#tests-run').disabled = false; loadTests(); });
    } catch (err) { alert(errMsg(err)); }
  });

  document.addEventListener('hearth:select', () => { loadTasks(); loadTests(); });
  document.addEventListener('hearth:tab', (e) => { if (e.detail === 'build') loadTasks(); if (e.detail === 'tests') loadTests(); });
})();
