'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validDomain } = require('./policy');

const FILE = path.join(process.env.HEARTH_HOME || os.homedir(), '.hearth', 'settings.json');
const DEFAULTS = { language: 'en', domains: [], ports: [], folders: [], gitSSH: true, allowUnsandboxed: false, backend: 'auto', network: 'internet', theme: 'system', journal: true };

function sanitize(raw) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.domains = [...new Set((Array.isArray(s.domains) ? s.domains : []).map(String).filter(validDomain))];
  s.ports = [...new Set((Array.isArray(s.ports) ? s.ports : []).map(Number).filter((p) => Number.isInteger(p) && p > 0 && p < 65536))];
  s.folders = (Array.isArray(s.folders) ? s.folders : []).filter((f) => f && typeof f.path === 'string' && f.path).map((f) => ({ path: f.path, write: Boolean(f.write) }));
  s.gitSSH = Boolean(s.gitSSH);
  s.allowUnsandboxed = Boolean(s.allowUnsandboxed);
  s.language = s.language === 'de' ? 'de' : 'en';
  s.backend = s.backend === 'wsl' ? 'wsl' : 'auto';
  s.network = s.network === 'none' ? 'none' : 'internet';
  s.theme = ['system', 'hearth', 'hearthLight', 'darcula', 'storm'].includes(s.theme) ? s.theme : 'system';
  s.journal = s.journal !== false;
  return s;
}

function load() {
  try { return sanitize(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { return sanitize({}); }
}

function save(next) {
  const s = sanitize(next);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
  return s;
}

module.exports = { load, save, sanitize, FILE };
