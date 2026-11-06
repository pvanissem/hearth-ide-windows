'use strict';
// "Overview" (Anti-Burnout): the structured history of an agent session as a tree of steps,
// decisions and open questions. Ported from Journal.swift.
//
// Any agent can fill it: inside the sandbox `hearth-journal` appends one JSON line per entry to
// <run>/journal.jsonl (the only Hearth folder the sandbox may write). Later lines with the same id
// update earlier ones. The file is written from inside the sandbox, so everything read is bounded
// and sanitized.
const fs = require('node:fs');
const path = require('node:path');

const MAX_TEXT = 600;
const MAX_NODES = 2000;
const MAX_REJECTED = 8;
const MAX_CHUNK = 1 << 20;
const ALLOWED = { step: ['planned', 'running', 'done', 'blocked'], question: ['open', 'answered'], decision: ['done'] };

const validID = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/.test(id);

function clean(text) {
  if (typeof text !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
  return t ? t.slice(0, MAX_TEXT) : null;
}

class Journal {
  constructor() { this.nodes = new Map(); this.nextOrder = 0; }

  get isEmpty() { return this.nodes.size === 0; }

  /** Applies one decoded line; returns false when ignored. */
  apply(line) {
    if (!line || typeof line !== 'object') return false;
    const type = line.t;
    if (type === 'revoke') return this.#revoke(line);
    if (!['step', 'decision', 'question'].includes(type) || !validID(line.id)) return false;
    let node = this.nodes.get(line.id);
    if (!node) {
      if (this.nodes.size >= MAX_NODES) return false;
      node = { id: line.id, kind: type, parent: null, title: line.id, status: type === 'question' ? 'open' : 'planned', why: null, rejected: [], answer: null, revoked: null, order: this.nextOrder++ };
    } else node = { ...node };
    if (typeof line.parent === 'string') node.parent = validID(line.parent) ? line.parent : null;
    const title = clean(line.title); if (title) node.title = title;
    if (typeof line.status === 'string' && ALLOWED[node.kind].includes(line.status)) node.status = line.status;
    const why = clean(line.why); if (why) node.why = why;
    if (Array.isArray(line.rejected)) node.rejected = line.rejected.slice(0, MAX_REJECTED).map(clean).filter(Boolean);
    const answer = clean(line.answer);
    if (answer) { node.answer = answer; if (node.kind === 'question') node.status = 'answered'; }
    this.nodes.set(node.id, node);
    return true;
  }

  #revoke(line) {
    const node = this.nodes.get(line.target);
    if (!node) return false;
    const by = validID(line.replacedBy) && line.replacedBy !== line.target ? line.replacedBy : null;
    this.nodes.set(node.id, { ...node, revoked: { reason: clean(line.reason) || '', replacedBy: by } });
    return true;
  }

  /** A node whose parent is unknown or would form a cycle is shown at the top level. */
  effectiveParent(node) {
    const p = node.parent;
    if (!p || p === node.id || !this.nodes.has(p)) return null;
    const seen = new Set([node.id]);
    let cur = p;
    while (cur) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      cur = this.nodes.get(cur)?.parent;
    }
    return p;
  }

  children(parent = null) {
    return [...this.nodes.values()].filter((n) => this.effectiveParent(n) === parent).sort((a, b) => a.order - b.order);
  }

  openCount(id) {
    return this.children(id).reduce((sum, c) => sum + (c.status === 'open' && !c.revoked ? 1 : 0) + this.openCount(c.id), 0);
  }

  /** The deepest running step. */
  get currentID() {
    const deepest = (parent) => {
      for (const n of this.children(parent).reverse()) {
        if (n.revoked) continue;
        const inner = deepest(n.id); if (inner) return inner;
        if (n.kind === 'step' && n.status === 'running') return n.id;
      }
      return null;
    };
    return deepest(null);
  }

  /** Plain tree for the renderer. */
  toTree(parent = null) {
    return this.children(parent).map((n) => ({ ...n, open: this.openCount(n.id), children: this.toTree(n.id) }));
  }

  /** Instruction typed into the agent's prompt when the user revokes a node. */
  revokePrompt(id, reason) {
    const n = this.nodes.get(id);
    if (!n) return '';
    let text = `I am revoking ${n.kind} ${id} ("${n.title}").`;
    const r = clean(reason);
    if (r) text += ` Reason: ${r}.`;
    return text + ' Undo or adjust the work that depended on it, then record the replacement with hearth-journal.';
  }
}

/** Reads a journal file incrementally; one instance per session. */
class JournalReader {
  constructor(file) { this.file = file; this.journal = new Journal(); this.offset = 0; }

  /** Reads complete lines written since the last call. Returns true when the journal changed. */
  poll() {
    let fd;
    try { fd = fs.openSync(this.file, 'r'); } catch { return false; }
    try {
      const size = fs.fstatSync(fd).size;
      if (size <= this.offset) return false;
      const len = Math.min(size - this.offset, MAX_CHUNK);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, this.offset);
      const last = buf.lastIndexOf(10);
      if (last < 0) { if (len >= MAX_CHUNK) this.offset += len; return false; }   // an endless line: skip it
      this.offset += last + 1;
      let changed = false;
      for (const raw of buf.subarray(0, last).toString('utf8').split('\n')) {
        if (!raw.trim()) continue;
        let obj; try { obj = JSON.parse(raw); } catch { continue; }
        if (this.journal.apply(obj)) changed = true;
      }
      return changed;
    } finally { fs.closeSync(fd); }
  }

  /** The user's revocation is written like the agent's own lines. */
  revoke(target, reason, replacedBy) {
    fs.appendFileSync(this.file, JSON.stringify({ t: 'revoke', target, reason, ...(replacedBy ? { replacedBy } : {}) }) + '\n');
  }
}

const FILE_NAME = 'journal.jsonl';

const INSTRUCTION = 'Hearth shows the user a tree of your work so they do not have to read all your output. '
  + 'Record it with the shell command `hearth-journal` (already on PATH): '
  + '`hearth-journal step <id> --parent <id> --title "..." --status planned|running|done|blocked` for each step, '
  + '`hearth-journal decision <id> --parent <step-id> --title "..." --why "..." --rejected "alternative"` for every real choice between options, '
  + 'and `hearth-journal question <id> --parent <id> --title "..." [--answer "..."]` for open questions. '
  + 'Use short unique ids (s1, s2, d1, q1). Repeat a call with the same id to update it. '
  + 'Keep titles under 80 characters. If the user tells you they revoked an entry, undo the dependent work and record the replacement.';

/** Agent arguments that hand the instruction over as system/developer prompt, where the CLI has one. */
function agentArguments(kind) {
  if (kind === 'claude') return ['--append-system-prompt', INSTRUCTION];
  if (kind === 'codex') return ['-c', `developer_instructions=${JSON.stringify(INSTRUCTION)}`];
  return [];
}

/**
 * Installs the helper into the run folder: hearth-journal.cmd calls the sandbox helper exe
 * (copied next to it, because the sandbox can only read the folders it was granted).
 * @returns the bin folder to put on PATH
 */
function install(runDir, helperExe) {
  const bin = path.join(runDir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync(helperExe, path.join(bin, 'hearth-sandbox.exe'));
  fs.writeFileSync(path.join(bin, 'hearth-journal.cmd'), '@"%~dp0hearth-sandbox.exe" journal %*\r\n');
  const file = path.join(runDir, FILE_NAME);
  if (!fs.existsSync(file)) fs.writeFileSync(file, '');
  return bin;
}

module.exports = { Journal, JournalReader, validID, clean, INSTRUCTION, FILE_NAME, agentArguments, install };
