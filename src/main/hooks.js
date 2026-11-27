'use strict';
// Agent hooks (like Kiro): automations that react to what an agent did. When a turn of an agent ends, Hearth looks at
// the files it saved, created or deleted (and at hooks for the end of the turn) and then sends the hook's prompt to
// that agent or runs its command in the sandbox; a failing command hands its output to the agent.
// Format: Kiro's `{"version":"v1","hooks":[...]}` in .hearth/hooks/*.json; .kiro/hooks/ (also *.kiro.hook) is read too.
// Loops are impossible: a turn a hook started never triggers hooks. Hook files come from the repository (and the agent
// can write them), so a file only runs after the user allowed exactly that content (trust by SHA-256, stored outside
// the project). Ported from AgentHooks.swift.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const specs = require('./specs');

const HEARTH_DIR = '.hearth/hooks';
const KIRO_DIR = '.kiro/hooks';
const TRIGGERS = ['FileSave', 'FileCreate', 'FileDelete', 'Stop', 'Manual'];
const SETTLE_MS = 1500;
const IGNORED = new Set(['.git', 'node_modules', '.gradle', 'target', 'dist', 'build', '.idea', '.venv', '__pycache__']);

function normTrigger(raw) {
  const v = String(raw || '').toLowerCase();
  if (['filesave', 'postfilesave', 'fileedited', 'filesaved'].includes(v)) return 'FileSave';
  if (['filecreate', 'filecreated'].includes(v)) return 'FileCreate';
  if (['filedelete', 'filedeleted'].includes(v)) return 'FileDelete';
  if (['stop', 'agentstop'].includes(v)) return 'Stop';
  if (['manual', 'usertriggered'].includes(v)) return 'Manual';
  return null;
}
const isFileTrigger = (t) => t === 'FileSave' || t === 'FileCreate' || t === 'FileDelete';

/** `src/**\/*.ts` -> regex; a pattern without / matches the file name anywhere. */
function globToRegex(glob) {
  let re = ''; const c = [...glob];
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (ch === '*') {
      if (c[i + 1] === '*') { if (c[i + 2] === '/') { re += '(.*/)?'; i += 2; continue; } re += '.*'; i++; continue; }
      re += '[^/]*';
    } else if (ch === '?') re += '[^/]'; else if (ch === '{') re += '('; else if (ch === '}') re += ')'; else if (ch === ',') re += '|';
    else re += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return (glob.includes('/') ? '^' : '(^|/)') + re + '$';
}

