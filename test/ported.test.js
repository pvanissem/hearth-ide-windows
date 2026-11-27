'use strict';
// Features ported from the macOS app 0.9-0.16: program status (OSC 7501), hooks status, turn timer, session history,
// model choice, commit messages, merge/pull request review, specs and agent hooks.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const status = require('../src/main/status');
const { History } = require('../src/main/history');
const agents = require('../src/main/agents');
const commitMsg = require('../src/main/commitmsg');
const changes = require('../src/main/changes');
const specs = require('../src/main/specs');
const hooks = require('../src/main/hooks');
const git = require('../src/main/git');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `hearth-${p}-`));

// ---------------------------------------------------------------- program status
test('OSC 7501: blocked wins over error and work, then the newest decides; text is cleaned', () => {
  const R = (state, extra = {}) => ({ state, ...extra });
  const s = status.summarize([R('working', { progress: 40 }), R('error', { message: 'build failed' }), R('blocked', { kind: 'permission' }), R('done')]);
  assert.deepEqual([s.status, s.detail], ['needs-input', 'Waiting for approval.']);
  assert.deepEqual(status.summarize([R('working'), R('error', { message: 'boom' })]), { status: 'blocked', detail: 'boom', progress: null });
  assert.deepEqual(status.summarize([R('done'), R('working', { progress: 70 })]), { status: 'running', detail: null, progress: 70 });
  assert.deepEqual(status.summarize([R('done', { title: 'Tests green' })]), { status: 'done', detail: 'Tests green', progress: null });
  assert.equal(status.summarize([R('idle')]).status, 'idle');
  assert.equal(status.summarize([]), null);
  assert.equal(status.cleanText('Deploy\u202Etxt.exe\u200B?  '), 'Deploytxt.exe?');
  assert.equal(status.cleanText('\u200B '), null);
  assert.equal(status.cleanText('a'.repeat(500)).length, 300);
});

test('OSC 7501 in the terminal stream (also split across chunks) drives the status; base64 message', () => {
  const seen = [];
  const tr = new status.StatusTracker((i) => seen.push(i));
  tr.data('hello \x1b]7501;state=work');
  tr.data('ing:progress=40\x1b\\ more');
  assert.equal(tr.state, 'running'); assert.equal(tr.progress, 40);
  tr.data(`\x1b]7501;state=blocked:kind=question:msg=${Buffer.from('Deploy now?').toString('base64')}\x07`);
  assert.equal(tr.state, 'needs-input'); assert.equal(tr.detail, 'Deploy now?');
  tr.data('\x1b]7501;state=clear\x07');
  assert.equal(tr.state, 'idle');
  // once a program reports, bells and output no longer guess
  tr.data('\x1b]7501;state=done:title=ok\x07'); tr.data('\x07 noise'); assert.equal(tr.state, 'done');
  assert.equal(status.parseOSC('state=bogus'), null);
});

