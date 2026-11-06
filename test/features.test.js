'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { Journal, JournalReader, validID, clean, agentArguments, INSTRUCTION } = require('../src/main/journal');
const ci = require('../src/main/ci');
const { Credentials } = require('../src/main/creds');
const build = require('../src/main/build');
const testsLib = require('../src/main/tests');
const search = require('../src/main/search');
const arch = require('../src/main/arch');
const updates = require('../src/main/updates');
const git = require('../src/main/git');
const i18n = require('../scripts/i18n-strings');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `hearth-${name}-`));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

// ---------------------------------------------------------------- journal
test('journal: steps, decisions, questions form a tree; later lines update earlier ones', () => {
  const j = new Journal();
  assert.ok(j.apply({ t: 'step', id: 's1', title: 'Plan', status: 'running' }));
  assert.ok(j.apply({ t: 'step', id: 's2', parent: 's1', title: 'Write code', status: 'running' }));
  assert.ok(j.apply({ t: 'decision', id: 'd1', parent: 's1', title: 'Use SQLite', why: 'no server', rejected: ['Postgres', 'files'] }));
  assert.ok(j.apply({ t: 'question', id: 'q1', parent: 's1', title: 'Which port?' }));
  assert.equal(j.children(null).length, 1);
  assert.equal(j.children('s1').length, 3);
  assert.equal(j.currentID, 's2');
  assert.equal(j.openCount('s1'), 1);
  j.apply({ t: 'question', id: 'q1', answer: '8080' });
  assert.equal(j.nodes.get('q1').status, 'answered');
  assert.equal(j.openCount('s1'), 0);
  j.apply({ t: 'step', id: 's2', status: 'done' });
  assert.equal(j.currentID, 's1');
  assert.equal(j.nodes.get('d1').rejected.length, 2);
});

test('journal: invalid ids, statuses and kinds are ignored; kind never changes', () => {
  const j = new Journal();
  assert.equal(j.apply({ t: 'step', id: '../x' }), false);
  assert.equal(j.apply({ t: 'bogus', id: 'a' }), false);
  assert.equal(j.apply(null), false);
  j.apply({ t: 'decision', id: 'd1', status: 'running' });
  assert.equal(j.nodes.get('d1').status, 'planned');   // a decision only allows "done"
  j.apply({ t: 'step', id: 'd1', title: 'x' });
  assert.equal(j.nodes.get('d1').kind, 'decision');
  assert.ok(validID('a1.b-2_c') && !validID('') && !validID('a b') && !validID('x'.repeat(49)));
});

test('journal: control characters are stripped and text is bounded', () => {
  assert.equal(clean('a\u0000b\nc\u001bd'), 'a b c d');
  assert.equal(clean('   '), null);
  assert.equal(clean('x'.repeat(700)).length, 600);
});

test('journal: cycles and unknown parents show at the top level', () => {
  const j = new Journal();
  j.apply({ t: 'step', id: 'a', parent: 'b' }); j.apply({ t: 'step', id: 'b', parent: 'a' }); j.apply({ t: 'step', id: 'c', parent: 'nope' });
  const roots = j.children(null).map((n) => n.id).sort();
  assert.ok(roots.includes('c'));
  assert.ok(roots.includes('a') || roots.includes('b'));
});

test('journal: revoke keeps the node, records reason and replacement, builds the agent prompt', () => {
  const j = new Journal();
  j.apply({ t: 'decision', id: 'd1', title: 'Use SQLite' });
  assert.ok(j.apply({ t: 'revoke', target: 'd1', reason: 'too heavy', replacedBy: 'd2' }));
  assert.deepEqual(j.nodes.get('d1').revoked, { reason: 'too heavy', replacedBy: 'd2' });
  assert.equal(j.apply({ t: 'revoke', target: 'missing' }), false);
  const p = j.revokePrompt('d1', 'too heavy');
  assert.match(p, /revoking decision d1 \("Use SQLite"\)/);
  assert.match(p, /Reason: too heavy/);
});

