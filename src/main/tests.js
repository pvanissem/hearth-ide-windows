'use strict';
// Test results: JUnit XML reports (Maven surefire/failsafe, Gradle, Jest/Vitest jest-junit, pytest --junitxml, Go via gotestsum, ...).
// Ported in spirit from TestReports.swift.
const fs = require('node:fs');
const path = require('node:path');

const SKIP = new Set(['node_modules', '.git', '.gradle', '.idea', 'vendor', '.venv']);
const REPORT_DIRS = [/surefire-reports$/, /failsafe-reports$/, /test-results(\/[^/]+)?$/, /junit$/, /reports\/tests$/];
const MAX_FILES = 400;
const MAX_BYTES = 8 * 1024 * 1024;

const unescape = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? unescape(m[1]) : ''; };

/** Parse one JUnit XML document into test cases. */
function parseJUnit(xml, file = '') {
  const cases = [];
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const head = m[1]; const body = m[2] || '';
    let status = 'passed'; let message = '';
    const fail = /<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body);
    if (fail) { status = 'failed'; message = unescape(attr(fail[2], 'message') || (fail[3] || '')).replace(/<!\[CDATA\[|\]\]>/g, '').trim().slice(0, 1200); }
    else if (/<skipped\b/.test(body)) status = 'skipped';
    cases.push({ suite: attr(head, 'classname') || path.basename(file, '.xml'), name: attr(head, 'name'), time: Number(attr(head, 'time')) || 0, status, message, file });
  }
  return cases;
}

function findReports(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 6 || out.length >= MAX_FILES) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const relDir = path.relative(root, dir).replace(/\\/g, '/');
    const inReportDir = REPORT_DIRS.some((r) => r.test(relDir));
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, depth + 1); }
      else if (e.name.endsWith('.xml') && (inReportDir || /^(junit|test-results?|TEST-.*)\.xml$/i.test(e.name))) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

function load(root) {
  let total = 0;
  const cases = [];
  for (const f of findReports(root)) {
    try {
      const st = fs.statSync(f); total += st.size; if (total > MAX_BYTES) break;
      const xml = fs.readFileSync(f, 'utf8');
      if (!xml.includes('<testcase')) continue;
      cases.push(...parseJUnit(xml, f));
    } catch { /* skip unreadable report */ }
  }
  const summary = { total: cases.length, passed: cases.filter((c) => c.status === 'passed').length, failed: cases.filter((c) => c.status === 'failed').length, skipped: cases.filter((c) => c.status === 'skipped').length };
  return { summary, cases };
}

module.exports = { parseJUnit, findReports, load };