test('hook events: running, permission, notification, stop with summary; session id and title; invalid ids ignored', () => {
  const tr = new status.StatusTracker(() => {}, { source: 'hooks' });
  tr.data('output'); assert.equal(tr.state, 'running', 'until the first hook event the terminal heuristics apply');
  tr.applyEvent({ hook_event_name: 'Stop' }); tr.data('more output'); assert.equal(tr.state, 'done', 'then hooks alone decide');
  let r = tr.applyEvent({ hook_event_name: 'UserPromptSubmit', session_id: 'abc-123', prompt: 'Fix the login\nmore' });
  assert.equal(tr.state, 'running'); assert.equal(r.sessionID, 'abc-123'); assert.equal(r.title, 'Fix the login');
  tr.applyEvent({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  assert.deepEqual([tr.state, tr.detail], ['needs-input', 'Wants to use Bash.']);
  r = tr.applyEvent({ hook_event_name: 'Stop', last_assistant_message: 'All done' });
  assert.deepEqual([tr.state, tr.detail, r.turnEnded], ['done', 'All done', true]);
  tr.applyEvent({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }); assert.equal(tr.state, 'done');
  tr.applyEvent({ session_id: '--dangerously-skip-permissions', hook_event_name: 'SessionStart' });
  assert.equal(tr.sessionID, 'abc-123');
  assert.equal(status.validSessionID('--x'), false); assert.equal(status.validSessionID('0199a-b:c'), true);
  const codex = new status.StatusTracker(() => {}, { source: 'notify' });
  codex.applyEvent({ type: 'agent-turn-complete', 'thread-id': 't1', 'last-assistant-message': 'ok' });
  assert.deepEqual([codex.state, codex.sessionID], ['done', 't1']);
});

test('turn clock: a turn lasts through questions and ends when done; durations format', () => {
  const c = new status.TurnClock(1000);
  c.transition('idle', 'running', 1010); c.transition('running', 'needs-input', 1040);
  assert.equal(c.turnStarted, 1010); assert.equal(c.since, 1040);
  c.transition('needs-input', 'running', 1060); assert.equal(c.turnStarted, 1010);
  c.transition('running', 'done', 1130); assert.equal(c.turnStarted, null); assert.equal(c.lastTurn, 120);
  c.transition('done', 'idle', 1200); assert.equal(c.lastTurn, 120);
  assert.equal(status.formatDuration(7000), '0:07'); assert.equal(status.formatDuration(187000), '3:07'); assert.equal(status.formatDuration(3723000), '1:02:03');
  assert.equal(status.restartsNow('idle'), true); assert.equal(status.restartsNow('running'), false); assert.equal(status.restartsNow('needs-input'), false);
});

// ---------------------------------------------------------------- history, options
test('history: old list format still loads; resumable sessions per agent and folder; options per folder', () => {
  const file = path.join(tmp('hist'), 'sessions.json');
  fs.writeFileSync(file, JSON.stringify([{ kind: 'claude', directory: 'C:\\p', title: 'p', last: 1 }]));
  const h = new History(file);
  assert.equal(h.list().length, 1);
  h.remember('claude', 'C:\\p', 'sid-1', 'First'); h.remember('claude', 'c:\\P', 'sid-2', 'Second'); h.remember('codex', 'C:\\p', 'cx', 'Codex');
  h.remember('claude', 'C:\\p', '--evil', 'x');
  assert.deepEqual(h.sessions('claude', 'C:\\p').map((x) => x.sessionID).sort(), ['sid-1', 'sid-2']);
  h.setOptions('C:\\p', { model: 'haiku', effort: 'low' });
  assert.deepEqual(new History(file).options('c:\\P'), { model: 'haiku', effort: 'low' });
  h.forget('claude', 'C:\\p');
  assert.equal(h.sessions('claude', 'C:\\p').length, 0); assert.equal(h.sessions('codex', 'C:\\p').length, 1);
});

test('model and effort arguments: only known values', () => {
  assert.deepEqual(agents.optionArgs('claude', { model: 'haiku', effort: 'low' }), ['--model', 'haiku', '--effort', 'low']);
  assert.deepEqual(agents.optionArgs('claude', { model: '--evil', effort: 'max' }), ['--effort', 'max']);
  assert.deepEqual(agents.optionArgs('codex', { model: 'haiku', effort: 'high' }), ['-c', 'model_reasoning_effort="high"']);
  assert.deepEqual(agents.optionArgs('gemini', { effort: 'low' }), []);
  const run = tmp('run');
  const a = agents.statusHookArgs('claude', 'C:\\r\\bin\\hearth-sandbox.exe', run);
  const cfg = JSON.parse(a[1]);
  assert.doesNotMatch(a[1], /[&|<>^%]/, 'nothing cmd.exe would interpret');
  assert.equal(a[0], '--settings'); assert.deepEqual([cfg.hooks.Stop[0].hooks[0].command, cfg.hooks.Stop[0].hooks[0].args], ['C:/r/bin/hearth-sandbox.exe', ['event']]);
  assert.deepEqual(agents.statusHookArgs('codex', 'C:\\r\\bin\\x.exe', run), ['-c', 'notify=["C:/r/bin/x.exe","event"]']);
});

// ---------------------------------------------------------------- commit messages
test('commit message: answer cleaned, noise excluded, prompt follows the recent style, input from a real repo', async () => {
  assert.equal(commitMsg.clean('Here is the commit message:\n```\nAdd login\n\nBody\n```'), 'Add login\n\nBody');
  assert.equal(commitMsg.clean('"Fix typo"'), 'Fix typo');
  assert.equal(commitMsg.clean('Commit message:\nUpdate docs'), 'Update docs');
  assert.ok(commitMsg.isNoise('web/package-lock.json') && commitMsg.isNoise('a/b.min.js') && !commitMsg.isNoise('src/app.js'));
  assert.deepEqual(commitMsg.args('claude').slice(-4), ['--model', 'haiku', '--system-prompt', 'You write concise, accurate git commit messages. Answer with the message only.']);
  assert.throws(() => commitMsg.args('copilot'));
  const dir = tmp('cm');
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  g('init', '-q'); g('config', 'user.email', 't@e.st'); g('config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n'); g('add', '.'); g('commit', '-qm', 'feat: first');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n'); fs.writeFileSync(path.join(dir, 'new.txt'), 'hello\n'); fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  const st = await git.status(dir);
  const inp = await commitMsg.input((args) => git.raw(dir, args), st.files);
  assert.equal(inp.stagedOnly, false);
  assert.match(inp.files, /new\.txt \(new\)/); assert.match(inp.diff, /\+two/); assert.match(inp.diff, /\+hello/); assert.doesNotMatch(inp.diff, /\+\{\}/);
  assert.deepEqual(inp.recentSubjects, ['feat: first']);
  const p = commitMsg.prompt(inp); assert.match(p, /- feat: first/); assert.match(p, /Changed files:/);
  g('add', 'a.txt');
  const staged = await commitMsg.input((args) => git.raw(dir, args), (await git.status(dir)).files);
  assert.equal(staged.stagedOnly, true); assert.doesNotMatch(staged.diff, /hello/);
  const log = await git.branchLog(dir, (await git.status(dir)).branch);
  assert.equal(log[0].subject, 'feat: first');
  assert.match(await git.showCommit(dir, log[0].hash), /feat: first[\s\S]*\+one/);
  await assert.rejects(git.showCommit(dir, '--evil'));
});

// ---------------------------------------------------------------- merge / pull requests
test('change requests: diff lines are numbered; summaries and mergeability for GitLab and GitHub', () => {
  const lines = changes.parseDiff('@@ -10,3 +10,4 @@ fn\n ctx\n-old\n+new\n+more\n ctx2\n\\ No newline at end of file\n');
  assert.deepEqual(lines.map((l) => [l.kind, l.oldLine ?? null, l.newLine ?? null]), [['hunk', null, null], ['context', 10, 10], ['removed', 11, null], ['added', null, 11], ['added', null, 12], ['context', 12, 13], ['note', null, null]]);
  assert.deepEqual(changes.counts('@@ -1 +1,2 @@\n-a\n+b\n+c\n'), { added: 2, removed: 1 });
  const gl = changes.glSummary({ iid: 7, title: 'T', author: { username: 'u' }, source_branch: 'f', target_branch: 'main', state: 'opened', draft: true, source_project_id: 1, target_project_id: 1 });
  assert.deepEqual([gl.number, gl.state, gl.draft, gl.sameRepository], [7, 'open', true, true]);
  assert.equal(changes.glMergeability({ detailed_merge_status: 'conflict' }, 'open').kind, 'conflict');
  assert.deepEqual(changes.glMergeability({ detailed_merge_status: 'not_approved' }, 'open'), { kind: 'blocked', text: 'Approvals missing' });
  assert.equal(changes.glMergeability({ merge_status: 'can_be_merged' }, 'open').kind, 'ready');
  const gh = changes.ghSummary({ number: 3, state: 'closed', merged_at: '2026', head: { ref: 'f', repo: { full_name: 'O/R' } }, base: { ref: 'main' } }, 'o/r');
  assert.deepEqual([gh.state, gh.sameRepository], ['merged', true]);
  assert.equal(changes.ghMergeability({ mergeable_state: 'unstable' }, 'open').kind, 'warning');
  assert.equal(changes.ghMergeability({ draft: true }, 'open').text, 'Marked as draft');
  assert.deepEqual(changes.latestVerdicts([{ user: { login: 'a' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'b' }, state: 'COMMENTED' }]), { a: 'APPROVED' });
});

test('change requests: writes use the write token, line comments carry the position, merge pins the reviewed head', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url: String(url), method: opts.method, headers: opts.headers, body: opts.body && JSON.parse(opts.body) }); return { ok: true, status: 200, text: async () => '{}' }; };
  const ghc = new changes.ChangeRequests(new changes.Client({ host: 'github.com', path: 'o/r', provider: 'github' }, { token: 'READ', writeToken: 'WRITE', fetchImpl }));
  await ghc.comment(5, 'nice', { path: 'a.js', oldPath: 'a.js', oldLine: null, newLine: 12 }, { head: 'abc' });
  assert.deepEqual(calls[0].body, { body: 'nice', commit_id: 'abc', path: 'a.js', line: 12, side: 'RIGHT' });
  assert.match(calls[0].headers.Authorization, /WRITE/);
  await ghc.merge(5, { method: 'squash', deleteSource: true }, { refs: { head: 'abc' }, summary: { source: 'feat/x', sameRepository: true } });
  assert.deepEqual(calls[1].body, { merge_method: 'squash', sha: 'abc' });
  assert.match(calls[2].url, /git\/refs\/heads\/feat\/x$/); assert.equal(calls[2].method, 'DELETE');
  await assert.rejects(ghc.reply(5, '../x', 'hi'));
  const glc = new changes.ChangeRequests(new changes.Client({ host: 'gitlab.com', path: 'g/p', provider: 'gitlab' }, { token: 'READ', writeToken: 'WRITE', fetchImpl }));
  await glc.comment(9, 'why?', { path: 'b.go', oldPath: 'b.go', oldLine: 4, newLine: null }, { base: 'b', start: 's', head: 'h' });
  assert.deepEqual(calls[3].body.position, { position_type: 'text', base_sha: 'b', start_sha: 's', head_sha: 'h', new_path: 'b.go', old_path: 'b.go', old_line: 4 });
  await assert.rejects(glc.review(9, 'requestChanges'), /request changes/);
  await glc.merge(9, { method: 'squash' }, { refs: { head: 'h' } });
  assert.deepEqual(calls.at(-1).body, { squash: true, should_remove_source_branch: false, sha: 'h' });
});

