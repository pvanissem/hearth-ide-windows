'use strict';
// Architecture: Mermaid diagrams found in the project (Markdown fences and .mmd files).
const fs = require('node:fs');
const path = require('node:path');

const SKIP = new Set(['.git', 'node_modules', '.gradle', 'target', 'dist', 'build', '.idea', 'vendor', '.venv']);
const MAX_FILES = 300;
const MAX_BYTES = 512 * 1024;

/** Mermaid blocks of a Markdown text, each with its nearest heading as title. */
function blocksOf(markdown) {
  const blocks = [];
  let heading = '';
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,6}\s+(.*)$/.exec(lines[i]);
    if (h) heading = h[1].trim();
    if (/^\s*(```|~~~)\s*mermaid\b/i.test(lines[i])) {
      const fence = lines[i].trim().slice(0, 3);
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence); i++) body.push(lines[i]);
      if (body.join('').trim()) blocks.push({ title: heading, code: body.join('\n') });
    }
  }
  return blocks;
}

function scan(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 6 || out.length >= MAX_FILES) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, depth + 1); continue; }
      if (!/\.(md|markdown|mmd|mermaid)$/i.test(e.name)) continue;
      try {
        if (fs.statSync(p).size > MAX_BYTES) continue;
        const text = fs.readFileSync(p, 'utf8');
        const blocks = /\.(mmd|mermaid)$/i.test(e.name) ? [{ title: e.name, code: text }] : blocksOf(text);
        if (blocks.length) out.push({ file: p, rel: path.relative(root, p).replace(/\\/g, '/'), blocks });
      } catch { /* skip */ }
    }
  };
  walk(root, 0);
  return out;
}

module.exports = { scan, blocksOf };
