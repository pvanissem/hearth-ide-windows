// A login run ("Run the agent's login first") in the given project; reports what the terminal shows.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const strip = (t) => t.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
  const r = {};
  const text = {};
  window.hearth.onData(({ id, data }) => { text[id] = (text[id] || '') + data; });
  let s;
  try { s = await window.hearth.start({ kind: 'claude', directory: SMOKE_DIR, login: true }); r.started = true; } catch (e) { r.started = false; r.startError = String(e.message || e); return r; }
  await wait(45000);
  const t = strip(text[s.id] || '');
  r.cannotStart = /cannot start/.test(t);
  r.text = t.replace(/\s+/g, ' ').slice(0, 300);
  r.status = (await window.hearth.sessions()).find((x) => x.id === s.id)?.status;
  return r;
})()
