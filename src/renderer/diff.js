'use strict';
// Unified diff -> numbered lines (git diff output, or bare hunks from the GitLab/GitHub API), and the diff view with
// line numbers. Pure parsing is shared with the main process (and unit-tested); render() needs a DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Diff = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  function hunkHeader(line) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    return m ? { old: +m[1], oldCount: m[2] == null ? 1 : +m[2], new: +m[3], newCount: m[4] == null ? 1 : +m[4] } : null;
  }
  /** -> [{ kind: meta|hunk|context|added|removed|note, text, oldLine, newLine }] */
  function parse(text) {
    const out = [];
    let old = 0; let nw = 0; let oldLeft = 0; let newLeft = 0;
    const lines = String(text || '').split('\n');
    lines.forEach((raw, i) => {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (i === lines.length - 1 && line === '') return;
      const h = line.startsWith('@@') ? hunkHeader(line) : null;
      if (h) { old = h.old; nw = h.new; oldLeft = h.oldCount; newLeft = h.newCount; out.push({ kind: 'hunk', text: line }); return; }
      const inHunk = oldLeft > 0 || newLeft > 0;
      if (line.startsWith('\\')) out.push({ kind: 'note', text: line });
      else if (inHunk && line.startsWith('+')) { out.push({ kind: 'added', text: line.slice(1), newLine: nw }); nw++; newLeft--; }
      else if (inHunk && line.startsWith('-')) { out.push({ kind: 'removed', text: line.slice(1), oldLine: old }); old++; oldLeft--; }
      else if (inHunk && (line.startsWith(' ') || line === '')) { out.push({ kind: 'context', text: line.slice(1), oldLine: old, newLine: nw }); old++; nw++; oldLeft--; newLeft--; }
      else { oldLeft = 0; newLeft = 0; out.push({ kind: 'meta', text: line }); }
    });
    return out;
  }
  const counts = (diff) => parse(diff).reduce((a, l) => { if (l.kind === 'added') a.added++; else if (l.kind === 'removed') a.removed++; return a; }, { added: 0, removed: 0 });

  /**
   * A diff table with old/new line numbers. opts.onComment(line) adds a "+" on every commentable line;
   * opts.comments(line) -> nodes shown below that line (threads).
   */
  function render(text, opts = {}) {
    const box = document.createElement('div'); box.className = 'dv';
    const lines = parse(text);
    if (!lines.length) { const e = document.createElement('div'); e.className = 'hint dv-empty'; e.textContent = opts.empty || ''; box.append(e); return box; }
    for (const l of lines) {
      const row = document.createElement('div');
      row.className = `dl ${l.kind}`;
      const a = document.createElement('span'); a.className = 'ln'; a.textContent = l.oldLine ?? '';
      const b = document.createElement('span'); b.className = 'ln'; b.textContent = l.newLine ?? '';
      const sign = document.createElement('span'); sign.className = 'sg'; sign.textContent = l.kind === 'added' ? '+' : l.kind === 'removed' ? '-' : ' ';
      const code = document.createElement('span'); code.className = 'cd'; code.textContent = l.text || ' ';
      row.append(a, b, sign, code);
      if (opts.onComment && (l.kind === 'added' || l.kind === 'removed' || l.kind === 'context')) {
        const plus = document.createElement('button'); plus.className = 'dv-plus'; plus.type = 'button'; plus.textContent = '+'; plus.title = opts.commentTitle || '';
        plus.addEventListener('click', (e) => { e.stopPropagation(); opts.onComment(l, row); });
        row.prepend(plus);
      }
      box.append(row);
      if (opts.comments) for (const n of opts.comments(l) || []) box.append(n);
    }
    return box;
  }
  return { parse, hunkHeader, counts, render };
}));
