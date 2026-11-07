'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ops = require('../src/main/fileops');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-ops-'));

test('copy: new name when the target exists, folders are copied recursively', async () => {
  const d = tmp(); fs.mkdirSync(path.join(d, 'a/sub'), { recursive: true }); fs.writeFileSync(path.join(d, 'a/sub/x.txt'), 'x'); fs.writeFileSync(path.join(d, 'f.txt'), 'f');
  fs.mkdirSync(path.join(d, 'dest'));
  assert.equal(await ops.copyInto(path.join(d, 'f.txt'), d), path.join(d, 'f copy.txt'));
  assert.equal(await ops.copyInto(path.join(d, 'f.txt'), d), path.join(d, 'f copy 2.txt'));
  await ops.copyInto(path.join(d, 'a'), path.join(d, 'dest'));
  assert.equal(fs.readFileSync(path.join(d, 'dest/a/sub/x.txt'), 'utf8'), 'x');
  await assert.rejects(ops.copyInto(path.join(d, 'a'), path.join(d, 'a/sub')), /into itself/);
});

test('move: refuses to overwrite, to move into itself and moves back to the same place without change', async () => {
  const d = tmp(); fs.mkdirSync(path.join(d, 'a')); fs.mkdirSync(path.join(d, 'b')); fs.writeFileSync(path.join(d, 'a/f.txt'), '1'); fs.writeFileSync(path.join(d, 'b/f.txt'), '2');
  await assert.rejects(ops.moveInto(path.join(d, 'a/f.txt'), path.join(d, 'b')), /already exists/);
  await assert.rejects(ops.moveInto(path.join(d, 'a'), path.join(d, 'a')), /into itself/);
  assert.equal(await ops.moveInto(path.join(d, 'a/f.txt'), path.join(d, 'a')), path.join(d, 'a/f.txt'));
  fs.unlinkSync(path.join(d, 'b/f.txt'));
  assert.equal(await ops.moveInto(path.join(d, 'a/f.txt'), path.join(d, 'b')), path.join(d, 'b/f.txt'));
  assert.ok(!fs.existsSync(path.join(d, 'a/f.txt')));
});

test('rename and create validate names and never overwrite', async () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'a.txt'), ''); fs.writeFileSync(path.join(d, 'b.txt'), '');
  await assert.rejects(ops.rename(path.join(d, 'a.txt'), 'b.txt'), /already exists/);
  await assert.rejects(ops.rename(path.join(d, 'a.txt'), '../x'), /Invalid name/);
  await assert.rejects(ops.create(d, 'a:b', false), /Invalid name/);
  assert.equal(await ops.rename(path.join(d, 'a.txt'), 'c.txt'), path.join(d, 'c.txt'));
  assert.equal(await ops.rename(path.join(d, 'c.txt'), 'C.txt'), path.join(d, 'C.txt'));      // only the case changes
  await ops.create(d, 'dir', true); await ops.create(d, 'n.go', false);
  assert.ok(fs.statSync(path.join(d, 'dir')).isDirectory() && fs.existsSync(path.join(d, 'n.go')));
  await assert.rejects(ops.create(d, 'n.go', false), /already exists/);
});

test('.git/hooks stays write-protected', async () => {
  const d = tmp(); fs.mkdirSync(path.join(d, '.git/hooks'), { recursive: true }); fs.writeFileSync(path.join(d, 'f'), '');
  await assert.rejects(ops.copyInto(path.join(d, 'f'), path.join(d, '.git/hooks')), /write-protected/);
  await assert.rejects(ops.create(path.join(d, '.git/hooks'), 'pre-commit', false), /write-protected/);
});
