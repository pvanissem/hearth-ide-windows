// Runs inside the app window (injected by scripts/smoke.ps1, which defines SMOKE_DIR, SECRET, OUTSIDE).
// Drives the real UI: sandboxed shell, escape attempts, journal, themes, German UI, search, usages,
// build, tests, architecture, git, settings.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await wait(250); } return false; };
  const BS = String.fromCharCode(92);
  const $ = (s) => document.querySelector(s);
  const click = (s) => $(s).click();
  const shot = (n) => window.hearth.smokeShot(n).catch(() => null);
  const r = {};
  const h = window.hearth;
  r.env = (await h.detect()).backend;
  r.agents = (await h.agents()).map((a) => a.id).length;
  try { await h.list('C:' + BS + 'Windows'); r.outsideRefused = false; } catch { r.outsideRefused = true; }

  // ---- sandboxed shell through the UI ----
  click('#btn-start'); await wait(300);
  $('#start-kind').value = 'shell'; $('#start-dir').value = SMOKE_DIR;
  const out = []; h.onData(({ data }) => out.push(data));
  click('#btn-go');
  const s = await until(async () => (await h.sessions())[0], 15000);
  await wait(3500);
  r.sandboxed = Boolean(s && s.sandboxed); r.backend = s && s.backend;
  const strip = (t) => t.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  const run = async (cmd, ms = 2500) => { out.length = 0; h.input(s.id, cmd + '\r'); await wait(ms); return strip(out.join('')); };
  const denied = (t) => /denied|verweigert|Zugriff|Access/i.test(t);
  r.historySaved = (await h.history.list()).some((x) => x.kind === 'shell' && x.directory.toLowerCase() === SMOKE_DIR.toLowerCase());
  click('#btn-start'); await wait(500);
  r.recentShown = !$('#start-recent').hidden && $('#start-recent').textContent.length > 0; $('#dlg-start').close(); await wait(100);
  r.echo = (await run('echo hearth-smoke-ok')).includes('hearth-smoke-ok');
  // ---- terminal: right-click copies a selection / pastes, links are recognised, odd links are refused ----
  const tm = state.terms.get(s.id);
  tm.term.selectAll();
  tm.host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await wait(500);
  r.rightClickCopies = (await h.clipboard.read()).includes('hearth-smoke-ok') && !tm.term.hasSelection();
  await h.clipboard.write('echo pasted-by-menu');
  out.length = 0;
  tm.host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await wait(500); h.input(s.id, '\r'); await wait(1500);
  r.rightClickPastes = strip(out.join('')).includes('pasted-by-menu');
  r.pasteToast = document.getElementById('toast')?.classList.contains('on') === true;
  r.linkProviders = tm.term._core?._linkProviderService?.linkProviders?.length ?? -1;
  r.badLinksRefused = (await Promise.all(['file:///C:/Windows/win.ini', 'http://evil.example.com/', 'javascript:alert(1)', 'https://x y'].map((u) => h.open(u).then(() => false, () => true)))).every(Boolean);

  r.secretReadBlocked = denied(await run('type "' + SECRET + '"'));
  r.projectRead = (await run('type package.json')).includes('hearth-ide-windows-fixture');
  await run('echo sandbox-ok> sandbox-write-test.tmp');
  r.projectWrite = (await h.read(SMOKE_DIR + BS + 'sandbox-write-test.tmp').catch(() => '')).includes('sandbox-ok');
  r.outsideWriteBlocked = denied(await run('echo x> "' + OUTSIDE + '"'));
  r.hooksBlocked = denied(await run('echo x> .git' + BS + 'hooks' + BS + 'pre-commit'));
  await run('del sandbox-write-test.tmp', 800);

  // ---- Overview: the agent records its work with hearth-journal inside the sandbox ----
  await run('hearth-journal step s1 --title "Plan the work" --status running', 1500);
  await run('hearth-journal decision d1 --parent s1 --title "Use SQLite" --why "no server needed" --rejected "Postgres"', 1500);
  await run('hearth-journal question q1 --parent s1 --title "Which port?"', 1500);
  Layout.show('overview');
  r.journalNodes = await until(async () => { const n = document.querySelectorAll('#jr-tree .jn').length; return n >= 3 ? n : 0; }, 8000);
  r.journalWhy = $('#jr-tree').textContent.includes('no server needed') && $('#jr-tree').textContent.includes('Postgres');
  await shot('overview');
  window.prompt = () => 'too heavy';
  out.length = 0;
  [...document.querySelectorAll('#jr-tree .jn')].find((n) => n.textContent.includes('Use SQLite')).querySelector('.acts button').click();
  r.journalRevoked = Boolean(await until(() => $('#jr-tree .jn.revoked'), 6000));
  r.revokePromptSent = Boolean(await until(() => strip(out.join('')).includes('revoking decision d1'), 4000));

  // ---- themes ----
  const bg = () => getComputedStyle(document.body).backgroundColor;
  const themes = {};
  for (const id of ['hearthLight', 'darcula', 'storm', 'system']) { Themes.apply(id); await wait(150); themes[id] = bg(); }
  r.themes = themes;
  r.themesDiffer = new Set(Object.values(themes)).size >= 3;
  Themes.apply('storm'); await wait(200);
  r.stormTerminal = state.terms.get(s.id).term.options.theme.background;

  // ---- editor, Monaco theme, usages ----
  await openFile(SMOKE_DIR + BS + 'src' + BS + 'app.js'); await wait(1500);
  r.monaco = monaco.editor.getModels().some((m) => m.getValue().includes('function greet'));
  r.monacoThemeApplied = Themes.monacoTheme(monaco) === 'hearth-storm';
  document.dispatchEvent(new CustomEvent('hearth:usages', { detail: { word: 'greet', file: SMOKE_DIR + BS + 'src' + BS + 'app.js' } }));
  r.usages = await until(async () => { const n = document.querySelectorAll('#usages-list .usage').length; return n >= 3 ? n : 0; }, 6000);
  await shot('editor-usages');
  $('#usages-close').click();

  // ---- Search Everywhere (Shift Shift) ----
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' })); await wait(120);
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' })); await wait(300);
  r.searchOpened = $('#dlg-search').open;
  $('#search-input').value = 'gre'; $('#search-input').dispatchEvent(new Event('input'));
  r.searchResults = await until(async () => { const t = $('#search-results').textContent; return t.includes('app.js') && !t.includes('Show files') ? document.querySelectorAll('#search-results li').length : 0; }, 8000);
  r.searchHasFileAndSymbol = $('#search-results').textContent.includes('app.js') && $('#search-results').textContent.includes('greet');
  await shot('search');
  $('#dlg-search').close();
  r.initialsMatch = (await h.search.files(SMOKE_DIR, 'ht')).some((x) => x.rel.endsWith('hello-tools.js'));

  // ---- Build & Deployment (runs in the sandbox) ----
  Layout.show('build');
  r.buildTasks = await until(async () => { const n = document.querySelectorAll('#build-tasks .task').length; return n >= 2 ? n : 0; }, 6000);
  const buildRow = [...document.querySelectorAll('#build-tasks .task')].find((t) => t.textContent.includes('run build'));
  buildRow.querySelector('button').click();
  r.buildOutput = Boolean(await until(() => $('#build-out').textContent.includes('building-in-sandbox') && $('#build-out').textContent.includes('[finished'), 60000));
  r.buildTail = $('#build-out').textContent.trim().split('\n').slice(-4).join(' | ');
  await shot('build');

  // ---- Tests: run the project's test task in the sandbox, read the JUnit report ----
  Layout.show('tests');
  click('#tests-run');
  r.testsRan = Boolean(await until(() => $('#tests-out').textContent.includes('tests done') && /\[(failed|finished)/.test($('#tests-out').textContent), 60000));
  r.testsSummary = Boolean(await until(() => /2 tests: 1 passed, 1 failed/.test($('#tests-summary').textContent), 8000));
  r.testsFailureShown = $('#tests-list').textContent.includes('boom');
  await shot('tests');

  // ---- Architecture (Mermaid) ----
  Layout.show('arch');
  r.archDiagram = Boolean(await until(() => document.querySelectorAll('#arch-view svg').length >= 1, 15000));
  await shot('architecture');

  // ---- Git ----
  Layout.show('git');
  await until(() => document.querySelectorAll('#git-files .gf').length >= 1, 8000);
  r.gitRows = document.querySelectorAll('#git-files .gf').length;
  await h.git.stageAll(SMOKE_DIR);
  $('#commit-msg').value = 'Smoke commit'; click('#btn-commit');
  r.gitCommitted = Boolean(await until(async () => (await h.git.log(SMOKE_DIR))[0]?.subject === 'Smoke commit', 8000));
  await h.git.createBranch(SMOKE_DIR, 'feature-x');
  r.gitBranches = (await h.git.branches(SMOKE_DIR)).map((b) => b.name).sort();
  await h.git.checkout(SMOKE_DIR, 'main');
  await wait(800);
  await shot('git');

  // ---- CI/CD (no remote in the fixture) ----
  Layout.show('ci');
  r.ciNoRemote = Boolean(await until(() => $('#ci-head').textContent.includes('No GitHub or GitLab remote'), 5000));

  // ---- no flicker: polling must not rebuild what did not change ----
  Layout.show('git'); await wait(600);
  await GitView.refresh(); await wait(300);
  const gitRenders = GitView.renders; const gitDiffRenders = GitView.diffRenders;
  const rowMarker = $('#git-files').firstElementChild; const optMarker = $('#git-branch').firstElementChild; const commitMarker = $('#git-log').firstElementChild;
  $('#insp-git').scrollTop = 25;
  for (let i = 0; i < 4; i++) { await GitView.refresh(); await wait(150); }
  r.gitNoRebuild = GitView.renders === gitRenders && GitView.diffRenders === gitDiffRenders && $('#git-files').firstElementChild === rowMarker
    && $('#git-branch').firstElementChild === optMarker && $('#git-log').firstElementChild === commitMarker;
  await h.write(SMOKE_DIR + BS + 'brand-new.txt', 'x');                                  // a real change is drawn
  await GitView.refresh(); await wait(300);
  r.gitRedrawsOnChange = GitView.renders === gitRenders + 1 && [...document.querySelectorAll('#git-files .gf')].some((n) => n.textContent.includes('brand-new.txt'));
  Layout.show('overview'); await wait(500); await JournalView.poll();
  const jr = JournalView.renders; for (let i = 0; i < 3; i++) await JournalView.poll();
  r.journalNoRebuild = JournalView.renders === jr;
  renderInbox();                                                                      // bring it up to date first (the "x s ago" text moves on)
  const card = document.querySelector('.card'); renderInbox(); renderInbox();
  r.inboxNoRebuild = document.querySelector('.card') === card;

  // ---- German UI ----
  I18n.set('de'); renderInbox(); await wait(200);
  r.germanStart = $('#btn-start2').textContent;
  r.inboxCards = document.querySelectorAll('.card').length;
  r.cardHasSummary = Boolean(document.querySelector('.card .sum'));
  r.chatHeadShown = !$('#chat-head').hidden;
  r.fontsLoaded = document.fonts.check('13px "Hanken Grotesk"') && document.fonts.check('13px "Azeret Mono"');
  r.titlebarBrand = $('#titlebar .brand').textContent.trim();
  r.germanTab = document.querySelector('.gtab[data-view-tab="overview"] .lbl').textContent;
  Layout.show('files');
  await shot('german');
  I18n.set('en'); await wait(100);
  r.englishBack = $('#btn-start2').textContent;

  // ---- file browser: copy / cut / paste, keyboard, drag & drop, rename, delete, context menu ----
  Layout.show('files'); await loadTree(SMOKE_DIR); await wait(500);
  const P = (n) => SMOKE_DIR + BS + n;
  const names = async (d) => (await h.list(d)).map((e) => e.name);
  await h.files.create(SMOKE_DIR, 'ft-one', true); await h.files.create(SMOKE_DIR, 'ft-two', true); await h.write(P('ft-a.txt'), 'hello');
  await reloadDirs([SMOKE_DIR]);
  FT.sel = new Set([P('ft-a.txt')]); copySelection(false); await pasteInto(P('ft-one'));
  r.ftCopy = (await names(P('ft-one'))).includes('ft-a.txt') && (await names(SMOKE_DIR)).includes('ft-a.txt');
  FT.sel = new Set([P('ft-a.txt')]); copySelection(false); await pasteInto(SMOKE_DIR);                      // same folder: "ft-a copy.txt"
  r.ftCopyUnique = (await names(SMOKE_DIR)).includes('ft-a copy.txt');
  FT.sel = new Set([P('ft-a copy.txt')]); copySelection(true); await pasteInto(P('ft-two'));
  r.ftCut = (await names(P('ft-two'))).includes('ft-a copy.txt') && !(await names(SMOKE_DIR)).includes('ft-a copy.txt');
  FT.sel = new Set([P('ft-a.txt')]); $('#tree').dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
  FT.sel = new Set([P('ft-two')]); $('#tree').dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true })); await wait(600);
  r.ftKeyboard = (await names(P('ft-two'))).includes('ft-a.txt');
  await h.write(P('ft-drag.txt'), 'd'); await reloadDirs([SMOKE_DIR]);
  const dt = new DataTransfer(); dt.setData('application/x-hearth-paths', JSON.stringify([P('ft-drag.txt')]));                  // drag onto a folder = move
  FT.nodes.get(P('ft-one')).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); await wait(800);
  r.ftDragMove = (await names(P('ft-one'))).includes('ft-drag.txt') && !(await names(SMOKE_DIR)).includes('ft-drag.txt');
  const m0 = document.querySelectorAll('.menu').length;
  FT.nodes.get(P('ft-one')).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 })); await wait(200);
  const menuItems = [...document.querySelectorAll('.menu .mi')].map((b) => b.textContent);
  r.ftMenu = document.querySelectorAll('.menu').length === m0 + 1 && ['New file', 'Cut', 'Copy', 'Paste', 'Rename', 'Delete'].every((x) => menuItems.some((m) => m.startsWith(x)));
  closeCtx();
  await openFile(P('ft-two') + BS + 'ft-a.txt');                                                              // open tabs follow a rename
  FT.sel = new Set([P('ft-two') + BS + 'ft-a.txt']); await reloadDirs([P('ft-two')], P('ft-two'));
  const to = await h.files.rename(P('ft-two') + BS + 'ft-a.txt', 'renamed.txt'); remapDocs(P('ft-two') + BS + 'ft-a.txt', to);
  r.ftRenameTab = state.docs.has(to) && state.active === to;
  await h.write(P('ft-a.txt'), 'again');
  r.ftRefusesOverwrite = await h.files.move(P('ft-a.txt'), P('ft-one')).then(() => false, () => true);
  await h.files.trash(P('ft-a.txt'));
  await h.files.create(SMOKE_DIR, 'ft-x.txt', false);
  r.ftCreateTwiceFails = await h.files.create(SMOKE_DIR, 'ft-x.txt', false).then(() => false, () => true);
  r.ftOutsideRefused = await h.files.copy(P('ft-x.txt'), 'C:' + BS + 'Windows').then(() => false, () => true);
  for (const n of ['ft-one', 'ft-two', 'ft-x.txt']) await h.files.trash(P(n));
  await reloadDirs([SMOKE_DIR]); dropDocs(to);
  r.ftTrash = !(await names(SMOKE_DIR)).some((n) => n.startsWith('ft-'));

  // ---- editor: JavaScript (Monaco's service), Go and Java (completion, hover, outline) ----
  await ensureEditor();
  const mk = (text, lang) => monaco.editor.createModel(text, lang);
  const labels = async (lang, text) => {
    const m = mk(text, lang); const lines = text.split('\n'); const pos = new monaco.Position(lines.length, lines[lines.length - 1].length + 1);
    const res = await EditorLang.api.providers[lang].provideCompletionItems(m, pos); m.dispose();
    return res.suggestions.map((x) => (typeof x.label === 'string' ? x.label : x.label.label));
  };
  r.goFmt = (await labels('go', 'package main\nimport \"fmt\"\nfunc main() {\n\tfmt.')).includes('Println');
  r.goSnippets = (await labels('go', 'package main\nfunc main() {\n\tif')).includes('iferr');
  r.goVarType = (await labels('go', 'package main\nfunc f() {\n\tvar sb strings.Builder\n\tsb.')).includes('WriteString');
  r.goHandler = (await labels('go', 'func h(w http.ResponseWriter, r *http.Request) {\n\tw.')).includes('WriteHeader');
  r.goOwnSymbols = (await labels('go', 'package main\nfunc computeTotal() int { return 1 }\nfunc main() {\n\tcomp')).includes('computeTotal');
  r.javaStatic = (await labels('java', 'class A { void f() { System.out.')).includes('println');
  r.javaVarType = (await labels('java', 'class A { void f() { List<String> items = new ArrayList<>(); items.')).includes('stream');
  r.javaSnippets = (await labels('java', 'class A {\n\tpsv')).includes('main');
  const gm = mk('package main\n\ntype Server struct{}\n\nfunc (s *Server) Start() {}\nfunc main() {}\n', 'go');
  r.goOutline = EditorLang.api.docSymbols('go', gm).map((x) => x.name).join(',') === 'Server,Start,main'; gm.dispose();
  const jm = mk('public class Foo {\n  private int n;\n  public int getN() {\n    return n;\n  }\n  static void run(String a) {\n  }\n}\n', 'java');
  r.javaOutline = EditorLang.api.docSymbols('java', jm).map((x) => x.name).join(',') === 'Foo,getN,run'; jm.dispose();
  const jsm = mk('const nums = [1, 2, 3];\nnums.', 'javascript');
  const wk = await (await monaco.languages.typescript.getJavaScriptWorker())(jsm.uri);
  const comp = await wk.getCompletionsAtPosition(jsm.uri.toString(), jsm.getValue().length);
  r.jsCompletion = Boolean(comp && comp.entries.some((x) => x.name === 'map') && comp.entries.some((x) => x.name === 'filter'));
  const nodeM = mk('process.', 'javascript'); const wk2 = await (await monaco.languages.typescript.getJavaScriptWorker())(nodeM.uri);
  const comp2 = await wk2.getCompletionsAtPosition(nodeM.uri.toString(), 8); r.jsNodeTypes = Boolean(comp2 && comp2.entries.some((x) => x.name === 'env'));
  jsm.dispose(); nodeM.dispose();
  r.editorMinimap = state.editor.getOption(monaco.editor.EditorOption.minimap).enabled === true;

  // ---- Panes: drag and drop, split, chooser, maximise, text size, divider, close, persistence ----
  Layout.reset(); await wait(400);
  Layout.show('agent'); await wait(200);
  r.panesDefault = Layout.groupCount();
  r.tabsRendered = document.querySelectorAll('.gtab').length;
  const gOf = (v) => document.querySelector('.gtab[data-view-tab="' + v + '"]')?.closest('.group');
  const dnd = async (view, groupEl, zone) => {
    const tab = document.querySelector('.gtab[data-view-tab="' + view + '"]');
    const dt = new DataTransfer();
    tab.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await wait(120);
    const zoneEl = groupEl.querySelector('.dropzone');
    const rc = zoneEl.getBoundingClientRect();
    const [fx, fy] = { center: [0.5, 0.5], left: [0.08, 0.5], right: [0.92, 0.5], top: [0.5, 0.06], bottom: [0.5, 0.94] }[zone];
    const ev = (type) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rc.left + rc.width * fx, clientY: rc.top + rc.height * fy });
    zoneEl.dispatchEvent(ev('dragover')); await wait(60);
    const preview = groupEl.querySelector('.dz-preview');
    const shown = getComputedStyle(preview).display !== 'none' ? preview.dataset.zone : null;
    zoneEl.dispatchEvent(ev('drop')); await wait(400);
    return shown;
  };
  r.dropPreview = await dnd('git', gOf('agent'), 'right');                        // flame preview on the right half
  r.afterEdgeDrop = Layout.groupCount();
  r.gitOwnPane = gOf('git') !== gOf('files') && Layout.model.groupOf(Layout.tree, 'git').views.length === 1;
  r.gitStillWorks = Boolean(await until(() => $('#git-branch').options.length >= 1 && $('#git-head').textContent.length > 0, 6000));
  await shot('panes-split');
  const merged = await dnd('git', gOf('files'), 'center');
  r.afterCenterDrop = Layout.groupCount();
  r.mergedPreview = merged;
  r.ownEdgeIsNoop = (await dnd('sessions', gOf('sessions'), 'left')) === null && Layout.groupCount() === r.afterCenterDrop;
  // split with the pane button -> empty pane with a chooser -> pick a view
  gOf('agent').querySelector('.gbtn[title="Split right"]').click(); await wait(250);
  r.chooserShown = Boolean(document.querySelector('.chooser'));
  [...document.querySelectorAll('.chooser .cbtn')].find((b) => b.textContent.trim() === 'Tests').click(); await wait(300);
  r.chooserPicked = !document.querySelector('.chooser') && Layout.groupCount() === 4 && Layout.isVisible('tests');
  // maximise and restore
  gOf('agent').querySelector('.gbtn[title="Maximize"]').click(); await wait(200);
  r.maximised = Boolean(document.querySelector('.group.max'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(200);
  r.restored = !document.querySelector('.group.max');
  // text size of one pane
  gOf('files').querySelector('.gbtn[title="Text size"]').click(); await wait(100);
  [...document.querySelectorAll('.menu .mi')].find((b) => b.textContent.includes('Larger text')).click(); await wait(250);
  r.paneZoom = document.getElementById('insp-files').style.zoom;
  // drag a divider
  const gut = document.querySelector('.gutter.sp-row');
  const before = Layout.tree.sizes ? Layout.tree.sizes[0] : 0;
  const gr = gut.getBoundingClientRect();
  gut.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: gr.left + 2, clientY: gr.top + 100 }));
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: gr.left + 82, clientY: gr.top + 100 }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await wait(200);
  r.dividerMoved = Layout.tree.sizes[0] > before + 0.02;
  // saved layout
  const stored = JSON.parse(localStorage.getItem('hearth.layout.v1') || 'null');
  r.layoutSaved = Boolean(stored) && Layout.model.groups(stored).length === Layout.groupCount();
  r.restoredFromStorage = Layout.model.sanitize(stored) != null;
  // close a pane: its views are hidden but can come back
  gOf('tests').querySelector('.gbtn[title="Close pane"]').click(); await wait(250);
  r.closedHides = Layout.hidden().includes('tests') && !Layout.isVisible('tests');
  Layout.show('tests'); await wait(250);
  r.shownAgain = Layout.isVisible('tests');
  await shot('panes-final');
  Layout.reset(); await wait(300);
  r.resetLayout = Layout.groupCount() === 3 && Layout.hidden().length === 0;
  Layout.show('git');

  // ---- Settings + credentials ----
  click('#btn-settings'); await wait(500);
  $('#set-tabs [data-tab="creds"]').click();
  $('#env-name').value = 'SMOKE_API_KEY'; $('#env-value').value = 'secret-value'; $('#env-add').click();
  r.envSaved = Boolean(await until(() => $('#cred-env').textContent.includes('SMOKE_API_KEY'), 4000));
  r.envMasked = !document.body.textContent.includes('secret-value');
  await shot('settings');
  r.dangerousEnvRefused = await h.creds.setEnv('PATH', 'x').then(() => false, () => true);
  await h.creds.deleteEnv('SMOKE_API_KEY');
  $('#dlg-settings').close();

  Layout.show('agent');
  await wait(500);
  await shot('final');
  // the default look, and the light one
  Layout.show('git');
  Themes.apply('hearthLight'); await wait(500); await shot('light');
  Themes.apply('hearth'); await wait(500); await shot('hearth');
  r.emptyHidden = getComputedStyle($('#empty')).display === 'none';
  r.mergeBarHidden = getComputedStyle($('#merge-bar')).display === 'none';
  await h.remove(s.id);
  return r;
})()
