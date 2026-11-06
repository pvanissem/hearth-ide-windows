'use strict';
// Grants (AppContainer ACEs) belong to a project folder and are shared by every sandboxed process there:
// agent sessions, build tasks, test runs. A lease counts these users - including the ones that are still
// starting - and the grants are removed only when the last one is gone. (Without it, the end of a build
// removed the access of the test run that had just started.)
//
// The grants in use are also written to a small state file. If the app is killed or crashes, the next start
// undoes them (recover): leftover grants on a project that contains the app itself would stop Electron from starting.
const fs = require('node:fs');
const path = require('node:path');

/** Is a process with this id running? (signal 0 only checks) */
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

class Leases {
  /**
   * @param {{run:(helper:string,args:string[])=>void, runSync?:(helper:string,args:string[])=>void}} exec
   * @param {{stateFile?:string}} [options]
   */
  constructor(exec, { stateFile } = {}) { this.exec = exec; this.stateFile = stateFile || null; this.dirs = new Map(); }

  key(dir) { return path.resolve(dir).toLowerCase(); }

  #persist() {
    if (!this.stateFile) return;
    try {
      const items = [];
      for (const [k, e] of this.dirs) for (const args of e.revokes.values()) items.push({ k, helper: e.helper, args });
      if (!items.length) { fs.rmSync(this.stateFile, { force: true }); return; }
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify({ pid: process.pid, items }));
    } catch { /* the state file is a safety net, never a reason to fail */ }
  }

  /** Call before sandbox.prepare(): the project is in use from now on. */
  acquire(dir) {
    const k = this.key(dir);
    const entry = this.dirs.get(k) || { count: 0, revokes: new Map(), helper: null };
    entry.count++;
    this.dirs.set(k, entry);
    return { k, released: false };
  }

  /** The launch that went with a lease: remember how to undo its grants. */
  attach(lease, launch) {
    const entry = this.dirs.get(lease.k);
    if (!entry || !launch || !launch.revoke || !launch.helper) return;
    entry.helper = launch.helper;
    entry.revokes.set(launch.revoke.join('\u0000'), launch.revoke);
    this.#persist();
  }

  /** Last user gone: remove the grants. Returns true when it did. */
  release(lease, { sync = false } = {}) {
    if (!lease || lease.released) return false;
    lease.released = true;
    const entry = this.dirs.get(lease.k);
    if (!entry) return false;
    if (--entry.count > 0) return false;
    this.dirs.delete(lease.k);
    for (const args of entry.revokes.values()) {
      try { (sync && this.exec.runSync ? this.exec.runSync : this.exec.run)(entry.helper, args); } catch { /* best effort */ }
    }
    this.#persist();
    return entry.revokes.size > 0;
  }

  /** App exit: undo everything now. */
  releaseAllSync() {
    for (const [k, entry] of [...this.dirs]) {
      this.dirs.delete(k);
      for (const args of entry.revokes.values()) { try { (this.exec.runSync || this.exec.run)(entry.helper, args); } catch { /* best effort */ } }
    }
    this.#persist();
  }

  /** Start of the app: undo grants that an earlier run left behind (crash, kill, power loss). Returns how many. */
  recover({ sync = false } = {}) {
    if (!this.stateFile) return 0;
    let items = [];
    try {
      const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      // Another Hearth instance may still be using these grants: only a dead owner's leftovers are ours to undo.
      if (state.pid && state.pid !== process.pid && alive(state.pid)) return 0;
      items = state.items || [];
    } catch { return 0; }
    let n = 0;
    for (const it of items) {
      if (!it || typeof it.helper !== 'string' || !Array.isArray(it.args) || !it.args.every((a) => typeof a === 'string') || it.args[it.args.length - 1] !== '--revoke') continue;
      if (!fs.existsSync(it.helper)) continue;
      try { (sync && this.exec.runSync ? this.exec.runSync : this.exec.run)(it.helper, it.args); n++; } catch { /* best effort */ }
    }
    try { fs.rmSync(this.stateFile, { force: true }); } catch { /* ignore */ }
    return n;
  }

  count(dir) { return this.dirs.get(this.key(dir))?.count || 0; }
}

module.exports = { Leases };