// ---------------------------------------------------------------- specs
const REQ = `# Requirements: Login

Intro.

### Requirement 1: Sign in
**User Story:** As a user, I want to sign in, so that I see my data.
#### Acceptance Criteria
1. WHEN the password is right THEN the system SHALL show the start page
2. the system shows an error

### Requirement 2: Sign out
1. WHEN I click sign out THEN the system SHALL end the session

## Open questions
- Should we remember the user?
`;
const TASKS = `# Tasks
- [x] 1. Build the form
  - Fields and button
  - _Requirements: 1.1_
- [ ] 2. Sign out
  - [ ] 2.1 Button
    - _Requirements: 2.1, 9.9_
- [ ] 3. Docs
`;

test('specs: tasks with numbers, details and references; ticking; approval ignores ticks', () => {
  const t = specs.parseTasks(TASKS);
  assert.deepEqual(t.map((x) => [x.id, x.done, x.depth]), [['1', true, 0], ['2', false, 0], ['2.1', false, 1], ['3', false, 0]]);
  assert.deepEqual(t[0].requirements, ['1.1']); assert.deepEqual(t[0].details, ['Fields and button']);
  const ticked = specs.setTaskLine(TASKS, t[3].line, true);
  assert.match(ticked, /- \[x\] 3\. Docs/);
  assert.equal(specs.approvalHash('tasks', TASKS), specs.approvalHash('tasks', ticked));
  assert.notEqual(specs.approvalHash('design', 'a'), specs.approvalHash('design', 'b'));
  assert.equal(specs.slug('Größe & Ärger!'), 'grosse-arger');
});