function hookFrom(h, file, index) {
  const raw = typeof h.trigger === 'string' ? h.trigger : '';
  const a = h.action && typeof h.action === 'object' ? h.action : {};
  const type = String(a.type || 'agent').toLowerCase();
  let action;
  if ((type === 'agent' || type === 'askagent') && typeof a.prompt === 'string') action = { type: 'agent', prompt: a.prompt };
  else if ((type === 'command' || type === 'runcommand') && typeof a.command === 'string') action = { type: 'command', command: a.command, timeout: Number.isInteger(a.timeout) ? a.timeout : Number.isInteger(h.timeout) ? h.timeout : null };
  else action = { type: 'unsupported', name: type };
  const trigger = normTrigger(raw);
  return { id: `${file}#${index}`, file, index, name: typeof h.name === 'string' ? h.name : `Hook ${index + 1}`, description: typeof h.description === 'string' ? h.description : null,
    enabled: h.enabled !== false, trigger, rawTrigger: raw, matcher: typeof h.matcher === 'string' ? h.matcher : null, action, supported: Boolean(trigger) && action.type !== 'unsupported' };
}
function legacyHook(j, file) {
  const when = j.when || {}; const then = j.then || {};
  const patterns = Array.isArray(when.patterns) ? when.patterns.filter((x) => typeof x === 'string') : [];
  const action = typeof then.prompt === 'string' ? { type: 'agent', prompt: then.prompt } : typeof then.command === 'string' ? { type: 'command', command: then.command, timeout: null } : { type: 'unsupported', name: String(then.type || '') };
  const trigger = normTrigger(when.type);
  return { id: `${file}#0`, file, index: 0, name: typeof j.name === 'string' ? j.name : file, description: typeof j.description === 'string' ? j.description : null, enabled: j.enabled !== false,
    trigger, rawTrigger: String(when.type || ''), matcher: patterns.length ? patterns.map(globToRegex).join('|') : null, action, supported: Boolean(trigger) && action.type !== 'unsupported' };
}
function parse(text, file) {
  const j = JSON.parse(text);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('Not a JSON object');
  if (Array.isArray(j.hooks)) return j.hooks.map((h, i) => hookFrom(h && typeof h === 'object' ? h : {}, file, i));
  if (j.when && j.then) return [legacyHook(j, file)];
  throw new Error('No "hooks" list found');
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function load(root) {
  const set = { hooks: [], problems: [], hashes: {} };
  for (const dir of [HEARTH_DIR, KIRO_DIR]) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith('.json') || n.endsWith('.kiro.hook')).sort(); } catch { continue; }
    for (const name of names) {
      const rel = `${dir}/${name}`;
      let buf; try { buf = fs.readFileSync(path.join(root, dir, name)); } catch { continue; }
      if (buf.length > 256 * 1024) { set.problems.push({ file: rel, message: 'File too large' }); continue; }
      set.hashes[rel] = sha(buf);
      try { set.hooks.push(...parse(buf.toString('utf8'), rel)); } catch (e) { set.problems.push({ file: rel, message: e.message }); }
    }
  }
  return set;
}

function matches(hook, rel) {
  if (!hook.matcher) return true;
  try { return new RegExp(hook.matcher).test(rel); } catch { return false; }
}

// ---------- writing (Hearth's own files; Kiro files are changed in place) ----------
const writeJSON = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
function create(root, { name, description, trigger, matcher, action }) {
  if (!TRIGGERS.includes(trigger)) throw new Error('Unknown trigger');
  name = String(name || '').trim(); if (!name) throw new Error('The hook needs a name');
  const base = path.join(root, HEARTH_DIR); fs.mkdirSync(base, { recursive: true });
  const stem = specs.slug(name); let s = stem; let n = 2;
  while (fs.existsSync(path.join(base, `${s}.json`))) s = `${stem}-${n++}`;
  const hook = { name, trigger, enabled: true };
  if (description) hook.description = String(description);
  if (matcher && isFileTrigger(trigger)) { try { new RegExp(matcher); } catch { throw new Error('The path pattern is not a valid regular expression'); } hook.matcher = String(matcher); }
  if (action?.type === 'agent' && String(action.prompt || '').trim()) hook.action = { type: 'agent', prompt: String(action.prompt) };
  else if (action?.type === 'command' && String(action.command || '').trim()) hook.action = { type: 'command', command: String(action.command), ...(Number.isInteger(action.timeout) ? { timeout: action.timeout } : {}) };
  else throw new Error('The hook needs a prompt or a command');
  const rel = `${HEARTH_DIR}/${s}.json`;
  writeJSON(path.join(root, rel), { version: 'v1', hooks: [hook] });
  return rel;
}
function edit(root, hook, change) {
  const file = path.join(root, hook.file);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(j.hooks)) {
    if (!j.hooks[hook.index]) return;
    change(j.hooks);
    if (!j.hooks.length) { fs.unlinkSync(file); return; }
    writeJSON(file, j);
  } else { const list = [j]; change(list); if (!list.length) fs.unlinkSync(file); else writeJSON(file, list[0]); }
}
const setEnabled = (root, hook, on) => edit(root, hook, (l) => { l[hook.index].enabled = Boolean(on); });
const remove = (root, hook) => edit(root, hook, (l) => { l.splice(hook.index, 1); });

