'use strict';
// Inbox status of a session. Three sources, in this order of trust:
//   hooks     Claude Code hooks / Codex notify write events to <run>/events.jsonl (applyEvent)
//   OSC 7501  any program in the terminal reports its state (Program Status Protocol, as in herdr)
//   terminal  heuristics over output, the bell and prompts (agents without hooks)
// States: starting running needs-input blocked idle done failed.
// Ported from AgentHost.swift / ProgramStatus.swift.
const QUIET_MS = 2500;
const PROMPT_RE = /(\[y\/n\]|\(y\/n\)|\? \(.*\)|press enter|continue\?|allow|approve|proceed\?)\s*[:?]?\s*$/i;
// eslint-disable-next-line no-control-regex
const OSC_RE = /\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

/** Text from the sandboxed program: no control, format or direction characters, at most 300 chars. */
function cleanText(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return t ? t.slice(0, 300) : null;
}

/** One OSC 7501 payload ("state=working:progress=40:msg=<base64>") -> record, or null. */
function parseOSC(payload) {
  const rec = {};
  for (const part of String(payload).split(/[:;]/)) {
    const eq = part.indexOf('='); if (eq < 1) continue;
    rec[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1);
  }
  const state = (rec.state || '').toLowerCase();
  const out = { id: (rec.id || '').slice(0, 64), state };
  if (state === 'clear' || (state === '' && 'state' in rec)) return { ...out, state: 'clear' };
  if (!['idle', 'working', 'done', 'blocked', 'error'].includes(state)) return null;
  if (['permission', 'question', 'auth'].includes((rec.kind || '').toLowerCase())) out.kind = rec.kind.toLowerCase();
  const p = Number(rec.progress);
  if (rec.progress != null && Number.isFinite(p)) out.progress = Math.max(0, Math.min(100, Math.round(p)));
  const dec = (v) => { if (v == null) return null; try { return Buffer.from(v, 'base64').toString('utf8'); } catch { return null; } };
  out.message = cleanText(dec(rec.msg) ?? rec.message ?? null);
  out.title = cleanText(rec.title ?? null);
  return out;
}

const BLOCKED_TEXT = { permission: 'Waiting for approval.', question: 'Has a question for you.', auth: 'Needs you to sign in.' };

/**
 * Records oldest first -> { status, detail, progress } or null (cleared). Something that needs the user wins over an error,
 * an error over work in progress; otherwise the newest record decides.
 */
function summarize(records) {
  if (!records.length) return null;
  const last = (s) => [...records].reverse().find((r) => r.state === s);
  const text = (r) => r.message || r.title || null;
  const b = last('blocked'); if (b) return { status: 'needs-input', detail: text(b) || BLOCKED_TEXT[b.kind] || 'The agent needs your attention.', progress: b.progress ?? null };
  const e = last('error'); if (e) return { status: 'blocked', detail: text(e), progress: null };
  const w = last('working'); if (w) return { status: 'running', detail: null, progress: w.progress ?? null };
  const n = records[records.length - 1];
  return n.state === 'done' ? { status: 'done', detail: text(n), progress: null } : { status: 'idle', detail: null, progress: null };
}

/** How long the current turn runs, how long the state lasts, how long the last turn took. */
class TurnClock {
  constructor(now = Date.now()) { this.since = now; this.turnStarted = null; this.lastTurn = null; }
  /** A turn lasts through questions to the user; it ends when the agent is done, idle, blocked or exited. */
  transition(from, to, now = Date.now()) {
    if (from === to) return;
    this.since = now;
    if (to === 'running') { if (this.turnStarted == null) this.turnStarted = now; } else if (to !== 'needs-input' && to !== 'starting') {
      if (this.turnStarted != null) this.lastTurn = now - this.turnStarted;
      this.turnStarted = null;
    }
  }
  toJSON() { return { since: this.since, turnStarted: this.turnStarted, lastTurn: this.lastTurn }; }
}
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600); const m = Math.floor(total / 60) % 60; const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Statuses an agent needs no interruption in: a restart can happen now. */
const restartsNow = (s) => s !== 'running' && s !== 'needs-input';

class StatusTracker {
  /**
   * @param onChange (info) => void with { state, detail, progress, clock }
   * @param opts.source 'hooks' | 'notify' | 'terminal'
   */
  constructor(onChange, { now = () => Date.now(), source = 'terminal' } = {}) {
    this.onChange = onChange; this.now = now; this.source = source;
    this.state = 'starting'; this.detail = null; this.progress = null;
    this.last = 0; this.tail = ''; this.oscTail = ''; this.timer = null; this.exited = false;
    this.osc = new Map(); this.reportsProgramStatus = false;
    this.clock = new TurnClock(now());
    this.sessionID = null; this.title = null;
  }

  get info() { return { state: this.state, detail: this.detail, progress: this.progress, clock: this.clock.toJSON() }; }

