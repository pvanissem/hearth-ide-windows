'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { History } = require('../src/main/history');

test('history keeps one entry per agent and folder, newest first, and survives a restart', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-hist-')), 'sessions.json');
  const h = new History(f, 3);
  h.record('claude', 'C:\p\a'); h.record('shell', 'C:\p\a'); h.record('claude', 'C:\P\A');
  assert.deepEqual(new History(f).list().map((x) => x.kind), ['claude', 'shell']);
  h.record('claude', 'C:\p\b'); h.record('claude', 'C:\p\c');
  assert.equal(h.list().length, 3);
  h.forget('claude', 'c:\p\c');
  assert.ok(!h.list().some((x) => x.directory === 'C:\p\c'));
  fs.writeFileSync(f, 'not json'); assert.deepEqual(h.list(), []);
});