// ---------- trust ----------
class Trust {
  constructor(file) { this.file = file; }
  #map() { try { const v = JSON.parse(fs.readFileSync(this.file, 'utf8')); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
  #save(m) { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(m, null, 1)); } catch { /* not critical */ } }
  static key(root, file) { return path.resolve(root, file).toLowerCase(); }
  isTrusted(root, file, hash) { return Boolean(hash) && this.#map()[Trust.key(root, file)] === hash; }
  trust(root, file, hash) { const m = this.#map(); m[Trust.key(root, file)] = hash; this.#save(m); }
  revoke(root, file) { const m = this.#map(); delete m[Trust.key(root, file)]; this.#save(m); }
}

// ---------- templates ----------
const TEMPLATES = {
  blank: { title: 'Empty hook', trigger: 'FileSave', matcher: '', body: '' },
  tests: { title: 'Keep tests up to date', trigger: 'FileSave', matcher: '\\.(swift|ts|tsx|js|py|go|kt|java|rs|cs)$', body: 'Check whether the tests still cover the changed behaviour of these files. Update or add tests and run them. Do not change the production code.' },
  docs: { title: 'Keep the documentation in sync', trigger: 'FileSave', matcher: '^(src|Sources|lib)/', body: 'Check whether these changes affect documented behaviour (README, docs/). If so, update the documentation briefly; otherwise do nothing.' },
  translations: { title: 'Complete translations', trigger: 'FileSave', matcher: '(\\.strings|\\.xcstrings|locales/.*\\.json|\\.po|i18n.*\\.js)$', body: 'Make sure every language has the same keys as the changed translation files. Add missing translations and keep placeholders intact.' },
  review: { title: 'Review each turn', trigger: 'Stop', matcher: '', body: 'Review your last turn (git diff): look for bugs, missing tests, leftover debug output and unhandled errors. Fix what you find and say briefly what you changed, or that everything is fine.' },
  specSync: { title: 'Keep spec documents consistent', trigger: 'FileSave', matcher: '^\\.hearth/specs/[^/]+/requirements\\.md$', body: 'These requirements changed. Check design.md and tasks.md of the same spec and update them so they still match; list what you changed.' },
  lint: { title: 'Run the linter (command)', trigger: 'FileSave', matcher: '\\.(ts|tsx|js)$', body: 'npx eslint --fix .', command: true },
};

// ---------- prompts ----------
const oneLine = (s) => String(s).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ');
function prompt(hook, files, base) {
  let s = `[Hook "${hook.name}"] ${base}`;
  if (files.length) s += ` — Files: ${files.slice(0, 20).map((f) => `\`${f}\``).join(', ')}${files.length > 20 ? ` (+${files.length - 20})` : ''}`;
  return oneLine(s);
}
const failurePrompt = (hook, command, result) => oneLine(`[Hook "${hook.name}"] \`${command}\` failed after your last changes (exit ${result.code == null ? 'timeout' : result.code}). Output: ${String(result.output).slice(-1500)} — Please fix the cause.`);

// ---------- engine ----------
/**
 * deps: runs() -> [{ id, directory, status, running, selected }], send(runID, prompt), runCommand(root, command, timeout) -> Promise<{code, output}>,
 *       trust: Trust, watch(root, onChange(rel, kind)) -> { close() } (optional, for tests), now()
 */
class Engine {
  constructor(deps) {
    this.deps = { now: () => Date.now(), ...deps };
    this.sets = new Map(); this.activity = []; this.turns = new Map(); this.last = new Map(); this.hookStarted = new Map(); this.queue = []; this.watchers = new Map(); this.seq = 0;
    this.onChange = () => {};
  }
  hooks(root) { if (!this.sets.has(root)) this.sets.set(root, load(root)); return this.sets.get(root); }
  reload(root) { this.sets.set(root, load(root)); this.onChange(); }
  isTrusted(root, hook) { return this.deps.trust.isTrusted(root, hook.file, this.hooks(root).hashes[hook.file]); }
  allow(root, file) { this.reload(root); const h = this.hooks(root).hashes[file]; if (h) this.deps.trust.trust(root, file, h); this.onChange(); }
  disallow(root, file) { this.deps.trust.revoke(root, file); this.onChange(); }
  /** After Hearth itself wrote a hook file: keep it allowed when it was (or when it is new from Hearth). */
  wrote(root, file, keep) { this.reload(root); const h = this.hooks(root).hashes[file]; if (keep && h) this.deps.trust.trust(root, file, h); this.onChange(); }
  active(root) { return this.hooks(root).hooks.filter((h) => h.enabled && h.supported && this.isTrusted(root, h)); }

