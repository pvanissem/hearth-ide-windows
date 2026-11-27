// Runs inside the app window (scripts/site-shots.ps1 defines PROJECT, the neutral demo project "campfire-demo").
// Takes the real screenshots for the landing page (site/assets/*.webp): the whole window, a phone crop,
// the guided spec review and the implementation step.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await wait(250); } return false; };
  const $ = (s) => document.querySelector(s);
  const h = window.hearth; const BS = String.fromCharCode(92); const r = {};
  const P = (...p) => [PROJECT, ...p].join(BS);
  /** Capture a region (CSS pixels), save it as WebP next to the smoke output. */
  async function shot(name, rect) {
    const url = await h.smokeCapture(rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null);
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    await h.smokeSave(name, c.toDataURL('image/webp', 0.88));
    r[name] = `${c.width}x${c.height}`;
  }
  const groupRect = (view) => document.querySelector(`.group[data-id="${Layout.model.groupOf(Layout.tree, view).id}"]`).getBoundingClientRect();

  // ---- English UI, Hearth theme, a sandbox session in the demo project ----
  await h.smokeSize(1600, 900); await wait(500);
  Layout.reset(); await wait(200);
  $('#btn-start').click(); await wait(300);
  $('#start-kind').value = 'shell'; $('#start-kind').dispatchEvent(new Event('change')); $('#start-dir').value = PROJECT; await wait(300);
  $('#btn-go').click();
  const s = await until(async () => (await h.sessions())[0], 15000);
  await wait(2500);
  const out = []; h.onData(({ id, data }) => { if (id === s.id) out.push(data); });
  const run = async (cmd, ms = 3000) => { h.input(s.id, cmd + '\r'); await wait(ms); };
  await run('cls', 600);
  await run('type src' + BS + 'campfire.js | findstr /n "farewell"', 1500);
  out.length = 0;
  await run('node test' + BS + 'campfire.test.js', 500);
  r.testsFinished = Boolean(await until(() => /pass 4/.test(out.join('')), 30000));
  await wait(800);
  // what an agent's turn end looks like: the program reports "done" with a message (OSC 7501)
  await run('node -e "process.stdout.write(String.fromCharCode(27)+\']7501;state=done:title=Tests green, 4 passed\'+String.fromCharCode(7))"', 2500);
  await h.rename(s.id, 'Add farewell() and its test'); await wait(800);

  // the inspector shows Git with the agent's changes
  Layout.show('git'); await wait(300); GitView.setTab('changes'); await GitView.refresh(); await wait(800);
  await shot('hearth-app.webp');
  // phone: sessions + chat only
  const left = groupRect('sessions'); const chat = groupRect('agent');
  await shot('hearth-app-phone.webp', { x: 0, y: 0, width: Math.min(chat.right, 1000), height: 900 });

  // ---- specs: guided review (requirements with findings) and implementation ----
  await h.smokeSize(1120, 1000); await wait(600);
  Layout.show('specs'); await wait(300);
  const gid = Layout.model.groupOf(Layout.tree, 'specs').id;
  document.querySelector(`.group[data-id="${gid}"] .gbtn[title="${t('Maximize')}"]`)?.click(); await wait(600);
  const specs = (await h.specs.scan(PROJECT)).specs;
  const review = specs.find((x) => x.name === 'Share a recipe'); const build = specs.find((x) => x.name === 'Ember timer');
  // tick two checklist items so the review looks in progress
  await h.specs.update(PROJECT, review.id, { check: { phase: 'requirements', index: 0, on: true } });
  await h.specs.update(PROJECT, review.id, { check: { phase: 'requirements', index: 1, on: true } });
  for (const p of ['requirements', 'design', 'tasks']) await h.specs.approve(PROJECT, build.id, p);
  const pick = async (id) => { await SpecsView.refresh(true); const sel = document.querySelector('#specs-root .spec-bar select'); sel.value = id; sel.dispatchEvent(new Event('change')); await wait(500); document.querySelector('#specs-root').scrollTop = 0; await wait(200); };
  await pick(review.id);
  await shot('spec-review.webp', groupRect('specs'));
  await pick(build.id);
  await shot('spec-build.webp', groupRect('specs'));
  return r;
})()