test('journal reader: incremental, ignores broken and partial lines, writes revocations', () => {
  const dir = tmp('journal'); const file = path.join(dir, 'journal.jsonl');
  try {
    const r = new JournalReader(file);
    assert.equal(r.poll(), false);   // no file yet
    fs.writeFileSync(file, '{"t":"step","id":"s1","title":"A"}\nnot json\n{"t":"step","id":"s2","title":"B"');
    assert.equal(r.poll(), true);
    assert.equal(r.journal.nodes.size, 1);                       // the last line has no newline yet
    fs.appendFileSync(file, '}\n');
    assert.equal(r.poll(), true);
    assert.equal(r.journal.nodes.size, 2);
    assert.equal(r.poll(), false);
    r.revoke('s1', 'wrong');
    assert.equal(r.poll(), true);
    assert.equal(r.journal.nodes.get('s1').revoked.reason, 'wrong');
  } finally { rm(dir); }
});

test('journal: agent arguments carry the instruction for claude and codex only', () => {
  assert.deepEqual(agentArguments('claude'), ['--append-system-prompt', INSTRUCTION]);
  assert.equal(agentArguments('codex')[0], '-c');
  assert.ok(agentArguments('codex')[1].startsWith('developer_instructions="'));
  assert.deepEqual(agentArguments('gemini'), []);
});

// ---------------------------------------------------------------- CI
test('ci: remotes (https, scp-like, ssh) are parsed; odd ones are refused', () => {
  const a = ci.parseRemote('git@github.com:pvanissem/hearth-ide-windows.git');
  assert.deepEqual([a.host, a.path, a.provider], ['github.com', 'pvanissem/hearth-ide-windows', 'github']);
  const b = ci.parseRemote('https://gitlab.example.com/group/sub/proj.git');
  assert.deepEqual([b.host, b.path, b.provider], ['gitlab.example.com', 'group/sub/proj', 'gitlab']);
  assert.equal(ci.parseRemote('https://user:secret@github.com/o/r').host, 'github.com');
  assert.equal(ci.parseRemote('ssh://git@git.corp.local:2222/team/app.git').path, 'team/app');
  assert.equal(ci.parseRemote('not a url'), null);
  assert.equal(ci.parseRemote('https://github.com/..%2f/x'), null);
  assert.equal(ci.parseRemote(null), null);
});

test('ci: provider states are normalised', () => {
  assert.equal(ci.normStatus('completed', 'success'), 'success');
  assert.equal(ci.normStatus('completed', 'failure'), 'failed');
  assert.equal(ci.normStatus('in_progress'), 'running');
  assert.equal(ci.normStatus('queued'), 'pending');
  assert.equal(ci.normStatus('canceled'), 'canceled');
  assert.equal(ci.normStatus('manual'), 'manual');
  assert.ok(ci.isActive('running') && !ci.isActive('success'));
});

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const key = `${init.method} ${new URL(url).pathname}`;
    const hit = routes[key];
    if (!hit) return { ok: false, status: 404, text: async () => 'nope' };
    return { ok: true, status: 200, text: async () => (typeof hit === 'string' ? hit : JSON.stringify(hit)) };
  };
  return { impl, calls };
}

test('ci: GitHub client maps runs, jobs, logs and sends the token only to api.github.com', async () => {
  const { impl, calls } = fakeFetch({
    'GET /repos/o/r/actions/runs': { workflow_runs: [{ id: 7, status: 'completed', conclusion: 'failure', head_branch: 'main', head_sha: 'abcdef123456', name: 'CI', html_url: 'https://github.com/o/r/actions/runs/7', created_at: '2026-01-01T00:00:00Z' }] },
    'GET /repos/o/r/actions/runs/7/jobs': { jobs: [{ id: 9, name: 'build', status: 'completed', conclusion: 'success', workflow_name: 'CI' }] },
    'GET /repos/o/r/actions/jobs/9/logs': '\x1b[31mhello\x1b[0m\r\nworld',
    'POST /repos/o/r/pulls': { html_url: 'https://github.com/o/r/pull/1' },
  });
  const c = new ci.Client(ci.parseRemote('git@github.com:o/r.git'), { token: 'T', writeToken: 'W', fetchImpl: impl });
  const runs = await c.pipelines('main');
  assert.deepEqual([runs[0].id, runs[0].status, runs[0].sha], [7, 'failed', 'abcdef12']);
  assert.equal((await c.jobs(7))[0].status, 'success');
  assert.equal(await c.log(9), 'hello\nworld');
  assert.equal(await c.createChangeRequest({ title: 't', source: 'f', target: 'main' }), 'https://github.com/o/r/pull/1');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer T');
  assert.equal(calls[3].init.headers.Authorization, 'Bearer W');           // writes use the write token
  assert.ok(calls.every((x) => x.url.startsWith('https://api.github.com/')));
});

