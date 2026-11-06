'use strict';
// Pane layout as a tree of splits and tab groups (pure data, no DOM: unit-tested in Node).
//   split: { type:'split', dir:'row'|'col', id, children:[...], sizes:[fractions] }
//   group: { type:'group', id, views:[name...], active:name|null, zoom:int, keep?:true }   (keep: an empty chooser pane)
// A view (sessions, agent, editor, files, git, ...) is in at most one group; views in no group are hidden.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LayoutModel = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const VIEWS = ['sessions', 'agent', 'editor', 'files', 'git', 'overview', 'tests', 'arch', 'build', 'ci'];
  const MIN = 0.05;
  const ZONES = ['center', 'left', 'right', 'top', 'bottom'];
  let seq = 0;
  const uid = (p) => `${p}${++seq}`;

  const group = (views = [], extra = {}) => ({ type: 'group', id: uid('g'), views: [...views], active: views[0] || null, zoom: 0, ...extra });
  const split = (dir, children, sizes) => ({ type: 'split', dir, id: uid('s'), children, sizes: sizes || children.map(() => 1 / children.length) });
  const clone = (t) => JSON.parse(JSON.stringify(t));

  function defaultLayout() {
    return split('row', [
      group(['sessions']),
      group(['agent', 'editor']),
      group(['files', 'git', 'overview', 'tests', 'arch', 'build', 'ci']),
    ], [0.16, 0.5, 0.34]);
  }

  function walk(node, fn, parent = null) {
    fn(node, parent);
    if (node.type === 'split') for (const c of node.children) walk(c, fn, node);
  }
  const groups = (tree) => { const out = []; walk(tree, (n) => { if (n.type === 'group') out.push(n); }); return out; };
  const findById = (tree, id) => { let hit = null; walk(tree, (n) => { if (n.id === id) hit = n; }); return hit; };
  const groupOf = (tree, view) => groups(tree).find((g) => g.views.includes(view)) || null;
  const parentOf = (tree, node) => { let p = null; walk(tree, (n, par) => { if (n === node) p = par; }); return p; };
  const hiddenViews = (tree) => VIEWS.filter((v) => !groupOf(tree, v));

  function normSizes(sizes) {
    const sum = sizes.reduce((a, b) => a + b, 0);
    let out = sum > 0 ? sizes.map((s) => Math.max(MIN, s / sum)) : sizes.map(() => 1 / sizes.length);
    const total = out.reduce((a, b) => a + b, 0);
    out = out.map((s) => s / total);
    return out;
  }

  /** Remove empty groups, unwrap splits with one child, merge nested splits of the same direction, fix sizes. */
  function normalize(tree) {
    const prune = (n) => {
      if (n.type === 'group') {
        if (n.active && !n.views.includes(n.active)) n.active = n.views[0] || null;
        if (!n.active && n.views.length) n.active = n.views[0];
        return n.views.length || n.keep ? n : null;
      }
      const kids = []; const sizes = [];
      n.children.forEach((c, i) => { const r = prune(c); if (r) { kids.push(r); sizes.push(n.sizes[i]); } });
      if (!kids.length) return null;
      if (kids.length === 1) return kids[0];
      const fk = []; const fs = [];
      kids.forEach((k, i) => {
        if (k.type === 'split' && k.dir === n.dir) k.children.forEach((c, j) => { fk.push(c); fs.push(sizes[i] * k.sizes[j]); });
        else { fk.push(k); fs.push(sizes[i]); }
      });
      n.children = fk; n.sizes = normSizes(fs);
      return n;
    };
    return prune(tree) || group([], { keep: true });
  }

  const removeFromGroup = (g, view) => { g.views = g.views.filter((v) => v !== view); if (g.active === view) g.active = g.views[0] || null; };

  function replaceNode(tree, target, replacement) {
    if (tree === target) return replacement;
    const parent = parentOf(tree, target);          // look the parent up first: walking while replacing would descend into the replacement
    if (parent) parent.children[parent.children.indexOf(target)] = replacement;
    return tree;
  }

  /** Hide a view (it stays available in the "+" menu and in Search Everywhere). */
  function hideView(tree, view) {
    const t = clone(tree);
    const g = groupOf(t, view);
    if (g) removeFromGroup(g, view);
    return normalize(t);
  }

  /** Make a view visible and active: where it already is, else in `groupId`, else next to its usual neighbours, else the first group. */
  function showView(tree, view, groupId) {
    if (!VIEWS.includes(view)) return tree;
    const t = clone(tree);
    let g = groupOf(t, view);
    if (!g) {
      g = (groupId && findById(t, groupId)) || null;
      if (!g || g.type !== 'group') {
        const friends = { files: 'git', git: 'files', overview: 'git', tests: 'git', arch: 'git', build: 'git', ci: 'git', editor: 'agent', agent: 'editor', sessions: 'agent' };
        g = groupOf(t, friends[view]) || groups(t)[0];
      }
      g.views.push(view); delete g.keep;
    }
    g.active = view;
    return normalize(t);
  }

  /**
   * Move a view into a group (zone 'center', optionally at `index`) or next to it (zone left/right/top/bottom: a new pane).
   * Dropping a group's only view on its own edge changes nothing.
   */
  function moveView(tree, view, targetId, zone = 'center', index) {
    if (!VIEWS.includes(view) || !ZONES.includes(zone)) return tree;
    const t = clone(tree);
    let target = findById(t, targetId);
    if (!target || target.type !== 'group') return tree;
    const src = groupOf(t, view);

    if (zone === 'center') {
      if (src === target) {
        const from = target.views.indexOf(view);
        const to = Math.max(0, Math.min(index == null ? target.views.length - 1 : index, target.views.length - 1));
        target.views.splice(from, 1); target.views.splice(to, 0, view);
      } else {
        if (src) removeFromGroup(src, view);
        const at = index == null ? target.views.length : Math.max(0, Math.min(index, target.views.length));
        target.views.splice(at, 0, view); delete target.keep;
      }
      target.active = view;
      return normalize(t);
    }

    if (src === target && target.views.length === 1) return tree;
    if (src) removeFromGroup(src, view);
    const dir = zone === 'left' || zone === 'right' ? 'row' : 'col';
    const before = zone === 'left' || zone === 'top';
    const fresh = group([view]);
    const parent = parentOf(t, target);
    let result = t;
    if (parent && parent.dir === dir) {
      const i = parent.children.indexOf(target);
      const half = parent.sizes[i] / 2;
      parent.sizes[i] = half;
      const at = before ? i : i + 1;
      parent.children.splice(at, 0, fresh); parent.sizes.splice(at, 0, half);
    } else {
      result = replaceNode(t, target, split(dir, before ? [fresh, target] : [target, fresh], [0.5, 0.5]));
    }
    return normalize(result);
  }

  /** A new, empty pane next to a group (it shows a chooser until a view is put in). */
  function splitGroup(tree, groupId, dir) {
    const t = clone(tree);
    const target = findById(t, groupId);
    if (!target || target.type !== 'group') return tree;
    const fresh = group([], { keep: true });
    const parent = parentOf(t, target);
    let result = t;
    if (parent && parent.dir === dir) {
      const i = parent.children.indexOf(target);
      const half = parent.sizes[i] / 2;
      parent.sizes[i] = half; parent.children.splice(i + 1, 0, fresh); parent.sizes.splice(i + 1, 0, half);
    } else result = replaceNode(t, target, split(dir, [target, fresh], [0.5, 0.5]));
    return normalize(result);
  }

  /** Close a pane: its views become hidden. The last pane stays (empty, with the chooser). */
  function closeGroup(tree, groupId) {
    const t = clone(tree);
    const g = findById(t, groupId);
    if (!g || g.type !== 'group') return tree;
    g.views = []; g.active = null; g.keep = false;
    return normalize(t);
  }

  /** Move the divider after child `index` of a split by `delta` (fraction of the split). */
  function resize(tree, splitId, index, delta) {
    const t = clone(tree);
    const s = findById(t, splitId);
    if (!s || s.type !== 'split' || index < 0 || index >= s.children.length - 1) return tree;
    const pair = s.sizes[index] + s.sizes[index + 1];
    const a = Math.max(MIN, Math.min(pair - MIN, s.sizes[index] + delta));
    s.sizes[index] = a; s.sizes[index + 1] = pair - a;
    return t;
  }

  const setZoom = (tree, groupId, zoom) => { const t = clone(tree); const g = findById(t, groupId); if (g && g.type === 'group') g.zoom = Math.max(-4, Math.min(8, Math.round(zoom))); return t; };

  /** Validate a stored layout; anything odd falls back to null (the caller then uses the default). */
  function sanitize(raw) {
    const seen = new Set();
    const fix = (n) => {
      if (!n || typeof n !== 'object') return null;
      if (n.type === 'group') {
        const views = (Array.isArray(n.views) ? n.views : []).filter((v) => VIEWS.includes(v) && !seen.has(v) && seen.add(v));
        return { type: 'group', id: uid('g'), views, active: views.includes(n.active) ? n.active : views[0] || null, zoom: Number.isInteger(n.zoom) ? Math.max(-4, Math.min(8, n.zoom)) : 0, ...(n.keep && !views.length ? { keep: true } : {}) };
      }
      if (n.type === 'split' && (n.dir === 'row' || n.dir === 'col') && Array.isArray(n.children) && n.children.length) {
        const kids = n.children.map(fix).filter(Boolean);
        if (!kids.length) return null;
        const sizes = kids.map((_, i) => (typeof n.sizes?.[i] === 'number' && n.sizes[i] > 0 ? n.sizes[i] : 1));
        return { type: 'split', dir: n.dir, id: uid('s'), children: kids, sizes: normSizes(sizes) };
      }
      return null;
    };
    const fixed = fix(raw);
    return fixed ? normalize(fixed) : null;
  }

  return { VIEWS, ZONES, defaultLayout, normalize, hideView, showView, moveView, splitGroup, closeGroup, resize, setZoom, sanitize, groups, findById, groupOf, parentOf, hiddenViews, clone };
}));