  static ignored(rel) { return rel.split('/').some((p) => IGNORED.has(p)); }

  /** File changes under `root` (relative paths with /). */
  filesChanged(root, changes, now = this.deps.now()) {
    let reload = false;
    for (const [rel, kind] of changes) {
      if (rel.startsWith(HEARTH_DIR + '/') || rel.startsWith(KIRO_DIR + '/')) { reload = true; continue; }
      if (Engine.ignored(rel)) continue;
      for (const turn of this.turns.values()) if (turn.root === root && !(turn.endsAt && now > turn.endsAt)) turn.files.set(rel, kind);
    }
    if (reload) this.reload(root);
  }

  tick(now = this.deps.now()) {
    const runs = this.deps.runs();
    this.#watch(runs);
    for (const r of runs) {
      const prev = this.last.get(r.id); this.last.set(r.id, r.status);
      if (r.status === 'running' && prev !== 'running' && !(prev === 'needs-input' && this.turns.has(r.id))) {
        const byHook = this.hookStarted.delete(r.id);
        this.turns.set(r.id, { runID: r.id, root: r.directory, byHook, files: new Map(), endsAt: null, started: now });
      } else if (prev === 'running' && r.status !== 'running' && r.status !== 'needs-input') {
        const t = this.turns.get(r.id); if (t) t.endsAt = now + SETTLE_MS;      // wait for the last file events
      }
    }
    for (const [id, at] of this.hookStarted) if (now - at > 30000) this.hookStarted.delete(id);
    for (const [id, turn] of this.turns) {
      if (!turn.endsAt || now < turn.endsAt) continue;
      this.turns.delete(id);
      if (!turn.byHook) this.#finished(turn, now);
    }
    this.#flush(runs, now);
  }

  #finished(turn, now) {
    for (const hook of this.active(turn.root)) {
      if (isFileTrigger(hook.trigger)) {
        const kind = { FileSave: 'saved', FileCreate: 'created', FileDelete: 'deleted' }[hook.trigger];
        const files = [...turn.files].filter(([rel, k]) => k === kind && matches(hook, rel)).map(([rel]) => rel).sort();
        if (files.length) this.#fire(hook, turn.root, turn.runID, files, now);
      } else if (hook.trigger === 'Stop') this.#fire(hook, turn.root, turn.runID, [], now);
    }
  }

  runManually(root, hookId) {
    const hook = this.hooks(root).hooks.find((h) => h.id === hookId);
    if (!hook) throw new Error('Unknown hook');
    if (!this.isTrusted(root, hook)) throw new Error('Allow this hook file first');
    const runs = this.deps.runs().filter((r) => r.directory === root && r.running);
    const target = runs.find((r) => r.selected) || runs[0];
    this.#fire(hook, root, target?.id || null, [], this.deps.now());
  }

