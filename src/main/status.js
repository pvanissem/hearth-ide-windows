'use strict';
// Inbox status for agents that give no hooks: derived from terminal activity.
//   running      output within the last quiet window
//   needs-input  the terminal rang the bell or the last output looks like a prompt
//   idle         quiet for a while
const QUIET_MS = 2500;
const PROMPT_RE = /(\[y\/n\]|\(y\/n\)|\? \(.*\)|press enter|continue\?|allow|approve|proceed\?)\s*[:?]?\s*$/i;

class StatusTracker {
  constructor(onChange, now = () => Date.now()) {
    this.onChange = onChange; this.now = now;
    this.state = 'starting'; this.last = 0; this.tail = ''; this.timer = null; this.exited = false;
  }

  data(chunk) {
    if (this.exited) return;
    this.last = this.now();
    this.tail = (this.tail + chunk).slice(-300);
    if (chunk.includes('\x07')) return this.set('needs-input');
    this.set('running');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.settle(), QUIET_MS);
  }

  settle() {
    if (this.exited) return;
    const plain = this.tail.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').trimEnd();
    this.set(PROMPT_RE.test(plain) ? 'needs-input' : 'idle');
  }

  exit(code) {
    this.exited = true; clearTimeout(this.timer);
    this.set(code === 0 ? 'done' : 'failed');
  }

  set(state) {
    if (state === this.state) return;
    this.state = state;
    this.onChange(state);
  }
}

module.exports = { StatusTracker, QUIET_MS };
