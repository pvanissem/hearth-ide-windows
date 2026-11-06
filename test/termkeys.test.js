'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../src/renderer/term-keys');

const ev = (key, mods = {}, type = 'keydown') => ({ type, key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });

test('Ctrl+C copies with a selection, otherwise it stays the interrupt signal', () => {
  assert.equal(K.action(ev('c', { ctrlKey: true }), true), 'copy');
  assert.equal(K.action(ev('c', { ctrlKey: true }), false), 'pass');
  assert.equal(K.action(ev('C', { ctrlKey: true, shiftKey: true }), false), 'copy');
  assert.equal(K.action(ev('Insert', { ctrlKey: true }), false), 'copy');
});

test('paste: Ctrl+V, Ctrl+Shift+V and Shift+Insert', () => {
  assert.equal(K.action(ev('v', { ctrlKey: true }), false), 'paste');
  assert.equal(K.action(ev('V', { ctrlKey: true, shiftKey: true }), true), 'paste');
  assert.equal(K.action(ev('Insert', { shiftKey: true }), false), 'paste');
});

test('Ctrl+K opens the search; everything else, key-ups and Alt combinations pass through to the terminal', () => {
  assert.equal(K.action(ev('k', { ctrlKey: true }), false), 'search');
  assert.equal(K.action(ev('K', { ctrlKey: true, shiftKey: true }), false), 'pass');
  assert.equal(K.action(ev('c', { ctrlKey: true }, 'keyup'), true), 'pass');
  assert.equal(K.action(ev('c', { ctrlKey: true, altKey: true }), true), 'pass');
  assert.equal(K.action(ev('a'), true), 'pass');
  assert.equal(K.action(null, true), 'pass');
});

test('copied text loses the terminal padding and gets Windows line endings', () => {
  assert.equal(K.cleanCopy('https://claude.com/x   \nsecond line  \n'), 'https://claude.com/x\r\nsecond line\r\n');
  assert.equal(K.cleanCopy(''), '');
  assert.equal(K.cleanCopy(null), '');
});

test('pasting more than one line asks first; one line (with or without a final newline) does not', () => {
  assert.equal(K.needsConfirm('abc'), false);
  assert.equal(K.needsConfirm('abc\n'), false);
  assert.equal(K.needsConfirm('abc\r\n'), false);
  assert.equal(K.needsConfirm('rm -rf x\ncd y'), true);
  assert.equal(K.needsConfirm(''), false);
});
