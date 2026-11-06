'use strict';
// Grants (AppContainer ACEs) belong to a project folder and are shared by every sandboxed process there:
// agent sessions, build tasks, test runs. A lease counts these users - including the ones that are still
// starting - and the grants are removed only when the last one is gone. (Without it, the end of a build
// removed the access of the test run that had just started.)
const path = require('node:path');

class Leases {
  /** @param {{run:(helper:string,args:string[])=>void, runSync?:(helper:string,args:string[])=>void}} exec */
  constructor(exec) { this.exec = exec; this.dirs = new Map(); }

  key(dir) { return path.resolve(dir).toLowerCase(); }

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
    return entry.revokes.size > 0;
  }

  /** App exit: undo everything now. */
  releaseAllSync() {
    for (const [k, entry] of [...this.dirs]) {
      this.dirs.delete(k);
      for (const args of entry.revokes.values()) { try { (this.exec.runSync || this.exec.run)(entry.helper, args); } catch { /* best effort */ } }
    }
  }

  count(dir) { return this.dirs.get(this.key(dir))?.count || 0; }
}

module.exports = { Leases };
