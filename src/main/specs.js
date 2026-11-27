'use strict';
// Spec-driven development (like Kiro): requirements -> design -> tasks -> implementation; each document is approved
// before the next one is written. Documents live in the project (.hearth/specs/<slug>/, Kiro's .kiro/specs/ is read
// too), so any agent CLI can write them; Hearth keeps the approvals in spec.json and drives the agent with prompts.
// Also: steering documents, the quality check of the documents and the coverage of acceptance criteria by tasks.
// Ported from SpecWorkflow.swift / SpecAnalysis.swift.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PHASES = ['requirements', 'design', 'tasks'];
const SPECS_DIR = '.hearth/specs';
const KIRO_DIR = '.kiro/specs';
const STEERING_DIR = '.hearth/steering';
const KINDS = ['feature', 'bugfix', 'refactor'];

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const prev = (p) => PHASES[PHASES.indexOf(p) - 1] || null;
const nextPhase = (p) => PHASES[PHASES.indexOf(p) + 1] || null;

/** Hash recorded at approval. Ticked boxes in tasks.md don't count: progress is not a new version of the plan. */
function approvalHash(phase, text) {
  if (phase !== 'tasks') return sha(text);
  return sha(text.split('\n').map((l) => l.replace(/^(\s*[-*+]\s+)\[(x|X)\]/, '$1[ ]')).join('\n'));
}

// ---------- tasks.md ----------
const CHECKBOX = /^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const NUMBER = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/;
const REFS = /^[_*]*Requirements?[_*]*\s*:\s*(.*?)[_*]*$/i;
const strip = (s) => s.replace(/\*\*|__|`/g, '');

function parseTasks(markdown) {
  const tasks = []; let fence = false;
  String(markdown || '').split('\n').forEach((raw, index) => {
    const line = raw.replace(/\r/g, '');
    if (line.trim().startsWith('```')) { fence = !fence; return; }
    if (fence) return;
    const m = CHECKBOX.exec(line);
    if (m) {
      let text = m[3].trim(); let id = `L${index + 1}`;
      const n = NUMBER.exec(text); if (n) { id = n[1]; text = n[2]; }
      tasks.push({ id, title: strip(text), done: m[2] !== ' ', depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2), line: index, details: [], requirements: [] });
      return;
    }
    if (!tasks.length || !(line.startsWith(' ') || line.startsWith('\t'))) return;
    let detail = line.trim().replace(/^[-*+] /, '');
    if (!detail) return;
    const r = REFS.exec(detail);
    const t = tasks[tasks.length - 1];
    if (r) t.requirements.push(...r[1].split(/[,;]/).map((x) => x.replace(/^[\s_*]+|[\s_*]+$/g, '')).filter(Boolean));
    else t.details.push(strip(detail));
  });
  return tasks;
}
function setTaskLine(markdown, line, done) {
  const lines = markdown.split('\n');
  if (line < 0 || line >= lines.length) return markdown;
  const m = CHECKBOX.exec(lines[line].replace(/\r$/, ''));
  if (!m) return markdown;
  lines[line] = lines[line].replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]');
  return lines.join('\n');
}

// ---------- library ----------
function slug(name) {
  const s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('-');
  return s ? s.slice(0, 48) : 'spec';
}
function titleFrom(md) {
  const line = String(md || '').split('\n').find((l) => l.startsWith('# '));
  if (!line) return null;
  let t = line.slice(2).trim();
  for (const p of ['Requirements Document:', 'Requirements:', 'Requirements Document', 'Anforderungen:']) if (t.toLowerCase().startsWith(p.toLowerCase())) t = t.slice(p.length).trim();
  return t || null;
}
function normRecord(r, fallbackName) {
  const o = r && typeof r === 'object' ? r : {};
  return { name: typeof o.name === 'string' && o.name ? o.name : fallbackName, idea: typeof o.idea === 'string' ? o.idea : '', created: typeof o.created === 'string' ? o.created : new Date(0).toISOString(),
    approved: o.approved && typeof o.approved === 'object' ? o.approved : {}, kind: KINDS.includes(o.kind) ? o.kind : 'feature', guided: o.guided !== false,
    checks: o.checks && typeof o.checks === 'object' ? o.checks : {} };
}

function status(spec, phase) {
  const text = spec.documents[phase];
  if (!text || !text.trim()) return 'missing';
  const h = spec.record.approved[phase];
  if (!h) return 'draft';
  return h === approvalHash(phase, text) ? 'approved' : 'changed';
}

