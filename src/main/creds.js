'use strict';
// Secrets (CI tokens, environment variables for agents), encrypted with Windows DPAPI via
// Electron's safeStorage. The file only ever holds ciphertext. Tokens are bound to one host.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const file = () => path.join(process.env.HEARTH_HOME || os.homedir(), '.hearth', 'secrets.json');
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/i;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
// Names that would let a secret change how the sandbox itself behaves.
const ENV_BLOCKED = /^(PATH|PATHEXT|COMSPEC|SYSTEMROOT|WINDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|HEARTH_.*|NODE_OPTIONS|LD_PRELOAD)$/i;

class Credentials {
  /** @param {{encrypt:(s:string)=>Buffer, decrypt:(b:Buffer)=>string, available?:()=>boolean}} crypto */
  constructor(crypto, filePath = file()) { this.crypto = crypto; this.filePath = filePath; }

  #read() {
    try { const d = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); return { tokens: d.tokens || {}, env: d.env || {} }; } catch { return { tokens: {}, env: {} }; }
  }
  #write(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
  get available() { return this.crypto.available ? this.crypto.available() : true; }
  #need() { if (!this.available) throw new Error('Windows secret storage is not available'); }

  static tokenKey(host, writing) { return `${String(host).toLowerCase()}|${writing ? 'write' : 'read'}`; }

  saveToken(host, writing, token) {
    this.#need();
    if (!HOST_RE.test(host || '')) throw new Error('Invalid host');
    if (typeof token !== 'string' || !token.trim() || /\s/.test(token.trim())) throw new Error('Invalid token');
    const d = this.#read();
    d.tokens[Credentials.tokenKey(host, writing)] = this.crypto.encrypt(token.trim()).toString('base64');
    this.#write(d);
  }
  getToken(host, writing) {
    const d = this.#read();
    const enc = d.tokens[Credentials.tokenKey(host, writing)];
    if (!enc) return null;
    try { return this.crypto.decrypt(Buffer.from(enc, 'base64')); } catch { return null; }
  }
  /** A token for reading: a write token also reads. */
  tokenFor(host, writing) { return (writing ? null : this.getToken(host, false)) || this.getToken(host, true); }
  deleteToken(host, writing) { const d = this.#read(); delete d.tokens[Credentials.tokenKey(host, writing)]; this.#write(d); }
  listTokens() { return Object.keys(this.#read().tokens).map((k) => { const [host, mode] = k.split('|'); return { host, writing: mode === 'write' }; }); }

  setEnv(name, value) {
    this.#need();
    if (!ENV_NAME_RE.test(name || '') || ENV_BLOCKED.test(name)) throw new Error('This variable name is not allowed');
    if (typeof value !== 'string' || !value.length || /[\r\n\0]/.test(value)) throw new Error('Invalid value');
    const d = this.#read();
    d.env[name] = this.crypto.encrypt(value).toString('base64');
    this.#write(d);
  }
  deleteEnv(name) { const d = this.#read(); delete d.env[name]; this.#write(d); }
  listEnv() { return Object.keys(this.#read().env).sort(); }
  /** name -> value, for the sandbox environment. */
  envValues() {
    const out = {};
    for (const [k, v] of Object.entries(this.#read().env)) { try { out[k] = this.crypto.decrypt(Buffer.from(v, 'base64')); } catch { /* skip */ } }
    return out;
  }
}

module.exports = { Credentials, HOST_RE, ENV_NAME_RE, ENV_BLOCKED };
