// What exactly does the terminal send to the sign-in prompt when a code is pasted?
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(300); } return false; };
  const strip = (t) => t.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
  const show = (s) => s.replace(/\x1b/g, '<ESC>').replace(/\r/g, '<CR>').replace(/\n/g, '<LF>');
  const r = {};
  const text = {};
  window.hearth.onData(({ id, data }) => { text[id] = (text[id] || '') + data; });
  const s = await window.hearth.start({ kind: 'claude', directory: SMOKE_DIR, login: true });
  state.sessions.set(s.id, s); attachTerminal(s); select(s.id); Layout.show('agent');
  const tm = state.terms.get(s.id);
  const sent = [];
  tm.term.onData((d) => sent.push(d));
  r.promptShown = await until(() => /Paste code here/.test(strip(text[s.id] || '')), 60000);
  r.bracketedPasteMode = tm.term.modes.bracketedPasteMode;
  r.modesSeen = (text[s.id].match(/\x1b\[\?[0-9;]+[hl]/g) || []).join(' ');
  await window.hearth.clipboard.write('abcDEF123_-xyz#STATE456');
  tm.host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await wait(800);
  r.sentByPaste = show(sent.join(''));
  return r;
})()