function scan(root) {
  const specs = [];
  for (const dir of [SPECS_DIR, KIRO_DIR]) {
    const base = path.join(root, dir);
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const folder = path.join(base, e.name);
      const documents = {};
      for (const p of PHASES) { const t = read(path.join(folder, `${p}.md`)); if (t != null) documents[p] = t; }
      let rec = null; try { rec = JSON.parse(read(path.join(folder, 'spec.json'))); } catch { /* none */ }
      const record = normRecord(rec, titleFrom(documents.requirements) || e.name);
      specs.push(enrich({ id: `${dir}/${e.name}`, rel: `${dir}/${e.name}`, folder, slug: e.name, name: record.name, record, documents }));
    }
  }
  return specs.sort((a, b) => b.record.created.localeCompare(a.record.created) || a.name.localeCompare(b.name));
}

/** Adds what the pane shows: statuses, tasks, current phase, analysis. */
function enrich(spec) {
  spec.status = Object.fromEntries(PHASES.map((p) => [p, status(spec, p)]));
  spec.tasks = parseTasks(spec.documents.tasks);
  spec.currentPhase = PHASES.find((p) => spec.status[p] !== 'approved') || null;
  spec.implementing = spec.currentPhase === null;
  spec.complete = spec.implementing && spec.tasks.length > 0 && spec.tasks.every((t) => t.done);
  spec.canWrite = Object.fromEntries(PHASES.map((p) => [p, !prev(p) || spec.status[prev(p)] === 'approved']));
  const doc = requirements(spec.documents.requirements || '');
  spec.analysis = { requirements: doc.requirements, openQuestions: doc.openQuestions, traces: trace(doc, spec.tasks), findings: findings(spec, doc) };
  spec.checklists = Object.fromEntries(PHASES.map((p) => [p, checklist(p, spec.record.kind)]));
  return spec;
}

function steering(root) {
  try { return fs.readdirSync(path.join(root, STEERING_DIR)).filter((f) => f.endsWith('.md')).sort().map((f) => `${STEERING_DIR}/${f}`); } catch { return []; }
}

function saveRecord(folder, record) { fs.writeFileSync(path.join(folder, 'spec.json'), JSON.stringify(record, null, 2) + '\n'); }

function create(root, { name, idea = '', kind = 'feature', guided = true }) {
  name = String(name || '').trim(); if (!name) throw new Error('The spec needs a name');
  const base = path.join(root, SPECS_DIR); const stem = slug(name);
  let s = stem; let n = 2;
  while (fs.existsSync(path.join(base, s))) s = `${stem}-${n++}`;
  const folder = path.join(base, s);
  fs.mkdirSync(folder, { recursive: true });
  saveRecord(folder, { name, idea: String(idea || ''), created: new Date().toISOString(), approved: {}, kind: KINDS.includes(kind) ? kind : 'feature', guided: guided !== false, checks: {} });
  return scan(root).find((x) => x.folder === folder);
}

/** Finds a spec by id (relative path) - the renderer only ever sends ids. */
function byId(root, id) {
  const spec = scan(root).find((x) => x.id === id);
  if (!spec) throw new Error('Unknown spec');
  return spec;
}
function approve(root, id, phase) {
  const spec = byId(root, id); if (!PHASES.includes(phase) || !spec.documents[phase]) throw new Error('Nothing to approve');
  spec.record.approved[phase] = approvalHash(phase, spec.documents[phase]); saveRecord(spec.folder, spec.record);
}
function revoke(root, id, phase) { const spec = byId(root, id); delete spec.record.approved[phase]; saveRecord(spec.folder, spec.record); }
function update(root, id, change) {
  const spec = byId(root, id); const r = spec.record;
  if (typeof change.guided === 'boolean') r.guided = change.guided;
  if (change.check && PHASES.includes(change.check.phase)) {
    const list = new Set(r.checks[change.check.phase] || []); const i = Number(change.check.index);
    if (Number.isInteger(i) && i >= 0 && i < 20) { if (change.check.on) list.add(i); else list.delete(i); }
    r.checks[change.check.phase] = [...list].sort((a, b) => a - b);
  }
  saveRecord(spec.folder, r);
}
function setTask(root, id, line, done) {
  const spec = byId(root, id); const file = path.join(spec.folder, 'tasks.md');
  const text = read(file); if (text == null) throw new Error('tasks.md is missing');
  const next = setTaskLine(text, Number(line), Boolean(done)); if (next !== text) fs.writeFileSync(file, next);
}

