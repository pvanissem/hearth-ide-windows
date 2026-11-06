'use strict';
// "Search Everywhere": files, text, symbols and usages. Ported from SearchEverywhere.swift / UsageFinder.swift.
// Fuzzy file match works on word starts ("mlv" finds MainLayoutView).
const fs = require('node:fs');
const path = require('node:path');

const SKIP = new Set(['.git', 'node_modules', '.gradle', 'target', 'dist', 'build', '.idea', '.venv', '__pycache__', 'vendor', 'out', '.next', 'coverage']);
const MAX_FILES = 20000;
const MAX_TEXT_BYTES = 1024 * 1024;
const BINARY_EXT = /\.(png|jpe?g|gif|ico|bmp|webp|pdf|zip|gz|7z|jar|class|exe|dll|so|dylib|woff2?|ttf|otf|mp[34]|mov|avi|bin|lock|wasm|icns|psd)$/i;

function listFiles(root, limit = MAX_FILES) {
  const out = [];
  const walk = (dir) => {
    if (out.length >= limit) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); } else if (e.isFile()) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Words of a name: camelCase humps and separators. */
function words(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
}

/** Score of query against a file path (higher is better, 0 = no match). */
function fuzzyScore(query, relPath) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const base = path.basename(relPath);
  const lowBase = base.toLowerCase();
  const lowPath = relPath.toLowerCase().replace(/\\/g, '/');
  if (lowBase === q) return 1000;
  if (lowBase.startsWith(q)) return 800 - lowBase.length;
  if (lowBase.includes(q)) return 600 - lowBase.indexOf(q);
  const ws = words(base.replace(/\.[^.]+$/, ''));
  // initials: every query char starts a (consecutive) word, e.g. mlv -> Main Layout View
  const initials = ws.map((w) => w[0]).join('');
  if (initials.startsWith(q)) return 500 - ws.length;
  if (initials.includes(q)) return 400 - initials.indexOf(q);
  // word-prefix chain: "mainlay" -> main + lay
  let i = 0;
  for (const w of ws) { let j = 0; while (i < q.length && j < w.length && q[i] === w[j]) { i++; j++; } if (j === 0 && i < q.length) break; }
  if (i === q.length) return 350;
  if (lowPath.includes(q)) return 250 - Math.min(100, lowPath.indexOf(q));
  // subsequence over the whole path
  let k = 0;
  for (const ch of lowPath) if (ch === q[k]) k++;
  return k === q.length && q.length >= 3 ? 100 - Math.min(80, lowPath.length / 4) : 0;
}

function searchFiles(root, query, files = listFiles(root), limit = 60) {
  return files.map((f) => ({ file: f, rel: path.relative(root, f).replace(/\\/g, '/') }))
    .map((x) => ({ ...x, score: fuzzyScore(query, x.rel) })).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.rel.length - b.rel.length).slice(0, limit);
}

function readText(file) {
  try {
    if (BINARY_EXT.test(file)) return null;
    const st = fs.statSync(file); if (st.size > MAX_TEXT_BYTES) return null;
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return null;
    return buf.toString('utf8');
  } catch { return null; }
}

function searchText(root, query, { files = listFiles(root), limit = 200, regex = false } = {}) {
  const needle = query.toLowerCase();
  if (!needle) return [];
  let re = null;
  if (regex) { try { re = new RegExp(query, 'i'); } catch { return []; } }
  const out = [];
  for (const f of files) {
    if (out.length >= limit) break;
    const text = readText(f); if (text == null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      const hit = re ? re.test(lines[i]) : lines[i].toLowerCase().includes(needle);
      if (hit) out.push({ file: f, rel: path.relative(root, f).replace(/\\/g, '/'), line: i + 1, text: lines[i].trim().slice(0, 200) });
    }
  }
  return out;
}