  /** Terminal output. */
  data(chunk) {
    if (this.exited) return;
    this.last = this.now();
    this.tail = (this.tail + chunk).slice(-300);
    // OSC 7501 may be split across chunks: keep an unterminated tail
    const buf = this.oscTail + chunk;
    let m; let found = false; let end = 0;
    OSC_RE.lastIndex = 0;
    while ((m = OSC_RE.exec(buf))) { found = true; end = OSC_RE.lastIndex; this.#osc(m[1]); }
    const rest = buf.slice(end); const open = rest.lastIndexOf('\x1b]7501;');
    this.oscTail = open >= 0 && rest.length - open < 4096 ? rest.slice(open) : '';
    if (found || this.reportsProgramStatus) return;
    if (this.source === 'hooks' && this.eventsSeen) return;   // Claude says itself what it does (once its hooks report)
    if (chunk.includes('\x07')) return this.set('needs-input', 'The agent needs your attention.');
    if (this.source === 'notify' && this.eventsSeen && this.state !== 'running' && this.state !== 'starting') {
      // Codex reports the end of a turn; output after that is redraw noise unless the user typed
      clearTimeout(this.timer); return;
    }
    this.set('running');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.settle(), QUIET_MS);
  }

  /** The user pressed Enter in the terminal: a new turn starts (for agents without hooks). */
  input(data) {
    if (this.exited || this.reportsProgramStatus || (this.source === 'hooks' && this.eventsSeen)) return;
    if (String(data).includes('\r') && this.state !== 'starting') {
      this.set('running');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.settle(), QUIET_MS * 2);
    }
  }

  settle() {
    if (this.exited || this.reportsProgramStatus) return;
    const plain = this.tail.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').trimEnd();
    this.set(PROMPT_RE.test(plain) ? 'needs-input' : 'idle');
  }

  #osc(payload) {
    const r = parseOSC(payload);
    if (!r) return;
    this.reportsProgramStatus = true;
    clearTimeout(this.timer);
    if (r.state === 'clear') this.osc.delete(r.id); else { this.osc.delete(r.id); this.osc.set(r.id, r); }
    const s = summarize([...this.osc.values()]);
    if (!s) { this.progress = null; if (['running', 'needs-input', 'blocked'].includes(this.state)) this.set('idle'); else this.emit(); return; }
    if (s.status === 'idle' && this.state === 'done') return;
    this.progress = s.progress;
    this.set(s.status, s.detail);
  }

  /** One event from events.jsonl (Claude hook input or Codex notify payload). Returns what the caller may want to know. */
  applyEvent(ev) {
    if (!ev || typeof ev !== 'object' || this.exited) return {};
    const out = {};
    if (!this.eventsSeen) { this.eventsSeen = true; clearTimeout(this.timer); }
    const sid = typeof ev.session_id === 'string' ? ev.session_id : typeof ev['thread-id'] === 'string' ? ev['thread-id'] : null;
    if (sid && validSessionID(sid) && sid !== this.sessionID) { this.sessionID = sid; out.sessionID = sid; }
    const name = ev.hook_event_name || ev.type || '';
    switch (name) {
      case 'SessionStart': if (this.state !== 'running') this.set('idle'); break;
      case 'UserPromptSubmit': {
        if (typeof ev.prompt === 'string' && !this.title) { this.title = cleanText(ev.prompt.split(/\r?\n/)[0])?.slice(0, 60) || null; if (this.title) out.title = this.title; }
        this.set('running'); break;
      }
      case 'PreToolUse': this.set('running'); break;
      case 'PostToolUse': out.filesChanged = true; break;
      case 'PermissionRequest': this.set('needs-input', typeof ev.tool_name === 'string' ? `Wants to use ${cleanText(ev.tool_name)}.` : 'Waiting for approval.'); break;
      case 'Notification':
        if (ev.notification_type === 'idle_prompt') { if (this.state !== 'done') this.set('idle'); } else this.set('needs-input', cleanText(ev.message)); break;
      case 'Stop': case 'agent-turn-complete': {
        out.filesChanged = true; out.turnEnded = true;
        const summary = ev.last_assistant_message ?? ev['last-assistant-message'];
        this.set('done', typeof summary === 'string' ? cleanText(summary)?.slice(0, 140) : null); break;
      }
      default: break;
    }
    return out;
  }

  exit(code) {
    this.exited = true; clearTimeout(this.timer);
    this.set(code === 0 ? 'done' : 'failed');
  }

  set(state, detail = null) {
    const keep = state === 'needs-input' || state === 'done' || state === 'blocked';
    const nextDetail = keep ? detail : null;
    if (state === this.state && nextDetail === this.detail) return;
    this.clock.transition(this.state, state, this.now());
    this.state = state; this.detail = nextDetail;
    if (state !== 'running' && state !== 'needs-input') this.progress = state === 'idle' || state === 'done' ? null : this.progress;
    this.emit();
  }

  emit() { this.onChange(this.info); }
}

/** A session id goes into `--resume <id>`: it must not look like an option. */
const validSessionID = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id);

module.exports = { StatusTracker, TurnClock, QUIET_MS, parseOSC, summarize, cleanText, formatDuration, validSessionID, restartsNow };
