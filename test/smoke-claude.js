// Starts Claude Code in the sandbox through the real start path (journal arguments, PTY) and reports what the terminal shows.
// Run with scripts/smoke-claude.ps1 [-Packaged].
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};
  let s;
  try { s = await window.hearth.start({ kind: 'claude', directory: SMOKE_DIR }); r.started = true; } catch (e) { r.started = false; r.startError = String(e.message || e); return r; }
  const out = [];
  window.hearth.onData(({ data }) => out.push(data));
  await wait(40000);
  const text = out.join('').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  r.sandboxed = s.sandboxed;
  r.status = (await window.hearth.sessions())[0]?.status;
  r.cannotStart = /cannot start/.test(text);
  r.welcome = /Welcome to Claude Code|Claude Code|Choose the text style|trust/i.test(text);
  r.screen = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 12);
  return r;
})()