const SYMBOL_RES = [
  [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:public\s+|private\s+|protected\s+|internal\s+|final\s+|sealed\s+|static\s+|open\s+|data\s+)*(class|interface|enum|struct|trait|object|record|protocol|namespace|type)\s+([A-Za-z_$][\w$]*)/, 'type'],
  [/^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
  [/^\s*(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][\w]*)/, 'function'],
  [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/, 'function'],
  [/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/, 'function'],
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, 'function'],
  [/^\s*(?:public|private|protected|internal|static|final|override|suspend|abstract|synchronized|\s)+[\w<>\[\],.? ]+\s+([A-Za-z_$][\w$]*)\s*\([^;{]*\)\s*(?:throws [\w., ]+)?\s*\{?\s*$/, 'method'],
];

function symbolsOf(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 300) continue;
    for (const [re, kind] of SYMBOL_RES) {
      const m = re.exec(l);
      if (!m) continue;
      const name = m[2] && kind === 'type' ? m[2] : m[1];
      if (name && !['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'new'].includes(name)) out.push({ name, kind, line: i + 1, indent: l.match(/^\s*/)[0].length });
      break;
    }
  }
  return out;
}

function searchSymbols(root, query, files = listFiles(root), limit = 60) {
  const q = query.toLowerCase(); if (!q) return [];
  const out = [];
  for (const f of files) {
    if (!/\.(js|jsx|ts|tsx|mjs|java|kt|go|rs|py|swift|cs|c|h|cpp|hpp|php|rb|scala|dart)$/i.test(f)) continue;
    const text = readText(f); if (text == null) continue;
    for (const s of symbolsOf(text)) {
      const n = s.name.toLowerCase();
      const score = n === q ? 1000 : n.startsWith(q) ? 700 : n.includes(q) ? 500 : words(s.name).map((w) => w[0]).join('').startsWith(q) ? 400 : 0;
      if (score) out.push({ ...s, file: f, rel: path.relative(root, f).replace(/\\/g, '/'), score });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.name.length - b.name.length).slice(0, limit);
}

const LANG_GROUPS = [['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'], ['java', 'kt', 'scala', 'groovy'], ['c', 'h', 'cpp', 'hpp', 'cc'], ['py'], ['go'], ['rs'], ['swift'], ['cs'], ['rb'], ['php']];
const extOf = (f) => path.extname(f).slice(1).toLowerCase();
const sameLanguage = (a, b) => { const x = extOf(a); const y = extOf(b); return x === y || LANG_GROUPS.some((g) => g.includes(x) && g.includes(y)); };

function classify(line) {
  const t = line.trim();
  if (/^(\/\/|#|\*|\/\*|--|<!--)/.test(t)) return 'comment';
  if (/^(import|from|using|require|use|#include|package)\b/.test(t) || /\brequire\(/.test(t)) return 'import';
  return 'code';
}

/**
 * Find Usages: whole-word hits of `word` with the enclosing class/function ("who uses it").
 * No compiler: a same-named other symbol shows up too (like the macOS app).
 */
function findUsages(root, word, { file, allLanguages = false, files = listFiles(root), overrides = {}, limit = 500 } = {}) {
  if (!/^[A-Za-z_$][\w$]*$/.test(word || '')) return [];
  const re = new RegExp(`(?<![\\w$])${word.replace(/\$/g, '\\$')}(?![\\w$])`);
  const out = [];
  for (const f of files) {
    if (out.length >= limit) break;
    if (!allLanguages && file && !sameLanguage(f, file)) continue;
    const text = overrides[f] != null ? overrides[f] : readText(f);
    if (text == null || !re.test(text)) continue;
    const lines = text.split(/\r?\n/);
    const syms = symbolsOf(text);
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      if (!re.test(lines[i])) continue;
      const defs = syms.find((s) => s.line === i + 1 && s.name === word);
      let container = null;
      for (let k = syms.length - 1; k >= 0; k--) { if (syms[k].line <= i + 1 && syms[k].name !== word) { container = syms[k].name; break; } }
      out.push({ file: f, rel: path.relative(root, f).replace(/\\/g, '/'), line: i + 1, text: lines[i].trim().slice(0, 200), container, kind: defs ? 'definition' : classify(lines[i]) });
    }
  }
  return out;
}

module.exports = { listFiles, fuzzyScore, searchFiles, searchText, searchSymbols, symbolsOf, findUsages, words, readText };