// ---------- analysis ----------
const REQ_HEADING = /^#{2,4}\s+(?:Requirement|Anforderung|Requisito|Exigence)\s+(\d+)\s*[:.–-]?\s*(.*)$/i;
const NUM_HEADING = /^#{3,4}\s+(\d+)[.)]\s+(.+)$/;
const NUM_ITEM = /^\s*(\d+)[.)]\s+(.+)$/;
const ANY_HEADING = /^#{1,6}\s+(.*)$/;
const isEARS = (text) => /\bSHALL\b/.test(text);

function requirements(md) {
  const doc = { requirements: [], openQuestions: [] };
  let current = null; let inQ = false; let fence = false;
  const close = () => { if (current) doc.requirements.push(current); current = null; };
  for (const raw of String(md).split('\n')) {
    const line = raw.replace(/\r/g, '');
    if (line.trim().startsWith('```')) { fence = !fence; continue; }
    if (fence) continue;
    const m = REQ_HEADING.exec(line) || NUM_HEADING.exec(line);
    if (m) { close(); inQ = false; current = { id: m[1], title: m[2].trim(), hasStory: false, criteria: [] }; continue; }
    const h = ANY_HEADING.exec(line);
    if (h) {
      const title = h[1].toLowerCase();
      if (title.includes('open question') || title.includes('offene frage')) { close(); inQ = true; continue; }
      if (line.startsWith('## ') || line.startsWith('# ')) { close(); inQ = false; }
      continue;
    }
    const trimmed = line.trim();
    if (inQ) {
      let q = trimmed; const n = NUM_ITEM.exec(q); if (n) q = n[2];
      q = q.replace(/^[-*+] /, '').replace(/^[\s_*]+|[\s_*]+$/g, '');
      const low = q.toLowerCase();
      if (q && !['none', 'keine', 'n/a', '-', '—', 'none.', 'keine.'].includes(low) && !low.startsWith('none ') && !low.startsWith('keine ')) doc.openQuestions.push(q);
      continue;
    }
    if (!current) continue;
    const lower = trimmed.toLowerCase();
    if (lower.includes('as a ') || lower.includes('as an ') || (lower.includes('als ') && (lower.includes('möchte') || lower.includes('will')))) current.hasStory = true;
    const it = !line.startsWith(' ') && !line.startsWith('\t') ? NUM_ITEM.exec(line) : null;
    if (it) { const text = it[2].replace(/\*\*/g, ''); current.criteria.push({ id: `${current.id}.${it[1]}`, text, ears: isEARS(text) }); }
  }
  close();
  return doc;
}

function trace(doc, tasks) {
  return doc.requirements.flatMap((r) => r.criteria).map((c) => {
    const req = c.id.split('.')[0];
    const covering = tasks.filter((t) => t.requirements.some((x) => x === c.id || x === req));
    const done = covering.filter((t) => t.done).length;
    return { criterion: c, tasks: covering.map((t) => ({ id: t.id, title: t.title, done: t.done })), state: !covering.length ? 'uncovered' : done === covering.length ? 'done' : done ? 'partial' : 'planned' };
  });
}

const DESIGN_TOPICS = [['Overview', ['overview', 'übersicht', 'summary', 'zusammenfassung']], ['Architecture', ['architecture', 'architektur']],
  ['Components and interfaces', ['component', 'komponente', 'interface', 'schnittstelle']], ['Data models', ['data', 'daten', 'model', 'modell']],
  ['Error handling', ['error', 'fehler']], ['Testing strategy', ['test']]];
function missingDesignTopics(md) {
  const heads = String(md).split('\n').filter((l) => l.startsWith('#')).map((l) => l.toLowerCase());
  return DESIGN_TOPICS.filter(([, words]) => !heads.some((h) => words.some((w) => h.includes(w)))).map(([n]) => n);
}
const few = (ids, n = 8) => ids.slice(0, n).join(', ') + (ids.length > n ? ' …' : '');

