// Starts Claude Code in the sandbox through the UI and reports what the terminal shows.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};
  document.querySelector('#btn-start').click();
  await wait(400);
  document.querySelector('#start-kind').value = 'claude';
  document.querySelector('#start-dir').value = SMOKE_DIR;
  document.querySelector('#btn-go').click();
  await wait(12000);
  const s = (await window.hearth.sessions())[0];
  r.started = Boolean(s);
  r.sandboxed = s && s.sandboxed;
  r.status = s && s.status;
  r.screen = (document.querySelector('.term .xterm-rows')?.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 14);
  return r;
})()
