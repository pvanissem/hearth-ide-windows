// Runs inside the app window (injected by scripts/smoke.ps1, which defines SMOKE_DIR, SECRET, OUTSIDE).
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const BS = String.fromCharCode(92);
  const r = {};
  const h = window.hearth;
  r.env = await h.detect();
  r.agents = (await h.agents()).map((a) => a.id);
  try { await h.list('C:' + BS + 'Windows'); r.outsideRefused = false; } catch { r.outsideRefused = true; }

  // Start a sandboxed shell through the real UI path.
  document.querySelector('#btn-start').click();
  await wait(300);
  document.querySelector('#start-kind').value = 'shell';
  document.querySelector('#start-dir').value = SMOKE_DIR;
  const out = [];
  h.onData(({ data }) => out.push(data));
  document.querySelector('#btn-go').click();
  await wait(4500);
  const s = (await h.sessions())[0];
  r.sandboxed = s && s.sandboxed;
  r.backend = s && s.backend;
  r.sessionInUi = document.querySelectorAll('#session-list li').length;
  const strip = (t) => t.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  const run = async (cmd, ms = 2500) => { out.length = 0; h.input(s.id, cmd + '\r'); await wait(ms); return strip(out.join('')); };
  const denied = (t) => /denied|verweigert|Zugriff|Access/i.test(t);

  r.echo = (await run('echo hearth-smoke-ok')).includes('hearth-smoke-ok');
  r.termRendered = (document.querySelector('.term .xterm-rows')?.textContent || '').includes('hearth-smoke-ok');
  // Isolation inside the real PTY:
  const secret = await run('type "' + SECRET + '"');
  r.secretReadBlocked = !secret.includes('TOPSECRET') && denied(secret);
  r.projectRead = (await run('type package.json')).includes('hearth-ide-windows-fixture');
  await run('echo sandbox-ok> sandbox-write-test.tmp');
  r.projectWrite = (await h.read(SMOKE_DIR + BS + 'sandbox-write-test.tmp').catch(() => '')).includes('sandbox-ok');
  r.outsideWriteBlocked = denied(await run('echo x> "' + OUTSIDE + '"'));
  r.hooksBlocked = denied(await run('echo x> .git' + BS + 'hooks' + BS + 'pre-commit'));
  const who = await run('whoami /user');
  r.whoami = (who.match(/S-1-15-2-[\d-]+/) || ['(no appcontainer sid)'])[0].slice(0, 22) + '...';

  r.files = (await h.list(SMOKE_DIR)).map((e) => e.name).slice(0, 8);
  r.isRepo = await h.git.isRepo(SMOKE_DIR);
  r.branch = (await h.git.status(SMOKE_DIR)).branch;
  r.status = (await h.sessions())[0].status;
  document.querySelector('#insp-tabs [data-tab="git"]').click();
  await wait(800);
  r.gitRows = document.querySelectorAll('#git-files .gf').length;
  document.querySelector('#insp-tabs [data-tab="files"]').click();
  await openFile(SMOKE_DIR + BS + 'package.json');
  await wait(2500);
  r.monaco = monaco.editor.getModels().some((m) => m.getValue().includes('hearth-ide-windows-fixture'));
  document.querySelector('#center-tabs [data-tab="agent"]').click();
  await wait(500);
  await h.remove(s.id);
  return r;
})()
