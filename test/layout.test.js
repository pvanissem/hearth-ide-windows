'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/renderer/layout-model');

const shape = (n) => (n.type === 'group' ? `[${n.views.join(',')}${n.keep ? '*' : ''}]` : `${n.dir}(${n.children.map(shape).join(' ')})`);
const views = (tree) => L.groups(tree).flatMap((g) => g.views);
const sum = (a) => a.reduce((x, y) => x + y, 0);
function check(tree) {                      // invariants that must hold after every operation
  const seen = new Set();
  const visit = (n) => {
    if (n.type === 'group') {
      for (const v of n.views) { assert.ok(!seen.has(v), `view ${v} twice`); seen.add(v); assert.ok(L.VIEWS.includes(v)); }
      if (n.views.length) assert.ok(n.views.includes(n.active), `active ${n.active} not in ${n.views}`);
      else assert.ok(n.keep, 'empty group without keep');
    } else {
      assert.ok(n.children.length >= 2, 'split with fewer than two children');
      assert.equal(n.children.length, n.sizes.length);
      assert.ok(Math.abs(sum(n.sizes) - 1) < 1e-9, 'sizes do not add up to 1');
      for (const c of n.children) { assert.ok(!(c.type === 'split' && c.dir === n.dir), 'nested split with the same direction'); visit(c); }
    }
  };
  visit(tree);
}

test('default layout: sessions | agent+editor | inspector views, nothing hidden', () => {
  const t = L.defaultLayout();
  check(t);
  assert.equal(shape(t), 'row([sessions] [agent,editor] [files,git,overview,tests,arch,build,ci])');
  assert.deepEqual(L.hiddenViews(t), []);
});

test('moving a view into another group puts it there and makes it active', () => {
  let t = L.defaultLayout();
  const target = L.groupOf(t, 'agent').id;
  t = L.moveView(t, 'git', target, 'center');
  check(t);
  assert.deepEqual(L.groupOf(t, 'agent').views, ['agent', 'editor', 'git']);
  assert.equal(L.groupOf(t, 'git').active, 'git');
  assert.ok(!L.groupOf(t, 'files').views.includes('git'));
});

test('dropping on an edge splits: a new column, a new row, and next to a neighbour in the same direction', () => {
  let t = L.defaultLayout();
  t = L.moveView(t, 'git', L.groupOf(t, 'agent').id, 'right');
  check(t);
  assert.equal(shape(t), 'row([sessions] [agent,editor] [git] [files,overview,tests,arch,build,ci])');   // joins the existing row split
  t = L.moveView(t, 'ci', L.groupOf(t, 'agent').id, 'bottom');
  check(t);
  assert.match(shape(t), /col\(\[agent,editor\] \[ci\]\)/);
  t = L.moveView(t, 'tests', L.groupOf(t, 'ci').id, 'top');
  check(t);
  assert.match(shape(t), /col\(\[agent,editor\] \[tests\] \[ci\]\)/);
});

test('sizes: a split pane takes half of the space of the pane it was cut from', () => {
  let t = L.defaultLayout();
  const before = t.sizes[1];
  t = L.moveView(t, 'git', L.groupOf(t, 'agent').id, 'right');
  assert.ok(Math.abs(t.sizes[1] - before / 2) < 1e-9 && Math.abs(t.sizes[2] - before / 2) < 1e-9);
});

test('moving the last view out of a group removes the group and its splits collapse', () => {
  let t = L.defaultLayout();
  t = L.moveView(t, 'sessions', L.groupOf(t, 'agent').id, 'center');
  check(t);
  assert.equal(shape(t), 'row([agent,editor,sessions] [files,git,overview,tests,arch,build,ci])');
  t = L.moveView(t, 'agent', L.groupOf(t, 'files').id, 'bottom');
  check(t);
  assert.match(shape(t), /col\(\[files,git,overview,tests,arch,build,ci\] \[agent\]\)/);
});

test('dropping a lone view on its own edge changes nothing; reordering inside a group works', () => {
  const t = L.defaultLayout();
  const sessions = L.groupOf(t, 'sessions');
  assert.deepEqual(L.moveView(t, 'sessions', sessions.id, 'left'), t);
  const r = L.moveView(t, 'ci', L.groupOf(t, 'ci').id, 'center', 0);
  check(r);
  assert.deepEqual(L.groupOf(r, 'ci').views.slice(0, 2), ['ci', 'files']);
});

test('hide and show: hidden views come back next to their usual neighbours', () => {
  let t = L.defaultLayout();
  t = L.hideView(t, 'git');
  check(t);
  assert.deepEqual(L.hiddenViews(t), ['git']);
  t = L.showView(t, 'git');
  check(t);
  assert.ok(L.groupOf(t, 'git'));
  assert.equal(L.groupOf(t, 'git').active, 'git');
  const g = L.groupOf(t, 'agent').id;
  t = L.hideView(t, 'editor'); t = L.showView(t, 'editor', g);
  assert.ok(L.groupOf(t, 'agent').views.includes('editor'));
  assert.equal(L.showView(t, 'nonsense'), t);
});

