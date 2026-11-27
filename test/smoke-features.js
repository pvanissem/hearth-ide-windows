// Runs inside the app window (scripts/smoke-features.ps1 defines PROJECT, a temporary Git repository).
// Drives the features ported from the macOS app: board and timers, OSC 7501, restart, layouts, Git tabs and details,
// specs (guided and free), agent hooks firing after a turn, Explorer clipboard, model choice in the start dialog.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await wait(250); } return false; };
  const $ = (s) => document.querySelector(s);
  const shot = (n) => window.hearth.smokeShot(n).catch(() => null);
  const h = window.hearth; const r = {}; const BS = String.fromCharCode(92);
  const errors = []; window.addEventListener('error', (e) => errors.push(String(e.message)));

  // ---- start dialog: model and effort only where the agent has them ----
  $('#btn-start').click(); await wait(400);
  $('#start-kind').value = 'claude'; $('#start-kind').dispatchEvent(new Event('change')); await wait(400);
  r.claudeModels = [...$('#start-model').options].map((o) => o.value).filter(Boolean).join(',');
  r.claudeEfforts = $('#start-effort').options.length - 1;
  $('#start-kind').value = 'shell'; $('#start-kind').dispatchEvent(new Event('change')); await wait(400);
  r.shellNoModel = $('#row-model').hidden;
  $('#start-dir').value = PROJECT; $('#start-dir').dispatchEvent(new Event('change'));
  const out = []; h.onData(({ data }) => out.push(data));
  $('#btn-go').click();
  const s = await until(async () => (await h.sessions())[0], 15000);
  await wait(3000);
  const run = async (cmd, ms = 2500) => { out.length = 0; h.input(s.id, cmd + '\r'); await wait(ms); return out.join(''); };

  // ---- OSC 7501 from a program in the terminal: status, progress, board ----
  await run('node -e "process.stdout.write(String.fromCharCode(27)+\']7501;state=working:progress=40\'+String.fromCharCode(7))"', 3000);
  r.oscRunning = state.sessions.get(s.id).status === 'running' && state.sessions.get(s.id).info?.progress === 40;
  r.progressBar = Boolean($('.card .prog span'));
  $('#view-seg [data-mode="board"]').click(); await wait(300);
  r.boardColumns = [...document.querySelectorAll('#board .bcol .sec span:first-child')].map((x) => x.textContent).join('|');
  r.boardCardWorking = Boolean(document.querySelector('#board .bcol.working .card'));
  await wait(1200);
  r.timer = $('#board .tmr')?.textContent || '';
  await shot('feat-board');

  // ---- agent hooks: an allowed FileSave hook fires after the turn and types its prompt into the agent ----
  const rel = await h.hooks.create(PROJECT, { name: 'Notes', trigger: 'FileSave', matcher: '\\.txt$', action: { type: 'agent', prompt: 'REM hook-was-here' } });
  let view = await h.hooks.get(PROJECT);
  r.hookNeedsPermission = view.files.find((f) => f.file === rel)?.trusted === true;   // Hearth's own new file stays allowed
  Layout.show('hooks'); await wait(800);
  r.hooksViewCards = document.querySelectorAll('#hooks-root .hook').length;
  await shot('feat-hooks');
  out.length = 0;
  // the "turn": working (OSC), the agent writes a file, done
  await run('echo note> notes.txt', 1500);
  await run('node -e "process.stdout.write(String.fromCharCode(27)+\']7501;state=done\'+String.fromCharCode(7))"', 4500);
  view = await h.hooks.get(PROJECT);
  r.hookActivity = view.activity.map((a) => `${a.hook}:${a.outcome}`).join(',');
  r.hookPromptTyped = await until(() => out.join('').includes('hook-was-here'), 6000);

  // ---- specs: create, quality check, guided card, send a step to the agent ----
  const id = await h.specs.create(PROJECT, { name: 'Export', idea: 'Export as PDF', kind: 'feature', guided: true });
  const reqFile = `${PROJECT}${BS}.hearth${BS}specs${BS}export${BS}requirements.md`;
  await h.write(reqFile, '# Requirements: Export\n\n### Requirement 1\n1. the system exports\n\n## Open questions\n- Which paper size?\n');
  Layout.show('specs'); await wait(300); await SpecsView.refresh(true); await wait(500);
  r.specJourney = document.querySelectorAll('#specs-root .jstep').length;
  r.specFindings = [...document.querySelectorAll('#specs-root .qf .qt')].map((x) => x.textContent).join(' | ');
  r.specApproveLocked = [...document.querySelectorAll('#specs-root button.primary')].some((b) => b.disabled);
  await shot('feat-specs-guided');
  out.length = 0;
  await h.specs.send({ dir: PROJECT, sessionId: s.id, id, action: 'fix', opts: { finding: 'req-ears' } });
  r.specPromptTyped = await until(() => out.join('').includes('requirements.md'), 5000);
  await h.specs.update(PROJECT, id, { guided: false }); await SpecsView.refresh(true); await wait(300);
  r.specFreeTabs = document.querySelectorAll('#specs-root .gtabs-bar button').length;
  await shot('feat-specs-free');

  // ---- Git: tabs, commit details with line numbers, branch details ----
  Layout.show('git'); await wait(300);
  await GitView.refresh(); await wait(500);
  GitView.setTab('history'); await wait(300);
  $('#git-log .commit')?.click();
  r.commitDiffLines = await until(() => document.querySelectorAll('#git-diff .dl').length, 5000);
  GitView.setTab('branches'); await wait(200);
  $('#branch-list .bcard')?.click();
  r.branchCommits = await until(() => document.querySelectorAll('#git-diff .commit').length, 5000);
  GitView.setTab('changes'); await wait(300);
  $('#git-files .gf')?.click();
  r.fileDiff = await until(() => document.querySelectorAll('#git-diff .dl.added').length, 5000);
  r.generateButton = !$('#btn-generate').hidden;
  const gid = Layout.model.groupOf(Layout.tree, 'git').id;
  document.querySelector(`.group[data-id="${gid}"] .gbtn[title="${t('Maximize')}"]`)?.click(); await wait(600);
  r.gitWide = $('#git-split').classList.contains('wide');
  await shot('feat-git-wide');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(300);

  // ---- layouts: preset, save, restore ----
  Layout.preset('spec'); await wait(300);
  r.specLayout = Layout.model.groups(Layout.tree).map((g) => g.views.join(',')).join(' | ');
  Layout.save('Mine'); Layout.reset(); await wait(200);
  r.savedLayouts = Layout.saved().join(',');
  r.restoredLayout = Layout.restore('Mine') && Layout.model.groupOf(Layout.tree, 'specs') !== Layout.model.groupOf(Layout.tree, 'git');
  Layout.reset();

  // ---- Explorer clipboard: our copy is readable as a file list; pasting files from it copies them ----
  await h.files.clipCopy([`${PROJECT}${BS}notes.txt`]);
  r.clipFiles = (await h.files.clipHasFiles()).map((p) => p.split(BS).pop()).join(',');
  await h.files.create(PROJECT, 'sub', true);
  r.clipPasted = (await h.files.clipPaste(`${PROJECT}${BS}sub`)).map((p) => p.split(BS).slice(-2).join('/')).join(',');

  // ---- restart after rule changes: a waiting session restarts now ----
  const before = out.length;
  const rr = await h.restartAll();
  r.restart = `${rr.now}/${rr.later}`;
  r.restartedRunning = await until(async () => (await h.sessions())[0]?.status !== 'done' && out.slice(before).join('').includes('restarting'), 10000);

  // ---- editor autosave: off keeps the change in the editor, "after a short pause" writes it, "focus" on blur ----
  const file = `${PROJECT}${BS}readme.md`;
  state.settings = await h.setSettings({ ...state.settings, autosave: 'off' });
  await openFile(file); await wait(300);
  state.editor.trigger('smoke', 'type', { text: 'X' }); await wait(1500);
  r.autosaveOffKeeps = !(await h.read(file)).startsWith('X') && state.docs.get(file).dirty;
  state.settings = await h.setSettings({ ...state.settings, autosave: 'afterDelay' });
  state.editor.trigger('smoke', 'type', { text: 'Y' });
  r.autosaveDelay = Boolean(await until(async () => (await h.read(file)).startsWith('XY') && !state.docs.get(file).dirty, 5000));
  state.settings = await h.setSettings({ ...state.settings, autosave: 'onFocusChange' });
  state.editor.focus(); state.editor.trigger('smoke', 'type', { text: 'Z' }); await wait(1500);
  const notYet = !(await h.read(file)).startsWith('XYZ');
  document.activeElement.blur();
  r.autosaveFocus = notYet && Boolean(await until(async () => (await h.read(file)).startsWith('XYZ'), 5000));
  state.settings = await h.setSettings({ ...state.settings, autosave: 'off' });

  r.errors = errors.join(' | ');
  $('#view-seg [data-mode="list"]').click();
  return r;
})()