test('ci: GitLab client uses PRIVATE-TOKEN and the encoded project path', async () => {
  const { impl, calls } = fakeFetch({
    'GET /api/v4/projects/g%2Fp/pipelines': [{ id: 3, status: 'running', ref: 'dev', sha: 'deadbeefcafe', web_url: 'https://gitlab.com/g/p/-/pipelines/3', created_at: '2026-01-01T00:00:00Z' }],
    'POST /api/v4/projects/g%2Fp/merge_requests': { web_url: 'https://gitlab.com/g/p/-/merge_requests/2' },
  });
  const c = new ci.Client(ci.parseRemote('https://gitlab.com/g/p.git'), { token: 'R', writeToken: 'W', fetchImpl: impl });
  assert.equal((await c.pipelines())[0].status, 'running');
  assert.equal(await c.createChangeRequest({ title: 't', source: 'a', target: 'b' }), 'https://gitlab.com/g/p/-/merge_requests/2');
  assert.equal(calls[0].init.headers['PRIVATE-TOKEN'], 'R');
  assert.equal(calls[1].init.headers['PRIVATE-TOKEN'], 'W');
});

test('ci: missing tokens and HTTP errors give readable messages', async () => {
  const none = new ci.Client(ci.parseRemote('git@github.com:o/r.git'), { fetchImpl: async () => { throw new Error('should not be called'); } });
  await assert.rejects(none.pipelines(), /No token/);
  const ro = new ci.Client(ci.parseRemote('git@github.com:o/r.git'), { token: 'R', fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
  await assert.rejects(ro.retry(1), /write access/);
  const denied = new ci.Client(ci.parseRemote('git@github.com:o/r.git'), { token: 'R', fetchImpl: async () => ({ ok: false, status: 401, text: async () => '' }) });
  await assert.rejects(denied.pipelines(), /rejects the token \(401\)/);
});

// ---------------------------------------------------------------- credentials
const fakeCrypto = { encrypt: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)), decrypt: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString() };

test('credentials: tokens and variables are stored encrypted, bound to host and mode', () => {
  const dir = tmp('creds'); const file = path.join(dir, 'secrets.json');
  try {
    const c = new Credentials(fakeCrypto, file);
    c.saveToken('GitHub.com', false, ' ghp_secret ');
    assert.equal(c.getToken('github.com', false), 'ghp_secret');
    assert.equal(c.getToken('github.com', true), null);
    assert.equal(c.tokenFor('github.com', true), null);
    c.saveToken('github.com', true, 'ghp_write');
    assert.equal(c.tokenFor('github.com', false), 'ghp_secret');
    assert.deepEqual(c.listTokens().map((t) => `${t.host}:${t.writing}`).sort(), ['github.com:false', 'github.com:true']);
    c.setEnv('ANTHROPIC_API_KEY', 'sk-123');
    assert.deepEqual(c.envValues(), { ANTHROPIC_API_KEY: 'sk-123' });
    assert.ok(!fs.readFileSync(file, 'utf8').includes('ghp_secret') && !fs.readFileSync(file, 'utf8').includes('sk-123'));
    c.deleteToken('github.com', true); c.deleteEnv('ANTHROPIC_API_KEY');
    assert.equal(c.getToken('github.com', true), null);
    assert.deepEqual(c.listEnv(), []);
  } finally { rm(dir); }
});

test('credentials: dangerous names, hosts and values are refused', () => {
  const dir = tmp('creds2');
  try {
    const c = new Credentials(fakeCrypto, path.join(dir, 's.json'));
    for (const name of ['PATH', 'path', 'USERPROFILE', 'HEARTH_JOURNAL', 'NODE_OPTIONS', '1BAD', 'a b']) assert.throws(() => c.setEnv(name, 'x'), /not allowed/);
    assert.throws(() => c.setEnv('OK_NAME', 'a\nb'), /Invalid value/);
    assert.throws(() => c.saveToken('evil host/..', false, 'x'), /Invalid host/);
    assert.throws(() => c.saveToken('github.com', false, 'two words'), /Invalid token/);
    assert.throws(() => new Credentials({ ...fakeCrypto, available: () => false }, path.join(dir, 'x.json')).saveToken('github.com', false, 't'), /not available/);
  } finally { rm(dir); }
});