test('specs: quality check finds untestable criteria, open questions, uncovered and unknown criteria; coverage states', () => {
  const doc = specs.requirements(REQ);
  assert.deepEqual(doc.requirements.map((r) => [r.id, r.hasStory, r.criteria.length]), [['1', true, 2], ['2', false, 1]]);
  assert.deepEqual(doc.openQuestions, ['Should we remember the user?']);
  const sp = { record: { kind: 'feature', approved: {} }, documents: { requirements: REQ, design: '# Design\n## Overview\nRequirement 1 is met by X.', tasks: TASKS } };
  sp.tasks = specs.parseTasks(TASKS);
  const ids = specs.findings(sp, doc).map((f) => f.id);
  for (const id of ['req-ears', 'req-story', 'req-questions', 'design-topics', 'design-trace', 'tasks-uncovered', 'tasks-unknown', 'tasks-unlinked']) assert.ok(ids.includes(id), id);
  const tr = specs.trace(doc, sp.tasks);
  assert.deepEqual(tr.map((x) => [x.criterion.id, x.state]), [['1.1', 'done'], ['1.2', 'uncovered'], ['2.1', 'planned']]);
  assert.ok(specs.missingDesignTopics('## Architecture\n## Data model\n## Testing').includes('Error handling'));
});

test('specs: create, approve step by step, changed after approval, prompts are one line and name the files', () => {
  const root = tmp('spec');
  const created = specs.create(root, { name: 'Login', idea: 'Sign in\nwith mail', kind: 'bugfix', guided: false });
  assert.equal(created.rel, '.hearth/specs/login'); assert.equal(created.currentPhase, 'requirements');
  assert.equal(specs.create(root, { name: 'Login' }).slug, 'login-2');
  fs.writeFileSync(path.join(created.folder, 'requirements.md'), REQ);
  let sp = specs.byId(root, created.id);
  assert.equal(sp.status.requirements, 'draft'); assert.equal(sp.canWrite.design, false);
  specs.approve(root, sp.id, 'requirements');
  sp = specs.byId(root, created.id);
  assert.equal(sp.status.requirements, 'approved'); assert.equal(sp.canWrite.design, true); assert.equal(sp.currentPhase, 'design');
  fs.appendFileSync(path.join(created.folder, 'requirements.md'), '\nmore');
  assert.equal(specs.byId(root, created.id).status.requirements, 'changed');
  specs.update(root, sp.id, { guided: true, check: { phase: 'design', index: 2, on: true } });
  assert.deepEqual(specs.byId(root, created.id).record.checks.design, [2]);
  const p = specs.promptFor(root, sp.id, 'requirements', { clarify: true }, 'de');
  assert.doesNotMatch(p, /\n/); assert.match(p, /\.hearth\/specs\/login\/requirements\.md/); assert.match(p, /German/); assert.match(p, /Current behaviour/); assert.match(p, /at most 5/);
  assert.throws(() => specs.promptFor(root, sp.id, 'rm -rf'), /Unknown spec action/);
  assert.throws(() => specs.byId(root, '../x'), /Unknown spec/);
  // Kiro specs are read too
  fs.mkdirSync(path.join(root, '.kiro', 'specs', 'k'), { recursive: true });
  fs.writeFileSync(path.join(root, '.kiro', 'specs', 'k', 'requirements.md'), '# Requirements Document: Kiro thing\n');
  assert.ok(specs.scan(root).some((x) => x.rel === '.kiro/specs/k' && x.name === 'Kiro thing'));
});