/** message is English source text with {vars} (translated in the renderer); fix is the prompt for the agent. */
function findings(spec, doc) {
  const out = [];
  const crit = doc.requirements.flatMap((r) => r.criteria);
  if (spec.documents.requirements) {
    if (!doc.requirements.length) out.push({ id: 'req-none', severity: 'issue', phase: 'requirements', message: 'No requirements found (### Requirement N).', fix: 'There are no `### Requirement N` sections; restructure the document accordingly.' });
    const noCrit = doc.requirements.filter((r) => !r.criteria.length).map((r) => r.id);
    if (noCrit.length) out.push({ id: 'req-nocriteria', severity: 'issue', phase: 'requirements', message: 'Requirements without acceptance criteria: {ids}', vars: { ids: noCrit.join(', ') }, fix: `Requirements ${noCrit.join(', ')} have no numbered acceptance criteria; add testable EARS criteria.` });
    const notEars = crit.filter((c) => !c.ears).map((c) => c.id);
    if (notEars.length) out.push({ id: 'req-ears', severity: 'issue', phase: 'requirements', message: 'Not testable (no EARS "SHALL"): {ids}', vars: { ids: few(notEars) }, fix: `Acceptance criteria ${notEars.join(', ')} are not in EARS form; rewrite them as WHEN/IF/WHILE … THEN the system SHALL …` });
    if (spec.record.kind === 'feature') {
      const noStory = doc.requirements.filter((r) => !r.hasStory).map((r) => r.id);
      if (noStory.length && doc.requirements.length) out.push({ id: 'req-story', severity: 'hint', phase: 'requirements', message: 'Without a user story: {ids}', vars: { ids: noStory.join(', ') }, fix: `Requirements ${noStory.join(', ')} lack a user story (As a …, I want …, so that …); add one.` });
    }
    if (doc.openQuestions.length) out.push({ id: 'req-questions', severity: 'issue', phase: 'requirements', message: '{n} open questions: answer them before you approve.', vars: { n: doc.openQuestions.length }, answerQuestions: true });
  }
  const design = spec.documents.design;
  if (design) {
    const missing = missingDesignTopics(design);
    if (missing.length) out.push({ id: 'design-topics', severity: 'hint', phase: 'design', message: 'Not covered: {topics}', vars: { topics: missing }, fix: `The design has no section on: ${missing.join(', ')}. Add them where they apply.` });
    const mentioned = doc.requirements.filter((r) => new RegExp(`(requirement|anforderung|req\\.?|r)\\s*${r.id}\\b`, 'i').test(design) || r.criteria.some((c) => design.includes(c.id)));
    if (doc.requirements.length > 1 && mentioned.length < doc.requirements.length) {
      const left = doc.requirements.filter((r) => !mentioned.includes(r)).map((r) => r.id);
      out.push({ id: 'design-trace', severity: 'hint', phase: 'design', message: 'Requirements the design doesn\'t mention: {ids}', vars: { ids: left.join(', ') }, fix: `The design doesn't say how requirements ${left.join(', ')} are met; add that.` });
    }
  }
  if (spec.documents.tasks && spec.documents.tasks.trim()) {
    const tasks = spec.tasks || parseTasks(spec.documents.tasks);
    if (!tasks.length) out.push({ id: 'tasks-none', severity: 'issue', phase: 'tasks', message: 'No checkbox tasks found (- [ ] 1. …).', fix: 'The task list has no `- [ ] 1. …` checkbox items; rewrite it in that format.' });
    const uncovered = trace(doc, tasks).filter((x) => x.state === 'uncovered').map((x) => x.criterion.id);
    if (uncovered.length) out.push({ id: 'tasks-uncovered', severity: 'issue', phase: 'tasks', message: 'Criteria no task covers: {ids}', vars: { ids: few(uncovered) }, fix: `No task covers acceptance criteria ${uncovered.join(', ')}; add tasks (with _Requirements:_ references) for them.` });
    const known = new Set([...crit.map((c) => c.id), ...doc.requirements.map((r) => r.id)]);
    const unknown = [...new Set(tasks.flatMap((t) => t.requirements))].filter((x) => !known.has(x)).sort();
    if (unknown.length && doc.requirements.length) out.push({ id: 'tasks-unknown', severity: 'issue', phase: 'tasks', message: 'Tasks name criteria that don\'t exist: {ids}', vars: { ids: unknown.join(', ') }, fix: `Tasks reference ${unknown.join(', ')}, which are not in requirements.md; correct the references.` });
    const unlinked = tasks.filter((t) => !t.requirements.length && !tasks.some((o) => o.depth > t.depth && o.id.startsWith(t.id + '.'))).map((t) => t.id);
    if (unlinked.length && doc.requirements.length) out.push({ id: 'tasks-unlinked', severity: 'hint', phase: 'tasks', message: 'Tasks without a requirement: {ids}', vars: { ids: few(unlinked) }, fix: `Tasks ${unlinked.join(', ')} have no \`_Requirements:_\` line; add the criteria they serve.` });
  }
  return out;
}

