'use strict';
// Host-side Git for the inspector. Repository-controlled code must never run on the
// host, so hooks and fsmonitor are switched off for every call.
const { execFile } = require('node:child_process');
const os = require('node:os');

const SAFE = ['-c', `core.hooksPath=${os.devNull}`, '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'core.quotepath=off'];

function git(cwd, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', [...SAFE, ...args], { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => (err ? reject(Object.assign(new Error((stderr || err.message).trim()), { code: err.code })) : resolve(stdout)));
    if (input != null) { child.stdin.end(input); }
  });
}

/** Parse `git status --porcelain=v1 -z -b`. */
function parseStatus(raw) {
  const parts = raw.split('\0');
  const result = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
  const head = parts.shift() || '';
  if (head.startsWith('## ')) {
    const m = /^## (?:No commits yet on |Initial commit on )?([^\s.]+(?:\.[^\s.]+)*?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(head);
    if (m) {
      result.branch = m[1];
      result.upstream = m[2] || null;
      const a = /ahead (\d+)/.exec(m[3] || ''); const b = /behind (\d+)/.exec(m[3] || '');
      result.ahead = a ? Number(a[1]) : 0;
      result.behind = b ? Number(b[1]) : 0;
    } else { result.branch = head.slice(3); }
  }
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const x = entry[0]; const y = entry[1]; const file = entry.slice(3);
    let from = null;
    if (x === 'R' || x === 'C') from = parts[++i] || null;
    result.files.push({ path: file, from, index: x === ' ' ? '' : x, worktree: y === ' ' ? '' : y,
      untracked: x === '?', staged: x !== ' ' && x !== '?' && x !== '!', unstaged: y !== ' ' && x !== '?' });
  }
  return result;
}

async function status(cwd) {
  return parseStatus(await git(cwd, ['status', '--porcelain=v1', '-z', '-b', '--untracked-files=all']));
}

async function diff(cwd, file, staged) {
  const args = ['diff', '--no-color', '--no-ext-diff'];
  if (staged) args.push('--cached');
  if (file) args.push('--', file);
  return git(cwd, args);
}

const stage = (cwd, files) => git(cwd, ['add', '--', ...files]);
const unstage = (cwd, files) => git(cwd, ['restore', '--staged', '--', ...files]);

async function commit(cwd, message) {
  if (!message || !message.trim()) throw new Error('Commit message is empty');
  return git(cwd, ['commit', '--no-verify', '-F', '-'], { input: message });
}

async function log(cwd, limit = 50) {
  let out;
  try {
    out = await git(cwd, ['log', `-n${limit}`, '--pretty=format:%h%x1f%an%x1f%ar%x1f%s']);
  } catch (e) {
    if (/does not have any commits yet/.test(e.message)) return [];
    throw e;
  }
  return out.split('\n').filter(Boolean).map((l) => { const [hash, author, when, subject] = l.split('\x1f'); return { hash, author, when, subject }; });
}

async function isRepo(cwd) {
  try { return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'; } catch { return false; }
}

module.exports = { status, diff, stage, unstage, commit, log, isRepo, parseStatus };
