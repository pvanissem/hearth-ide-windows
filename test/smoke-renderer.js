(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};
  const h = window.hearth;
  r.env = await h.detect();
  r.agents = (await h.agents()).map((a) => a.id);
  // Without WSL/nono the start must be refused unless the user opted in.
  try { await h.start({ kind: 'shell', directory: SMOKE_DIR }); r.refusedWithoutOptIn = false; } catch (e) { r.refusedWithoutOptIn = /WSL2|nono/.test(String(e)); }
  await h.setSettings({ allowUnsandboxed: true });
  // Outside the workspace: must be refused.
  try { await h.list('C:\\Windows'); r.outsideRefused = false; } catch { r.outsideRefused = true; }

  // Start through the real UI path.
  document.querySelector('#btn-start').click();
  await wait(300);
  document.querySelector('#start-kind').value = 'shell';
  document.querySelector('#start-dir').value = SMOKE_DIR;
  const out = [];
  h.onData(({ data }) => out.push(data));
  document.querySelector('#btn-go').click();
  await wait(2500);
  const s = (await h.sessions())[0];
  r.sandboxed = s.sandboxed;
  r.sessionInUi = document.querySelectorAll('#session-list li').length;
  h.input(s.id, 'echo hearth-smoke-ok\r');
  await wait(2500);
  r.ptyEcho = out.join('').includes('hearth-smoke-ok');
  r.termRendered = document.querySelector('.term .xterm-rows')?.textContent.includes('hearth-smoke-ok') || false;
  r.files = (await h.list(SMOKE_DIR)).map((e) => e.name).slice(0, 8);
  r.pkg = (await h.read(SMOKE_DIR + '\\package.json')).slice(0, 20);
  r.isRepo = await h.git.isRepo(SMOKE_DIR);
  const st = await h.git.status(SMOKE_DIR);
  r.branch = st.branch; r.changed = st.files.length;
  r.logCount = (await h.git.log(SMOKE_DIR)).length;
  try { await h.write(SMOKE_DIR + '\\.git\\hooks\\pre-commit', 'x'); r.hooksProtected = false; } catch (e) { r.hooksProtected = /write-protected/.test(String(e)); }
  r.status = (await h.sessions())[0].status;
  r.treeNodes = document.querySelectorAll('#tree .node').length;
  document.querySelector('#insp-tabs [data-tab="git"]').click();
  await wait(800);
  r.gitRows = document.querySelectorAll('#git-files .gf').length;
  document.querySelector('#insp-tabs [data-tab="files"]').click();
  await openFile(SMOKE_DIR + '\\package.json');
  await wait(2500);
  r.monaco = monaco.editor.getModels().some((m) => m.getValue().includes('hearth-ide-windows'));
  r.editorLang = monaco.editor.getModels()[0]?.getLanguageId();
  return r;
})()
