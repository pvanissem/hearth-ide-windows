'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const native = require('../src/main/native');

test('container name is stable per folder, case-insensitive and differs between folders', () => {
  const a = native.containerName('C:\\Work\\Proj');
  assert.equal(a, native.containerName('c:\\work\\proj'));
  assert.notEqual(a, native.containerName('C:\\Work\\Other'));
  assert.match(a, /^p[0-9a-f]{16}$/);
});

test('argument quoting follows the Windows command-line rules', () => {
  assert.equal(native.quoteArg('plain'), 'plain');
  assert.equal(native.quoteArg('with space'), '"with space"');
  assert.equal(native.quoteArg('say "hi"'), '"say \\"hi\\""');
  assert.equal(native.quoteArg('C:\\dir with space\\'), '"C:\\dir with space\\\\"');
  assert.equal(native.quoteArg(''), '""');
});

test('scripts (.cmd/.bat) run through cmd.exe, executables directly', () => {
  assert.equal(native.commandLine('C:\\Tools\\git.exe', ['status', 'a b']), 'C:\\Tools\\git.exe status "a b"');
  const cmd = native.commandLine('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd', ['--resume', 'x']);
  assert.ok(cmd.startsWith('cmd.exe /d /s /c "'));
  assert.ok(cmd.includes('claude.cmd'));
});

test('runtime folders: only tool folders inside the profile, never the profile or key folders', () => {
  const home = 'C:\\Users\\me';
  const sep = path.delimiter;
  const env = { PATH: ['C:\\Windows\\System32', 'C:\\Users\\me', 'C:\\Users\\me\\AppData\\Roaming\\npm', 'C:\\Users\\me\\.ssh', 'C:\\Users\\me\\bin', 'C:\\Users\\me\\gone'].join(sep) };
  const found = native.runtimeFolders(env, home, (p) => !p.endsWith('gone')).map((p) => p.toLowerCase());
  assert.deepEqual(found, ['c:\\users\\me\\appdata\\roaming\\npm', 'c:\\users\\me\\bin'].filter(() => true).map((p) => path.resolve(p).toLowerCase()));
});

const base = { directory: 'C:\\p', runDir: 'C:\\runs\\1', home: 'C:\\h', kind: 'shell', settings: { folders: [{ path: 'C:\\docs', write: false }, { path: 'C:\\out', write: true }] },
  executable: 'C:\\Windows\\System32\\cmd.exe', args: ['/d'], network: 'internet', runtime: ['C:\\Users\\me\\bin'] };

test('helper arguments: writes only project, private home and run folder; hooks are read-only', () => {
  const a = native.buildArgs(base);
  const pairs = (flag) => a.flatMap((v, i) => (v === flag ? [a[i + 1]] : []));
  assert.deepEqual(pairs('--rw'), ['C:\\p', 'C:\\h', 'C:\\runs\\1', 'C:\\out']);
  assert.deepEqual(pairs('--ro'), ['C:\\Users\\me\\bin', 'C:\\docs']);
  assert.deepEqual(pairs('--deny-write'), [path.join('C:\\p', '.git', 'hooks')]);
  assert.equal(pairs('--net')[0], 'internet');
  const env = Object.fromEntries(pairs('--env').map((e) => e.split(/=(.*)/s).slice(0, 2)));
  assert.equal(env.USERPROFILE, 'C:\\h');
  assert.equal(env.HOME, 'C:\\h');
  assert.equal(env.TEMP, path.join('C:\\h', 'Temp'));
  assert.equal(env.NODE_PRESERVE_SYMLINKS, '1');          // Node cannot lstat C:\ in an AppContainer
  assert.equal(env.NODE_PRESERVE_SYMLINKS_MAIN, '1');
  const cmd = Buffer.from(pairs('--cmd64')[0], 'base64').toString('utf8');
  assert.equal(cmd, 'C:\\Windows\\System32\\cmd.exe /d');
});

test('leases: grants are removed only when the last user of a project is gone', () => {
  const { Leases } = require('../src/main/leases');
  const calls = [];
  const leases = new Leases({ run: (h, a) => calls.push(['run', h, a.join(' ')]), runSync: (h, a) => calls.push(['sync', h, a.join(' ')]) });
  const build = leases.acquire('C:\\Work\\Proj');
  const tests = leases.acquire('c:\\work\\proj');            // same folder, another spelling, still starting
  leases.attach(build, { helper: 'H', revoke: ['--name', 'x', '--rw', 'C:\\Work\\Proj', '--revoke'] });
  assert.equal(leases.count('C:\\Work\\Proj'), 2);
  assert.equal(leases.release(build), false);                 // the test run is still there: nothing is revoked
  assert.equal(calls.length, 0);
  leases.attach(tests, { helper: 'H', revoke: ['--name', 'x', '--rw', 'C:\\runs\\2', '--revoke'] });
  assert.equal(leases.release(tests), true);
  assert.deepEqual(calls.map((c) => c[0]), ['run', 'run']);   // both launches' grants are undone
  assert.equal(leases.release(tests), false);                 // releasing twice does nothing
  assert.equal(leases.count('C:\\Work\\Proj'), 0);
});

