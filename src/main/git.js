'use strict';
// Host-side Git for the inspector. Repository-controlled code must never run on the
// host, so hooks and fsmonitor are switched off for every call.
const { execFile } = require('node:child_process');
const os = require('node:os');

const SAFE = ['-c', `core.hooksPath=${os.devNull}`, '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'core.quotepath=off'];

function git(cwd, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', [...SAFE, ...args], { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GCM_INTERACTIVE: 'never' }, timeout: 120000 },
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

// ---- branches, remotes, stash, merge ----
/** Same rule as the macOS app: no option-like names, no odd characters. */
function validRef(ref) {
  return typeof ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/.test(ref) && !ref.includes('..') && !ref.endsWith('/') && !ref.endsWith('.lock');
}
const need = (ref) => { if (!validRef(ref)) throw new Error('Invalid branch name'); return ref; };

function parseBranches(raw) {
  return raw.split('\n').filter(Boolean).map((l) => {
    const [name, head, upstream, remote] = l.split('\t');
    return { name, current: head === '*', upstream: upstream || null, remote: remote === 'remote' };
  }).filter((b) => !b.name.endsWith('/HEAD'));
}

async function branches(cwd) {
  const local = await git(cwd, ['for-each-ref', '--format=%(refname:short)\t%(HEAD)\t%(upstream:short)\tlocal', 'refs/heads']);
  const remote = await git(cwd, ['for-each-ref', '--format=%(refname:short)\t \t\tremote', 'refs/remotes']);
  return parseBranches(local + remote);
}

const checkout = async (cwd, branch) => git(cwd, ['checkout', need(branch)]);
const createBranch = async (cwd, name) => git(cwd, ['checkout', '-b', need(name)]);
const fetch = (cwd) => git(cwd, ['fetch', '--prune']);
const pull = (cwd) => git(cwd, ['pull', '--ff-only']);
const stageAll = (cwd) => git(cwd, ['add', '-A']);
const unstageAll = (cwd) => git(cwd, ['reset', '-q']);
const merge = async (cwd, branch) => git(cwd, ['merge', '--no-edit', '--no-verify', need(branch)]);
const mergeAbort = (cwd) => git(cwd, ['merge', '--abort']);
async function mergeInProgress(cwd) {
  try { await git(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']); return true; } catch { return false; }
}

/** Push never forces. A branch without upstream is published with -u. */
async function push(cwd) {
  const st = await status(cwd);
  if (!st.branch) throw new Error('Detached HEAD: nothing to push');
  if (st.upstream) return git(cwd, ['push']);
  const remotes = (await git(cwd, ['remote'])).split('\n').filter(Boolean);
  if (!remotes.length) throw new Error('This repository has no remote');
  return git(cwd, ['push', '-u', remotes.includes('origin') ? 'origin' : remotes[0], st.branch]);
}

async function remoteUrl(cwd) {
  try {
    const remotes = (await git(cwd, ['remote'])).split('\n').filter(Boolean);
    if (!remotes.length) return null;
    return (await git(cwd, ['remote', 'get-url', remotes.includes('origin') ? 'origin' : remotes[0]])).trim();
  } catch { return null; }
}

function parseStashes(raw) {
  return raw.split('\n').filter(Boolean).map((l) => { const [ref, subject] = l.split('\x1f'); return { ref, subject }; });
}
const stashList = async (cwd) => parseStashes(await git(cwd, ['stash', 'list', '--format=%gd\x1f%s']));
const stashSave = (cwd, message) => git(cwd, ['stash', 'push', '--include-untracked', ...(message ? ['-m', String(message).slice(0, 200)] : [])]);
const stashRef = (ref) => { if (!/^stash@\{\d{1,3}\}$/.test(ref)) throw new Error('Invalid stash'); return ref; };
const stashApply = async (cwd, ref) => git(cwd, ['stash', 'apply', stashRef(ref)]);
const stashPop = async (cwd, ref) => git(cwd, ['stash', 'pop', stashRef(ref)]);
const stashDrop = async (cwd, ref) => git(cwd, ['stash', 'drop', stashRef(ref)]);

module.exports = {
  status, diff, stage, unstage, commit, log, isRepo, parseStatus,
  validRef, parseBranches, branches, checkout, createBranch, fetch, pull, push, stageAll, unstageAll, merge, mergeAbort, mergeInProgress,
  remoteUrl, parseStashes, stashList, stashSave, stashApply, stashPop, stashDrop,
};
