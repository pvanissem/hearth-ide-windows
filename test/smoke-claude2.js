// Two sessions in the same project, like a login run followed by a normal start (scripts/smoke-claude.ps1 -Script test\smoke-claude2.js).
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const strip = (t) => t.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  const r = {};
  const text = {};
  window.hearth.onData(({ id, data }) => { text[id] = (text[id] || '') + data; });
  const first = await window.hearth.start({ kind: 'claude', directory: SMOKE_DIR, login: true });
  r.firstStarted = true;
  await wait(25000);
  r.first = strip(text[first.id] || '').replace(/\s+/g, ' ').slice(0, 160);
  let second;
  try { second = await window.hearth.start({ kind: 'claude', directory: SMOKE_DIR }); r.secondStarted = true; } catch (e) { r.secondStarted = false; r.secondError = String(e.message || e); return r; }
  await wait(30000);
  const t2 = strip(text[second.id] || '');
  r.cannotStart = /cannot start/.test(t2);
  r.second = t2.replace(/\s+/g, ' ').slice(0, 200);
  r.secondStatus = (await window.hearth.sessions()).find((s) => s.id === second.id)?.status;
  return r;
})()
