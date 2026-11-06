// The sign-in flow of an agent: login run -> prompt -> window loses and regains focus (browser round trip) -> paste the code.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(300); } return false; };
  const strip = (t) => t.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
  const r = {};
  const text = {};
  window.hearth.onData(({ id, data }) => { text[id] = (text[id] || '') + data; });
  const s = await window.hearth.start({ kind: 'claude', directory: SMOKE_DIR, login: true });
  state.sessions.set(s.id, s); attachTerminal(s); select(s.id); Layout.show('agent');
  r.promptShown = await until(() => /Paste code here/.test(strip(text[s.id] || '')), 60000);
  r.loginHint = !$('#login-hint').hidden;
  // the browser round trip: nothing has focus any more, then the window gets it back
  document.activeElement?.blur();
  r.focusLostInTest = document.activeElement === document.body;
  window.dispatchEvent(new Event('focus')); await wait(400);
  r.focusBack = document.activeElement?.classList.contains('xterm-helper-textarea') === true;
  // Ctrl+V on the terminal
  await window.hearth.clipboard.write('FAKECODEONE#state123');
  const ta = document.activeElement;
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  r.ctrlVPasted = await until(() => strip(text[s.id] || '').includes('FAKECODEONE'), 5000);
  // right-click paste
  await window.hearth.clipboard.write('FAKECODETWO');
  state.terms.get(s.id).host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  r.rightClickPasted = await until(() => strip(text[s.id] || '').includes('FAKECODETWO'), 5000);
  // Is the input delivered although it is not shown? Confirm it: a (wrong) code makes Claude answer.
  const before = strip(text[s.id] || '').length;
  await window.hearth.clipboard.write('NOTAREALCODE#state123');
  state.terms.get(s.id).host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await wait(600);
  window.hearth.input(s.id, '\r');
  r.answered = await until(() => strip(text[s.id] || '').length > before + 20, 40000);
  r.answer = strip(text[s.id] || '').slice(before).replace(/\s+/g, ' ').slice(0, 300);
  r.echoed = strip(text[s.id] || '').includes('NOTAREALCODE');
  r.tail = strip(text[s.id] || '').replace(/\s+/g, ' ').slice(-200);
  return r;
})()
