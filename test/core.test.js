'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toWslPath, fromWslPath, shQuote } = require('../src/main/paths');
const { makePolicy, toProfile, validDomain } = require('../src/main/policy');
const { parseStatus } = require('../src/main/git');
const { StatusTracker, QUIET_MS } = require('../src/main/status');
const { sanitize } = require('../src/main/settings');

test('path translation', () => {
  assert.equal(toWslPath('C:\\Users\\Me\\proj'), '/mnt/c/Users/Me/proj');
  assert.equal(toWslPath('d:/x/'), '/mnt/d/x');
  assert.equal(toWslPath('C:\\'), '/mnt/c');
  assert.equal(toWslPath('/already/posix'), '/already/posix');
  assert.equal(fromWslPath('/mnt/c/Users/Me'), 'C:\\Users\\Me');
  assert.equal(fromWslPath('/home/me'), '/home/me');
});

test('shell quoting survives single quotes', () => {
  assert.equal(shQuote("it's"), "'it'\\''s'");
});

const ctx = { kind: 'claude', wslHome: '/home/me', workdir: '/mnt/c/p', runDir: '/mnt/c/runs/1', settings: {} };

test('agent policy: writes only workdir, run dir and its own config home', () => {
  const p = makePolicy('agent', ctx);
  assert.deepEqual(p.readWrite, ['/mnt/c/runs/1', '/mnt/c/p', '/home/me/.hearth/agents/claude']);
  assert.ok(!p.readWrite.some((x) => x.includes('/.ssh')));
  assert.deepEqual(p.denyWrite, ['/mnt/c/p/.git/hooks']);
  assert.ok(p.domains.includes('api.anthropic.com'));
});

test('ssh is readable only for git network and only when enabled', () => {
  assert.ok(!makePolicy('agent', { ...ctx, settings: { gitSSH: true } }).read.includes('/home/me/.ssh'));
  assert.ok(makePolicy('gitNetwork', { ...ctx, settings: { gitSSH: true } }).read.includes('/home/me/.ssh'));
  assert.ok(!makePolicy('gitNetwork', { ...ctx, settings: { gitSSH: false } }).read.includes('/home/me/.ssh'));
  assert.ok(!makePolicy('gitLocal', { ...ctx, settings: { gitSSH: true } }).read.includes('/home/me/.ssh'));
});

test('git hosts only count for git network; invalid domains are dropped', () => {
  const settings = { domains: ['ok.example.com', 'bad domain', 'x;rm -rf'] };
  const agent = makePolicy('agent', { ...ctx, settings, gitHosts: ['github.com'] });
  assert.ok(agent.domains.includes('ok.example.com'));
  assert.ok(!agent.domains.includes('bad domain'));
  assert.ok(!agent.domains.includes('github.com'));
  const net = makePolicy('gitNetwork', { ...ctx, settings, gitHosts: ['github.com'] });
  assert.ok(net.domains.includes('github.com'));
});

test('profile is deterministic JSON for nono', () => {
  const a = JSON.stringify(toProfile(makePolicy('agent', ctx)));
  const b = JSON.stringify(toProfile(makePolicy('agent', ctx)));
  assert.equal(a, b);
  const prof = JSON.parse(a);
  assert.equal(prof.extends, 'default');
  assert.equal(prof.network.network_profile, 'developer');
  assert.deepEqual(prof.filesystem.allow, ['/mnt/c/runs/1', '/mnt/c/p', '/home/me/.hearth/agents/claude']);
});

test('domain validation', () => {
  assert.ok(validDomain('api.github.com'));
  assert.ok(!validDomain('localhost'));
  assert.ok(!validDomain('a b.com'));
  assert.ok(!validDomain(''));
});

test('git status parsing: branch, tracking, renames, untracked', () => {
  const raw = ['## main...origin/main [ahead 2, behind 1]', 'M  staged.txt', ' M dirty.txt', 'R  new.txt', 'old.txt', '?? fresh.txt', ''].join('\0');
  const st = parseStatus(raw);
  assert.equal(st.branch, 'main');
  assert.equal(st.upstream, 'origin/main');
  assert.equal(st.ahead, 2);
  assert.equal(st.behind, 1);
  assert.equal(st.files.length, 4);
  assert.deepEqual(st.files.map((f) => f.path), ['staged.txt', 'dirty.txt', 'new.txt', 'fresh.txt']);
  assert.equal(st.files[2].from, 'old.txt');
  assert.ok(st.files[0].staged && !st.files[0].unstaged);
  assert.ok(st.files[1].unstaged && !st.files[1].staged);
  assert.ok(st.files[3].untracked);
});

test('git status parsing: branch without upstream and branch names with dots', () => {
  assert.equal(parseStatus('## release/1.2.3\0').branch, 'release/1.2.3');
  assert.equal(parseStatus('## No commits yet on main\0').branch, 'main');
});

test('status tracker: running -> needs-input on prompt, bell, exit', async () => {
  let t = 0; const seen = [];
  const tr = new StatusTracker((s) => seen.push(s), () => t);
  tr.data('working...');
  assert.equal(tr.state, 'running');
  tr.data('Allow this edit? [y/n] ');
  tr.settle();
  assert.equal(tr.state, 'needs-input');
  tr.data('ok\n'); tr.settle();
  assert.equal(tr.state, 'idle');
  tr.data('\x07');
  assert.equal(tr.state, 'needs-input');
  tr.exit(0);
  assert.equal(tr.state, 'done');
  tr.data('late'); assert.equal(tr.state, 'done');
  assert.ok(QUIET_MS > 0 && seen.length >= 5);
});

test('git log on a repository without commits is empty, not an error', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const git = require('../src/main/git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-git-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    assert.deepEqual(await git.log(dir), []);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hi\n');
    assert.equal((await git.status(dir)).files[0].untracked, true);
    await git.stage(dir, ['a.txt']);
    assert.equal((await git.status(dir)).files[0].staged, true);
    await assert.rejects(git.commit(dir, '  '), /empty/);
    execFileSync('git', ['config', 'user.email', 't@e.st'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
    await git.commit(dir, 'first');
    assert.equal((await git.log(dir))[0].subject, 'first');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('settings sanitize rejects junk', () => {
  const s = sanitize({ domains: ['good.dev', 'no spaces', 5], ports: [80, 0, 70000, 'x'], folders: [{ path: 'C:\\a', write: 1 }, {}], language: 'fr' });
  assert.deepEqual(s.domains, ['good.dev']);
  assert.deepEqual(s.ports, [80]);
  assert.deepEqual(s.folders, [{ path: 'C:\\a', write: true }]);
  assert.equal(s.language, 'en');
  assert.equal(s.allowUnsandboxed, false);
});