// ---------------------------------------------------------------- build tasks
test('build: detects npm scripts, Maven/Spring, Gradle, Go, Cargo, Make and custom tasks', () => {
  const root = tmp('build');
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'jest', dev: 'vite --port 5173', build: 'tsc', pretest: 'x', 'bad name!': 'y' } }));
    fs.writeFileSync(path.join(root, 'go.mod'), 'module x');
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]');
    fs.writeFileSync(path.join(root, 'Makefile'), 'all:\n\techo\nlint:\n\techo\nFOO := 1\n');
    fs.mkdirSync(path.join(root, 'api'));
    fs.writeFileSync(path.join(root, 'api', 'pom.xml'), '<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>');
    fs.mkdirSync(path.join(root, 'web'));
    fs.writeFileSync(path.join(root, 'web', 'build.gradle.kts'), 'plugins { id("org.springframework.boot") }');
    fs.mkdirSync(path.join(root, '.hearth'));
    fs.writeFileSync(path.join(root, '.hearth', 'tasks.json'), JSON.stringify([{ name: 'deploy', command: 'echo deploy', kind: 'service' }, { name: 'bad name', command: 'x' }]));
    const tasks = build.scan(root);
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    assert.equal(byId['node:.:test'].command, 'npm test');
    assert.ok(byId['node:.:test'].test);
    assert.equal(byId['node:.:dev'].kind, 'service');
    assert.equal(byId['node:.:dev'].port, 5173);
    assert.ok(!byId['node:.:pretest'] && !tasks.some((t) => t.name === 'bad name!'));
    assert.ok(byId['maven:api:spring-boot:run'] && byId['maven:api:spring-boot:run'].kind === 'service');
    assert.ok(byId['gradle:web:bootRun']);
    assert.ok(byId['go:.:test'] && byId['cargo:.:run'] && byId['make:.:lint'] && !byId['make:.:FOO']);
    assert.equal(byId['custom:.:deploy'].command, 'echo deploy');
    assert.ok(!byId['custom:.:bad name']);
  } finally { rm(root); }
});

test('build: project files with a UTF-8 BOM (written by Windows editors) are still read', () => {
  const root = tmp('bom');
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '﻿' + JSON.stringify({ scripts: { build: 'x' } }));
    assert.deepEqual(build.scan(root).map((t) => t.name), ['build']);
  } finally { rm(root); }
});

test('build: run output is bounded and a stop wins over the exit that follows', () => {
  const r = new build.Run({ id: 'x' });
  for (let i = 0; i < 40; i++) r.append(Buffer.alloc(100 * 1024, 65));
  assert.ok(r.size <= 2 * 1024 * 1024);
  r.proc = { kill() {} };
  r.stop();
  assert.equal(r.state, 'stopped');
});

// ---------------------------------------------------------------- test reports
const JUNIT = `<?xml version="1.0"?><testsuite name="S" tests="3">
<testcase classname="com.x.Foo" name="adds" time="0.012"/>
<testcase classname="com.x.Foo" name="breaks &amp; burns" time="0.5"><failure message="expected &lt;1&gt; but was &lt;2&gt;">stack</failure></testcase>
<testcase classname="com.x.Bar" name="later"><skipped/></testcase></testsuite>`;

test('tests: JUnit XML is parsed (failures, skips, entities)', () => {
  const cases = testsLib.parseJUnit(JUNIT, 'TEST-Foo.xml');
  assert.equal(cases.length, 3);
  assert.deepEqual(cases.map((c) => c.status), ['passed', 'failed', 'skipped']);
  assert.equal(cases[1].name, 'breaks & burns');
  assert.equal(cases[1].message, 'expected <1> but was <2>');
  assert.equal(cases[0].suite, 'com.x.Foo');
});