function checklist(phase, kind) {
  if (phase === 'requirements') {
    if (kind === 'bugfix') return ['Current and expected behaviour are right', 'The steps reproduce the bug', 'A regression criterion protects the fix'];
    if (kind === 'refactor') return ['The goals are the right ones', 'What must not change is stated', 'It says how unchanged behaviour is verified'];
    return ['The stories describe what I actually want', 'Edge cases and errors are covered', 'Every criterion can be tested', 'Nothing is missing and nothing is too much'];
  }
  if (phase === 'design') return ['The approach fits the existing architecture', 'Interfaces and data models make sense', 'Errors and edge cases are handled', 'The testing strategy is enough'];
  return ['Steps are small and in a sensible order', 'Tests are part of the plan', 'Nothing outside the spec sneaks in'];
}

// ---------- prompts (one line each: terminals submit on newline) ----------
const one = (s) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ');
const p = (spec, phase) => `${spec.rel}/${phase}.md`;
function context(spec, steer, lang) {
  let s = `Spec "${spec.name}" lives in \`${spec.rel}/\`.`;
  if (lang === 'de') s += ' Write the spec documents in German (keep the EARS keywords WHEN, IF, WHILE, THEN, SHALL in English).';
  if (steer.length) s += ` Follow the project's steering documents: ${steer.map((x) => `\`${x}\``).join(', ')}.`;
  return s;
}
const idea = (spec) => (spec.record.idea ? spec.record.idea.replace(/\n/g, ' ') : spec.name);
function reqFormat(spec) {
  const criteria = 'numbered acceptance criteria in EARS notation ("WHEN … THEN the system SHALL …", "IF … THEN the system SHALL …", "WHILE … the system SHALL …")';
  if (spec.record.kind === 'bugfix') return `Structure: \`# Requirements: ${spec.name}\`, then \`## Current behaviour\`, \`## Expected behaviour\`, \`## Steps to reproduce\` and \`## Suspected cause\` (from reading the code), then \`### Requirement N\` sections with ${criteria} for the fixed behaviour, including at least one regression criterion ("WHEN … THEN the system SHALL continue to …").`;
  if (spec.record.kind === 'refactor') return `Structure: \`# Requirements: ${spec.name}\`, then \`## Goals\`, \`## Constraints\` and \`## Out of scope\`, then \`### Requirement N\` sections with ${criteria}; state explicitly which behaviour SHALL NOT change and how that is verified.`;
  return `Structure: \`# Requirements: ${spec.name}\`, a short introduction, then \`### Requirement N\` sections, each with a user story ("As a …, I want …, so that …") and ${criteria}. Cover edge cases and errors, keep it implementation-free.`;
}
const prompts = {
  requirements: (spec, steer, lang, { clarify = false } = {}) => one(`We work spec-driven. ${context(spec, steer, lang)} The ${spec.record.kind}: ${idea(spec)} — ${clarify
    ? `Before you write anything, look at the existing code and ask me the questions you need answered (at most 5, numbered, in one message), then wait for my answers. After I answered, write \`${p(spec, 'requirements')}\`.`
    : `Look at the existing code first, then write \`${p(spec, 'requirements')}\`.`} ${reqFormat(spec)} End with a section \`## Open questions\` (empty if there are none). Only write this file, do not write design, tasks or code; then stop so I can review it.`),
  design: (spec, steer, lang) => one(`${context(spec, steer, lang)} The requirements in \`${p(spec, 'requirements')}\` are approved. Read them and the relevant code, then write \`${p(spec, 'design')}\`: overview, architecture (with a Mermaid diagram if it helps), components and interfaces, data models, error handling and testing strategy, and how each requirement is met. Research what you need, but do not change code and do not write tasks; then stop so I can review the design.`),
  tasks: (spec, steer, lang) => one(`${context(spec, steer, lang)} Requirements and design are approved. Write \`${p(spec, 'tasks')}\`: an implementation plan as a Markdown checklist of small, testable coding steps in a sensible order, numbered \`- [ ] 1. …\` with sub-tasks \`  - [ ] 1.1 …\`. Under each task add short bullets with what to do and a line \`_Requirements: 1.1, 2.3_\` naming the acceptance criteria it covers. Every requirement must be covered; include writing tests. Only coding tasks, no deployment or manual steps. Do not change code yet; then stop so I can review the plan.`),
  revise: (spec, steer, lang, { phase, feedback }) => one(`${context(spec, steer, lang)} Please revise \`${p(spec, phase)}\` with this feedback: ${String(feedback).replace(/\n/g, ' ')} — Keep the document's structure${phase === 'tasks' ? ' and the checkbox format' : ''}, and keep the other spec documents consistent if the change affects them. Do not change code; then stop so I can review it again.`),
  fix: (spec, steer, lang, { phase, finding }) => one(`${context(spec, steer, lang)} A check of \`${p(spec, phase)}\` found: ${finding} — Please fix this in the document, keep its structure, and keep the other spec documents consistent. Do not change code; then stop.`),
  questions: (spec, steer, lang) => one(`${context(spec, steer, lang)} \`${p(spec, 'requirements')}\` lists open questions. Ask me them one at a time, wait for each answer, and work the answers into the requirements. Remove each answered question from the list. Do not change code.`),
  run: (spec, steer, lang, { task }) => one(`${context(spec, steer, lang)} Implement task ${task.id} "${task.title}" from \`${p(spec, 'tasks')}\`. First read \`${p(spec, 'requirements')}\`, \`${p(spec, 'design')}\` and the task list. Implement only this task (including its sub-tasks), meet the referenced requirements, add or update tests and run them. When it works, tick the task (and its sub-tasks) in \`${p(spec, 'tasks')}\` with \`[x]\`. Then stop and summarise what you did; do not start the next task.`),
  runAll: (spec, steer, lang) => one(`${context(spec, steer, lang)} Read \`${p(spec, 'requirements')}\`, \`${p(spec, 'design')}\` and \`${p(spec, 'tasks')}\`. Then work through the open tasks one after another in order: implement each, add or update tests, run them, and tick the task with \`[x]\` before you start the next one. If a task is blocked or a requirement is unclear, stop and ask me instead of guessing.`),
  verify: (spec, steer, lang) => one(`${context(spec, steer, lang)} All tasks in \`${p(spec, 'tasks')}\` are ticked. Check the implementation against every acceptance criterion in \`${p(spec, 'requirements')}\`: run the tests, list each criterion as met or not met with a short reason. Fix nothing yet; report the gaps.`),
  steering: () => one(`Create steering documents for this repository in \`${STEERING_DIR}/\`: \`product.md\` (purpose, users, key features), \`tech.md\` (languages, frameworks, tools, build, test and lint commands, constraints) and \`structure.md\` (folder layout, naming and code conventions, where things go). Base them on the actual code and existing docs, keep each short and factual. Do not change code.`),
};

