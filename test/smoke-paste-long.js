// Does a long pasted text (like an OAuth code with state, ~100-300 characters) arrive complete in a sandboxed terminal?
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(250); } return false; };
  const strip = (t) => t.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
  const r = {};
  const text = {};
  window.hearth.onData(({ id, data }) => { text[id] = (text[id] || '') + data; });
  const s = await window.hearth.start({ kind: 'shell', directory: SMOKE_DIR });
  state.sessions.set(s.id, s); attachTerminal(s); select(s.id); Layout.show('agent');
  await wait(4000);
  for (const len of [60, 120, 300, 900]) {
    const code = ('Ab1_-~#%+/=.').repeat(Math.ceil(len / 12)).slice(0, len).replace(/%/g, 'p');   // cmd would expand %..%
    await window.hearth.clipboard.write('echo START' + code + 'END');
    state.terms.get(s.id).host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await wait(500);
    window.hearth.input(s.id, '\r');
    const full = 'START' + code + 'END';
    r['len' + len] = await until(() => strip(text[s.id] || '').replace(/\r?\n/g, '').split(full).length >= 3, 8000);   // echoed command + its output
  }
  r.tail = strip(text[s.id] || '').replace(/\s+/g, ' ').slice(-160);
  return r;
})()