test('leases: a failed start releases its lease; app exit undoes everything synchronously', () => {
  const { Leases } = require('../src/main/leases');
  const calls = [];
  const leases = new Leases({ run: () => calls.push('async'), runSync: (h, a) => calls.push(`sync:${a[0]}`) });
  const failed = leases.acquire('C:\\A');
  assert.equal(leases.release(failed), false);                // nothing was granted
  assert.equal(leases.count('C:\\A'), 0);
  const l = leases.acquire('C:\\B'); leases.attach(l, { helper: 'H', revoke: ['b', '--revoke'] });
  leases.releaseAllSync();
  assert.deepEqual(calls, ['sync:b']);
  assert.equal(leases.count('C:\\B'), 0);
});

test('leases: grants left behind by a killed run are undone at the next start, but never those of a running instance', () => {
  const fs = require('node:fs'); const os = require('node:os');
  const { Leases } = require('../src/main/leases');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-leases-'));
  const helper = path.join(dir, 'helper.exe'); fs.writeFileSync(helper, '');
  const state = path.join(dir, 'grants.json');
  try {
    const calls = [];
    const first = new Leases({ run: (h, a) => calls.push(a.join(' ')), runSync: (h, a) => calls.push('sync ' + a.join(' ')) }, { stateFile: state });
    const l = first.acquire('C:\\Work\\Proj');
    first.attach(l, { helper, revoke: ['--name', 'x', '--rw', 'C:\\Work\\Proj', '--revoke'] });
    assert.ok(fs.existsSync(state), 'grants are written down while they are in use');
    // the app is killed here: nothing is released. The next start recovers.
    const next = new Leases({ run: (h, a) => calls.push('recovered ' + a.join(' ')) }, { stateFile: state });
    const saved = JSON.parse(fs.readFileSync(state, 'utf8'));
    fs.writeFileSync(state, JSON.stringify({ ...saved, pid: 2147480000 }));        // an owner that is not running
    assert.equal(next.recover(), 1);
    assert.deepEqual(calls.filter((c) => c.startsWith('recovered')), ['recovered --name x --rw C:\\Work\\Proj --revoke']);
    assert.ok(!fs.existsSync(state));
    // a live owner (this process, seen from "another" instance): hands off
    first.attach(l, { helper, revoke: ['--name', 'y', '--revoke'] });
    fs.writeFileSync(state, JSON.stringify({ ...JSON.parse(fs.readFileSync(state, 'utf8')), pid: process.ppid || 1 }));
    const other = new Leases({ run: () => calls.push('wrong') }, { stateFile: state });
    if (process.ppid && process.ppid !== process.pid) { assert.equal(other.recover(), 0); assert.ok(fs.existsSync(state)); }
    // a normal release clears the file; junk in the file never runs anything
    first.release(l);
    assert.ok(!fs.existsSync(state));
    fs.writeFileSync(state, JSON.stringify({ pid: 1, items: [{ helper, args: ['--rw', 'C:\\x'] }, { helper: 5, args: [] }, { helper: path.join(dir, 'missing.exe'), args: ['--revoke'] }] }));
    assert.equal(new Leases({ run: () => calls.push('junk') }, { stateFile: state }).recover(), 0);
    assert.ok(!calls.includes('junk') && !calls.includes('wrong'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the running app\'s own folder is kept out of the grants when it lies inside the project', () => {
  // the app folder inside the project (e.g. a build in <repo>\dist\win-unpacked): excluded
  const inside = native.appFolders('C:\\Work\\repo', 'C:\\Work\\repo\\dist\\win-unpacked\\Hearth IDE.exe', 'C:\\Work\\repo\\dist\\win-unpacked\\resources');
  assert.deepEqual(inside, [path.resolve('C:\\Work\\repo\\dist\\win-unpacked')]);
  // dev run: electron.exe in node_modules\electron\dist
  assert.deepEqual(native.appFolders('C:\\Work\\repo', 'C:\\Work\\repo\\node_modules\\electron\\dist\\electron.exe', 'C:\\Work\\repo\\node_modules\\electron\\dist\\resources'),
    [path.resolve('C:\\Work\\repo\\node_modules\\electron\\dist')]);
  // an app outside the project, or the project inside the app: nothing to exclude
  assert.deepEqual(native.appFolders('C:\\Work\\repo', 'C:\\Apps\\Hearth\\Hearth IDE.exe', 'C:\\Apps\\Hearth\\resources'), []);
  assert.deepEqual(native.appFolders('C:\\Apps\\Hearth\\data', 'C:\\Apps\\Hearth\\Hearth IDE.exe', 'C:\\Apps\\Hearth\\resources'), []);
  const a = native.buildArgs({ ...base, exclude: ['C:\\p\\dist\\win-unpacked'] });
  assert.equal(a[a.indexOf('--exclude') + 1], 'C:\\p\\dist\\win-unpacked');
  assert.ok(native.revokeArgs(a).includes('--exclude'));          // undone again when the last process of the project ends
});

test('the real profile folder is never granted by default', () => {
  const a = native.buildArgs(base).join(' ');
  assert.ok(!a.includes('.ssh'));
});

test('offline mode is passed through and revoke arguments mirror the grants', () => {
  const a = native.buildArgs({ ...base, network: 'none' });
  assert.equal(a[a.indexOf('--net') + 1], 'none');
  const r = native.revokeArgs(a);
  assert.equal(r[r.length - 1], '--revoke');
  assert.ok(!r.includes('--env') && !r.includes('--cmd64') && !r.includes('--net'));
  assert.equal(r.filter((x) => x === '--rw').length, a.filter((x) => x === '--rw').length);
});