test('tests: reports are found in the usual folders and summarised', () => {
  const root = tmp('reports');
  try {
    fs.mkdirSync(path.join(root, 'target', 'surefire-reports'), { recursive: true });
    fs.writeFileSync(path.join(root, 'target', 'surefire-reports', 'TEST-Foo.xml'), JUNIT);
    fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'x', 'junit.xml'), JUNIT);   // must be ignored
    fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>');                        // not a report
    const r = testsLib.load(root);
    assert.deepEqual(r.summary, { total: 3, passed: 1, failed: 1, skipped: 1 });
  } finally { rm(root); }
});

// ---------------------------------------------------------------- search
test('search: fuzzy match works on file names, word starts and initials', () => {
  const s = search.fuzzyScore;
  assert.ok(s('mlv', 'src/ui/MainLayoutView.swift') > 0);
  assert.ok(s('MainLayoutView', 'src/ui/MainLayoutView.swift') > s('mlv', 'src/ui/MainLayoutView.swift'));
  assert.ok(s('layout', 'src/ui/MainLayoutView.swift') > 0);
  assert.ok(s('mainlay', 'src/ui/MainLayoutView.swift') > 0);
  assert.equal(s('zzz', 'src/ui/MainLayoutView.swift'), 0);
  assert.ok(s('git', 'src/main/git.js') > s('git', 'docs/guides/gitignore-notes/readme.md'));
  assert.deepEqual(search.words('MainLayoutView_v2.test'), ['main', 'layout', 'view', 'v2', 'test']);
});

test('search: files, text, symbols and usages in a small project', () => {
  const root = tmp('search');
  try {
    fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'src', 'Greeter.java'), 'import x.Foo;\n// calls greet() somewhere\npublic class Greeter {\n  public String greet(String name) {\n    return "hi " + name;\n  }\n}\n');
    fs.writeFileSync(path.join(root, 'src', 'app.js'), 'function greet() { return 1; }\nconst run = () => greet();\n');
    fs.writeFileSync(path.join(root, 'node_modules', 'skip.js'), 'function greet() {}');
    fs.writeFileSync(path.join(root, 'src', 'bin.dat'), Buffer.from([0, 1, 2, 3]));
    const files = search.listFiles(root);
    assert.equal(files.length, 3);                                              // node_modules skipped
    assert.equal(search.searchFiles(root, 'greeter', files)[0].rel, 'src/Greeter.java');
    assert.equal(search.searchText(root, 'RETURN', { files }).length, 2);
    const syms = search.searchSymbols(root, 'greet', files).map((x) => `${x.name}@${x.rel}:${x.line}`);
    assert.ok(syms.includes('greet@src/Greeter.java:4') && syms.includes('greet@src/app.js:1'));
    assert.ok(search.searchSymbols(root, 'Greeter', files)[0].kind === 'type');
    const all = search.findUsages(root, 'greet', { files, allLanguages: true });
    assert.ok(all.some((h) => h.kind === 'definition') && all.some((h) => h.kind === 'comment') && all.some((h) => h.kind === 'code'));
    const js = search.findUsages(root, 'greet', { file: path.join(root, 'src', 'app.js'), files });
    assert.ok(js.every((h) => h.rel.endsWith('.js')));
    assert.equal(js.find((h) => h.line === 2).container, 'run');
    const over = search.findUsages(root, 'greet', { file: path.join(root, 'src', 'app.js'), files, overrides: { [path.join(root, 'src', 'app.js')]: 'greet(); greet();' } });
    assert.equal(over.length, 1);
    assert.deepEqual(search.findUsages(root, 'bad word', { files }), []);
  } finally { rm(root); }
});

// ---------------------------------------------------------------- architecture, updates
test('architecture: mermaid fences and .mmd files are found with their headings', () => {
  const root = tmp('arch');
  try {
    fs.writeFileSync(path.join(root, 'a.md'), '# Title\n\n## Flow\n```mermaid\nflowchart LR\n  A-->B\n```\ntext\n~~~mermaid\nsequenceDiagram\n  A->>B: hi\n~~~\n```js\nnot mermaid\n```\n');
    fs.writeFileSync(path.join(root, 'b.mmd'), 'graph TD\n A-->B\n');
    fs.writeFileSync(path.join(root, 'c.md'), 'no diagrams');
    const found = arch.scan(root);
    assert.deepEqual(found.map((f) => f.rel).sort(), ['a.md', 'b.mmd']);
    const a = found.find((f) => f.rel === 'a.md');
    assert.equal(a.blocks.length, 2);
    assert.equal(a.blocks[0].title, 'Flow');
    assert.match(a.blocks[0].code, /A-->B/);
  } finally { rm(root); }
});

