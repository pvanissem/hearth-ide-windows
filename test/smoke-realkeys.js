// Real key presses from outside (scripts/test-realkeys.ps1 sends Ctrl+V to the window): what does a program in the sandbox receive?
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
  const tm = state.terms.get(s.id);
  window.hearth.input(s.id, `node -e "process.stdin.setRawMode(true);process.stdin.resume();console.log('LISTENING');process.stdin.on('data',d=>console.log('GOT '+JSON.stringify(d.toString())))"\r`);
  await until(() => /LISTENING/.test(strip(text[s.id] || '').replace(/node -e.*LISTENING'/, '')), 20000);
  await window.hearth.clipboard.write('REALCODE12345#STATEabc');
  tm.term.focus();
  r.ready = true;
  // the outside script presses Ctrl+V now
  r.gotAny = await until(() => /GOT ".*?"/.test(strip(text[s.id] || '')), 90000);
  await wait(2500);                                        // a second paste would show up here
  r.received = [...strip(text[s.id] || '').matchAll(/GOT (".*?")/g)].map((m) => JSON.parse(m[1])).join('');
  r.pastedOnce = r.received === 'REALCODE12345#STATEabc';
  r.menu = null;
  return r;
})()