// ---------------------------------------------------------------- agent hooks
test('hooks: Kiro formats, glob patterns, unsupported triggers', () => {
  const list = hooks.parse(JSON.stringify({ version: 'v1', hooks: [
    { name: 'Tests', trigger: 'FileSave', matcher: '\\.js$', action: { type: 'agent', prompt: 'test it' } },
    { name: 'Lint', trigger: 'Stop', action: { type: 'command', command: 'npm run lint', timeout: 30 } },
    { name: 'Pre', trigger: 'PreToolUse', action: { type: 'agent', prompt: 'x' } }] }), '.hearth/hooks/a.json');
  assert.deepEqual(list.map((h) => [h.trigger, h.supported]), [['FileSave', true], ['Stop', true], [null, false]]);
  assert.equal(list[1].action.timeout, 30);
  const legacy = hooks.parse(JSON.stringify({ name: 'Old', when: { type: 'fileEdited', patterns: ['src/**/*.ts', '*.md'] }, then: { type: 'askAgent', prompt: 'p' } }), '.kiro/hooks/x.kiro.hook')[0];
  assert.equal(legacy.trigger, 'FileSave');
  assert.ok(hooks.matches(legacy, 'src/a/b.ts') && hooks.matches(legacy, 'src/b.ts') && hooks.matches(legacy, 'docs/x.md') && !hooks.matches(legacy, 'lib/b.ts'));
  assert.throws(() => hooks.parse('[]', 'x'), /Not a JSON object/);
});

