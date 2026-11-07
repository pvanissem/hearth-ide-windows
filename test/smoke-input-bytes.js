// Which bytes does a program inside the sandbox really receive? A listener prints every chunk it gets from the terminal.
// Simulates the sign-in round trip: an agent UI switched on focus reports, the window loses and regains focus, a code is pasted.
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
  r.listening = await until(() => /LISTENING/.test(strip(text[s.id] || '').replace(/node -e.*LISTENING'/, '')), 20000);
  tm.term.write('\x1b[?1004h');                                   // an agent UI asks for focus reports
  await wait(200);
  r.focusReportsOn = tm.term.modes.sendFocusMode;
  // the round trip to the browser: the terminal's text area loses and regains focus (synthetic events: the test window has no real focus)
  const ta = tm.host.querySelector('textarea');
  const emitted = []; tm.term.onData((d) => emitted.push(d.replace(/\x1b/g, '<ESC>')));
  ta.dispatchEvent(new FocusEvent('blur')); await wait(200);
  ta.dispatchEvent(new FocusEvent('focus')); await wait(300);
  r.xtermEmitted = emitted.join('');                                // what xterm itself produced (before our filter)
  const code = 'abcDEF123_-xyz#STATE456';
  await window.hearth.clipboard.write(code);
  tm.host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await wait(1500);
  const got = [...strip(text[s.id] || '').matchAll(/GOT (".*?")/g)].map((m) => JSON.parse(m[1]));
  const raw = [...(text[s.id] || '').matchAll(/GOT (".*?")/g)].map((m) => m[1]);
  r.received = got.join('');
  r.receivedExactlyTheCode = r.received === code;
  r.chunks = raw.length;
  r.escapeBytesReceived = raw.some((c) => /\\u001b/.test(c));
  r.rawChunks = raw.slice(0, 6);
  return r;
})()
