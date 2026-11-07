'use strict';
// The sessions you started, remembered across app restarts (kind + folder). The conversations themselves are kept by
// the agent CLIs in their private home (~/.hearth/agents/<kind>/home); this list only lets you come back to a folder.
const fs = require('node:fs');
const path = require('node:path');

class History {
  constructor(file, limit = 40) { this.file = file; this.limit = limit; }
  list() {
    try { const v = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Array.isArray(v) ? v.filter((x) => x && typeof x.kind === 'string' && typeof x.directory === 'string') : []; }
    catch { return []; }
  }
  #save(items) { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(items, null, 1)); } catch { /* not critical */ } }
  /** Newest first, one entry per agent + folder. */
  record(kind, directory) {
    const same = (x) => x.kind === kind && x.directory.toLowerCase() === directory.toLowerCase();
    const items = [{ kind, directory, title: path.basename(directory), last: Date.now() }, ...this.list().filter((x) => !same(x))].slice(0, this.limit);
    this.#save(items); return items;
  }
  forget(kind, directory) { const items = this.list().filter((x) => !(x.kind === kind && x.directory.toLowerCase() === String(directory).toLowerCase())); this.#save(items); return items; }
}
module.exports = { History };