test('hooks: only allowed content runs; turns fire file and stop hooks; hook turns never trigger hooks; commands report failures', async () => {
  const root = tmp('hooks');
  const trust = new hooks.Trust(path.join(tmp('trust'), 't.json'));
  const rel = hooks.create(root, { name: 'Tests', trigger: 'FileSave', matcher: '\\.js$', action: { type: 'agent', prompt: 'Update the tests.' } });
  hooks.create(root, { name: 'Lint', trigger: 'Stop', action: { type: 'command', command: 'lint' } });
  let now = 0; const sent = []; let st = 'idle';
  const engine = new hooks.Engine({ trust, now: () => now, watch: () => ({ close() {} }),
    runs: () => [{ id: 'r1', directory: root, status: st, running: true, selected: true }],
    send: (id, p) => sent.push(p), runCommand: async () => ({ code: 2, output: 'lint: 3 errors' }) });
  const turn = (files) => { st = 'running'; engine.tick(now); engine.filesChanged(root, files, now); st = 'idle'; now += 10; engine.tick(now); now += hooks.SETTLE_MS + 1; engine.tick(now); };
  turn([['src/a.js', 'saved']]);
  assert.equal(sent.length, 0, 'nothing runs before the user allowed the file');
  engine.allow(root, rel);
  turn([['src/a.js', 'saved'], ['README.md', 'saved'], ['node_modules/x.js', 'saved']]);
  now += 10; engine.tick(now);
  assert.equal(sent.length, 1); assert.match(sent[0], /\[Hook "Tests"\] Update the tests\. — Files: `src\/a\.js`$/);
  // the turn the hook started does not trigger hooks again
  turn([['src/b.js', 'saved']]); now += 10; engine.tick(now);
  assert.equal(sent.length, 1);
  // the command hook (now allowed) fails and hands its output to the agent
  engine.allow(root, '.hearth/hooks/lint.json');
  turn([]); await new Promise((r) => setTimeout(r, 10)); now += 10; engine.tick(now);
  assert.ok(sent.some((p) => /`lint` failed after your last changes \(exit 2\)\. Output: lint: 3 errors/.test(p)));
  assert.ok(engine.activity.some((a) => a.outcome === 'commandFailed'));
  // a changed file needs a new approval
  const file = path.join(root, rel); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Update the tests.', 'rm -rf /'));
  engine.reload(root);
  assert.equal(engine.hooks(root).hooks.find((h) => h.name === 'Tests').supported, true);
  assert.equal(engine.isTrusted(root, engine.hooks(root).hooks.find((h) => h.name === 'Tests')), false);
  engine.close();
});

// ---------------------------------------------------------------- journal batching (native helper)
test('hearth-journal records several entries in one call and nothing when one is invalid', { skip: process.platform !== 'win32' || !fs.existsSync(path.join(__dirname, '..', 'native', 'bin', 'hearth-sandbox.exe')) }, () => {
  const exe = path.join(__dirname, '..', 'native', 'bin', 'hearth-sandbox.exe');
  const file = path.join(tmp('jr'), 'journal.jsonl'); fs.writeFileSync(file, '');
  const env = { ...process.env, HEARTH_JOURNAL: file };
  execFileSync(exe, ['journal', 'step', 's1', '--status', 'done', '+', 'step', 's2', '--title', 'Two "quoted"', '--status', 'running', '+', 'decision', 'd1', '--rejected', 'a', '--rejected', 'b'], { env });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.id), ['s1', 's2', 'd1']); assert.equal(lines[1].title, 'Two "quoted"'); assert.deepEqual(lines[2].rejected, ['a', 'b']);
  assert.throws(() => execFileSync(exe, ['journal', 'step', 's3', '+', 'bogus', 'x'], { env, stdio: 'pipe' }));
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 3);
});