  #fire(hook, root, runID, files, now) {
    const detail = files.length ? files.slice(0, 3).join(', ') + (files.length > 3 ? ` +${files.length - 3}` : '') : hook.trigger;
    if (hook.action.type === 'agent') {
      if (!runID) { this.#log(root, hook, detail, 'noAgent', now); return; }
      const id = this.#log(root, hook, detail, 'queued', now);
      this.queue.push({ runID, prompt: prompt(hook, files, hook.action.prompt), activity: id });
    } else if (hook.action.type === 'command') {
      const id = this.#log(root, hook, hook.action.command, 'running', now);
      Promise.resolve(this.deps.runCommand(root, hook.action.command, hook.action.timeout)).then((result) => {
        const ok = result.code === 0;
        this.#update(id, ok ? 'commandOK' : 'commandFailed', result.code);
        if (ok || !runID) return;
        const qid = this.#log(root, hook, 'Output sent to the agent', 'queued', this.deps.now());
        this.queue.push({ runID, prompt: failurePrompt(hook, hook.action.command, result), activity: qid });
      }, (e) => this.#update(id, 'commandFailed', null, String(e.message || e)));
    }
  }

  #flush(runs, now) {
    if (!this.queue.length) return;
    const sent = new Set(); const rest = [];
    for (const item of this.queue) {
      const run = runs.find((r) => r.id === item.runID);
      if (!run || !run.running) { this.#update(item.activity, 'noAgent'); continue; }
      const busy = run.status === 'running' || run.status === 'needs-input' || run.status === 'starting' || this.turns.has(run.id) || this.hookStarted.has(run.id) || sent.has(run.id);
      if (busy) { rest.push(item); continue; }
      this.deps.send(run.id, item.prompt);
      this.hookStarted.set(run.id, now); sent.add(run.id);
      this.#update(item.activity, 'sent');
    }
    this.queue = rest;
  }

  #log(root, hook, detail, outcome, now) {
    const a = { id: ++this.seq, date: now, root, hook: hook.name, detail, outcome };
    this.activity.unshift(a); if (this.activity.length > 40) this.activity.length = 40;
    this.onChange(); return a.id;
  }
  #update(id, outcome, code, detail) { const a = this.activity.find((x) => x.id === id); if (a) { a.outcome = outcome; if (code !== undefined) a.code = code; if (detail) a.detail = detail; this.onChange(); } }

  #watch(runs) {
    const roots = new Set(runs.filter((r) => r.running).map((r) => r.directory));
    for (const [root, w] of this.watchers) if (!roots.has(root)) { try { w.close(); } catch { /* gone */ } this.watchers.delete(root); }
    for (const root of roots) {
      if (this.watchers.has(root)) continue;
      this.reload(root);
      const watch = this.deps.watch || defaultWatch;
      try { this.watchers.set(root, watch(root, (rel, kind) => this.filesChanged(root, [[rel, kind]]), () => this.turnStart(root))); } catch { /* folder gone */ }
    }
  }
  turnStart(root) { let s = Infinity; for (const t of this.turns.values()) if (t.root === root) s = Math.min(s, t.started); return s; }
  close() { for (const w of this.watchers.values()) { try { w.close(); } catch { /* gone */ } } this.watchers.clear(); }
}

/** fs.watch (recursive on Windows): change = saved, rename = created (born during the turn) / saved / deleted (gone). */
function defaultWatch(root, cb, turnStart) {
  const w = fs.watch(root, { recursive: true }, (type, name) => {
    if (!name) return;
    const rel = String(name).replace(/\\/g, '/');
    if (Engine.ignored(rel)) return;
    let st = null; try { st = fs.statSync(path.join(root, name)); } catch { /* gone */ }
    if (st && st.isDirectory()) return;
    if (!st) { if (type === 'rename') cb(rel, 'deleted'); return; }
    if (type === 'rename' && st.birthtimeMs >= turnStart() - 1000) cb(rel, 'created'); else cb(rel, 'saved');
  });
  w.on('error', () => { /* folder removed */ });
  return w;
}

module.exports = { HEARTH_DIR, KIRO_DIR, TRIGGERS, TEMPLATES, SETTLE_MS, normTrigger, globToRegex, parse, load, matches, create, setEnabled, remove, Trust, Engine, prompt, failurePrompt, oneLine, isFileTrigger };