test('a split pane starts empty with a chooser; filling it clears the marker; closing it removes it', () => {
  let t = L.defaultLayout();
  t = L.splitGroup(t, L.groupOf(t, 'agent').id, 'col');
  check(t);
  assert.match(shape(t), /col\(\[agent,editor\] \[\*\]\)/);
  const empty = L.groups(t).find((g) => g.keep);
  t = L.moveView(t, 'ci', empty.id, 'center');      // picking a view in the chooser moves it here (it was visible elsewhere)
  check(t);
  assert.ok(!L.groups(t).some((g) => g.keep));
  assert.deepEqual(L.groupOf(t, 'ci').views, ['ci']);
  t = L.closeGroup(t, L.groupOf(t, 'ci').id);
  check(t);
  assert.ok(L.hiddenViews(t).includes('ci'));
});

test('closing every pane leaves one empty pane with the chooser', () => {
  let t = L.defaultLayout();
  for (const g of L.groups(t)) t = L.closeGroup(t, g.id);
  check(t);
  assert.equal(shape(t), '[*]');
  assert.equal(L.hiddenViews(t).length, L.VIEWS.length);
});

test('resize moves a divider but never below the minimum pane size', () => {
  let t = L.defaultLayout();
  const a = t.sizes[0];
  t = L.resize(t, t.id, 0, 0.1);
  check(t);
  assert.ok(Math.abs(t.sizes[0] - (a + 0.1)) < 1e-9);
  t = L.resize(t, t.id, 0, -5);
  check(t);
  assert.ok(t.sizes[0] >= 0.05 - 1e-9);
  t = L.resize(t, t.id, 0, 5);
  check(t);
  assert.ok(t.sizes[1] >= 0.05 - 1e-9);
  assert.equal(L.resize(t, t.id, 9, 0.1), t);
});

test('zoom per pane is kept within bounds', () => {
  let t = L.defaultLayout();
  const id = L.groupOf(t, 'agent').id;
  t = L.setZoom(t, id, 3); assert.equal(L.findById(t, id).zoom, 3);
  t = L.setZoom(t, id, 99); assert.equal(L.findById(t, id).zoom, 8);
  t = L.setZoom(t, id, -99); assert.equal(L.findById(t, id).zoom, -4);
});

test('sanitize: a stored layout survives a JSON round trip; junk falls back to null', () => {
  let t = L.defaultLayout();
  t = L.moveView(t, 'git', L.groupOf(t, 'agent').id, 'right');
  t = L.setZoom(t, L.groupOf(t, 'git').id, 2);
  const back = L.sanitize(JSON.parse(JSON.stringify(t)));
  check(back);
  assert.equal(shape(back), shape(t));
  assert.equal(L.groupOf(back, 'git').zoom, 2);
  for (const junk of [null, 5, 'x', {}, { type: 'split' }, { type: 'split', dir: 'row', children: [] }, { type: 'split', dir: 'diagonal', children: [{ type: 'group', views: ['git'] }] }]) assert.equal(L.sanitize(junk), null);
});

test('sanitize drops unknown and duplicate views and repairs bad sizes', () => {
  const raw = { type: 'split', dir: 'row', sizes: [0, -3, 'x'], children: [
    { type: 'group', views: ['git', 'evil', 'git'], active: 'nope' },
    { type: 'group', views: ['git', 'files'] },
    { type: 'group', views: [] } ] };
  const t = L.sanitize(raw);
  check(t);
  assert.equal(shape(t), 'row([git] [files])');
  assert.equal(L.groupOf(t, 'git').active, 'git');
});

test('every operation keeps the invariants (random sequence)', () => {
  let t = L.defaultLayout();
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const ops = ['move', 'hide', 'show', 'split', 'close', 'resize', 'zoom'];
  for (let i = 0; i < 400; i++) {
    const gs = L.groups(t);
    const g = gs[rnd(gs.length)];
    const v = L.VIEWS[rnd(L.VIEWS.length)];
    switch (ops[rnd(ops.length)]) {
      case 'move': t = L.moveView(t, v, g.id, L.ZONES[rnd(L.ZONES.length)], rnd(4)); break;
      case 'hide': t = L.hideView(t, v); break;
      case 'show': t = L.showView(t, v, g.id); break;
      case 'split': t = L.splitGroup(t, g.id, rnd(2) ? 'row' : 'col'); break;
      case 'close': t = L.closeGroup(t, g.id); break;
      case 'resize': if (t.type === 'split') t = L.resize(t, t.id, rnd(t.children.length), (rnd(21) - 10) / 50); break;
      default: t = L.setZoom(t, g.id, rnd(14) - 5);
    }
    check(t);
    assert.deepEqual(L.sanitize(JSON.parse(JSON.stringify(t))) && shape(L.sanitize(JSON.parse(JSON.stringify(t)))), shape(t));
  }
});