/** The prompt for one action; the renderer names the action and the spec id, never the text sent to the agent. */
function promptFor(root, id, action, opts = {}, lang = 'en') {
  if (action === 'steering') return prompts.steering();
  const spec = byId(root, id); const steer = steering(root);
  const f = prompts[action]; if (!f) throw new Error('Unknown spec action');
  if (action === 'run') { const task = spec.tasks.find((t) => t.line === Number(opts.line)); if (!task) throw new Error('Unknown task'); return f(spec, steer, lang, { task }); }
  if (action === 'fix') { const fd = spec.analysis.findings.find((x) => x.id === opts.finding); if (!fd || !fd.fix) throw new Error('Unknown finding'); return f(spec, steer, lang, { phase: fd.phase, finding: fd.fix }); }
  if (action === 'revise') { if (!PHASES.includes(opts.phase)) throw new Error('Unknown phase'); return f(spec, steer, lang, { phase: opts.phase, feedback: String(opts.feedback || '').slice(0, 4000) }); }
  return f(spec, steer, lang, { clarify: Boolean(opts.clarify) });
}

module.exports = { PHASES, SPECS_DIR, KIRO_DIR, STEERING_DIR, KINDS, approvalHash, parseTasks, setTaskLine, slug, scan, steering, create, byId, approve, revoke, update, setTask, requirements, trace, findings, missingDesignTopics, checklist, prompts, promptFor, status, nextPhase };