test('updates: version comparison and the release check', async () => {
  assert.equal(updates.compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(updates.compareVersions('v1.0', '1.0.0'), 0);
  assert.equal(updates.compareVersions('0.1.0', '0.10.0'), -1);
  const ok = await updates.check('0.1.0', { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v0.2.0', html_url: 'https://github.com/x/y/releases/tag/v0.2.0' }) }) });
  assert.deepEqual([ok.latest, ok.newer], ['0.2.0', true]);
  const none = await updates.check('0.1.0', { fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(none.newer, false);
  await assert.rejects(updates.check('0.1.0', { fetchImpl: async () => ({ ok: false, status: 500 }) }), /500/);
});

// ---------------------------------------------------------------- git actions
test('git: branch list parsing and ref validation', () => {
  const b = git.parseBranches('main\t*\torigin/main\tlocal\nfeature/x\t \t\tlocal\norigin/main\t \t\tremote\norigin/HEAD\t \t\tremote\n');
  assert.deepEqual(b.map((x) => [x.name, x.current, x.remote]), [['main', true, false], ['feature/x', false, false], ['origin/main', false, true]]);
  for (const ok of ['main', 'feature/login-2', 'release-1.2.3']) assert.ok(git.validRef(ok), ok);
  for (const bad of ['-D', '--force', 'a..b', 'x/', 'x.lock', 'a b', 'a;rm', '', '$(x)']) assert.ok(!git.validRef(bad), bad);
  assert.deepEqual(git.parseStashes('stash@{0}\x1fWIP on main\nstash@{1}\x1fexperiment\n'), [{ ref: 'stash@{0}', subject: 'WIP on main' }, { ref: 'stash@{1}', subject: 'experiment' }]);
});

test('git: branches, checkout, merge, stash and push (against a local bare remote)', async () => {
  const root = tmp('gitops'); const remote = path.join(root, 'remote.git'); const work = path.join(root, 'work');
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
  try {
    fs.mkdirSync(remote); g(remote, 'init', '--bare', '-b', 'main');
    fs.mkdirSync(work); g(work, 'init', '-b', 'main'); g(work, 'config', 'user.email', 't@e.st'); g(work, 'config', 'user.name', 'T');
    fs.writeFileSync(path.join(work, 'a.txt'), 'one\n'); await git.stage(work, ['a.txt']); await git.commit(work, 'first');
    g(work, 'remote', 'add', 'origin', remote);
    assert.equal(await git.remoteUrl(work), remote);
    await git.push(work);                                                       // publishes main with upstream
    assert.equal((await git.status(work)).upstream, 'origin/main');
    await git.createBranch(work, 'feature');
    fs.writeFileSync(path.join(work, 'b.txt'), 'two\n'); await git.stageAll(work); await git.commit(work, 'second');
    await git.checkout(work, 'main');
    await git.merge(work, 'feature');
    assert.ok(fs.existsSync(path.join(work, 'b.txt')));
    assert.equal(await git.mergeInProgress(work), false);
    fs.writeFileSync(path.join(work, 'c.txt'), 'wip\n');
    await git.stashSave(work, 'wip');
    assert.equal((await git.stashList(work)).length, 1);
    assert.ok(!fs.existsSync(path.join(work, 'c.txt')));
    await git.stashPop(work, 'stash@{0}');
    assert.ok(fs.existsSync(path.join(work, 'c.txt')));
    await git.stageAll(work); await git.unstageAll(work);
    assert.ok((await git.status(work)).files.every((f) => !f.staged));
    await assert.rejects(git.checkout(work, '--force'), /Invalid branch/);
    await assert.rejects(git.stashDrop(work, 'stash@{0};x'), /Invalid stash/);
    await git.push(work);
    assert.equal(g(remote, 'rev-parse', 'main').trim(), g(work, 'rev-parse', 'main').trim());
  } finally { rm(root); }
});

// ---------------------------------------------------------------- translations
test('every UI text has a German translation', () => {
  assert.deepEqual(i18n.missing(), []);
});
