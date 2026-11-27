'use strict';
// The sessions you started, remembered across app restarts. The conversations themselves are kept by the agent CLIs in
// their private home (~/.hearth/agents/<kind>/home); this list lets you come back to a folder and, when the agent told
// Hearth its session id (Claude hooks, Codex notify), resume exactly that conversation.
//   folders:  newest first, one entry per agent + folder          (list / record / forget)
//   sessions: resumable conversations per agent + folder          (sessions / remember)
//   options:  model and effort last used per folder               (options / setOptions)
const fs = require('node:fs');
const path = require('node:path');
const { validSessionID } = require('./status');

const same = (kind, directory) => (x) => x.kind === kind && String(x.directory).toLowerCase() === String(directory).toLowerCase();

class History {
  constructor(file, limit = 40) { this.file = file; this.limit = limit; }
  #load() {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(v)) return { folders: v, sessions: [], options: {} };        // the format of version 0.2.3
      return { folders: Array.isArray(v.folders) ? v.folders : [], sessions: Array.isArray(v.sessions) ? v.sessions : [], options: v.options && typeof v.options === 'object' ? v.options : {} };
    } catch { return { folders: [], sessions: [], options: {} }; }
  }
  #save(data) { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(data, null, 1)); } catch { /* not critical */ } }
  list() { return this.#load().folders.filter((x) => x && typeof x.kind === 'string' && typeof x.directory === 'string'); }
  /** Newest first, one entry per agent + folder. */
  record(kind, directory) {
    const data = this.#load();
    data.folders = [{ kind, directory, title: path.basename(directory), last: Date.now() }, ...data.folders.filter((x) => x && !same(kind, directory)(x))].slice(0, this.limit);
    this.#save(data); return data.folders;
  }
  forget(kind, directory) {
    const data = this.#load();
    data.folders = data.folders.filter((x) => x && !same(kind, directory)(x));
    data.sessions = data.sessions.filter((x) => x && !same(kind, directory)(x));
    this.#save(data); return data.folders;
  }
  /** Resumable conversations of one agent in one folder, newest first. */
  sessions(kind, directory) { return this.#load().sessions.filter((x) => x && same(kind, directory)(x) && validSessionID(x.sessionID)).sort((a, b) => b.last - a.last); }
  /** The agent told us its session id (and maybe the first prompt as title). */
  remember(kind, directory, sessionID, title) {
    if (!validSessionID(sessionID)) return;
    const data = this.#load();
    const old = data.sessions.find((x) => x && x.sessionID === sessionID);
    const entry = { kind, directory, sessionID, title: title || old?.title || path.basename(directory), last: Date.now() };
    data.sessions = [entry, ...data.sessions.filter((x) => x && x.sessionID !== sessionID)].slice(0, 200);
    this.#save(data);
  }
  options(directory) { return this.#load().options[String(directory).toLowerCase()] || {}; }
  setOptions(directory, opts) { const data = this.#load(); data.options[String(directory).toLowerCase()] = { model: opts.model || null, effort: opts.effort || null }; this.#save(data); }
}
module.exports = { History };
