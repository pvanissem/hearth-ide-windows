'use strict';
// Windows <-> WSL path translation. Sandboxed commands run inside WSL2, where
// C:\Users\me\proj is /mnt/c/Users/me/proj.

function toWslPath(p) {
  if (!p) return p;
  const m = /^([A-Za-z]):[\\/]*(.*)$/.exec(p);
  if (!m) return p.replace(/\\/g, '/');
  const rest = m[2].replace(/\\/g, '/').replace(/\/+$/, '');
  return `/mnt/${m[1].toLowerCase()}${rest ? '/' + rest : ''}`;
}

function fromWslPath(p) {
  const m = /^\/mnt\/([a-z])(?:\/(.*))?$/.exec(p || '');
  if (!m) return p;
  return `${m[1].toUpperCase()}:\\${(m[2] || '').replace(/\//g, '\\')}`;
}

/** Single-quote a value for a POSIX shell. */
function shQuote(v) {
  return "'" + String(v).replace(/'/g, "'\\''") + "'";
}

module.exports = { toWslPath, fromWslPath, shQuote };
