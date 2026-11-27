'use strict';
// Writes a commit message for the current changes with an agent CLI, run once and non-interactively in the agent's own
// sandbox (same login), without tools: the diff comes from Hearth, the agent only answers. Ported from
// CommitMessageGenerator.swift. The prompt goes in on stdin (no command-line length limit, nothing in the process list).
const { spawn } = require('node:child_process');

const SUPPORTED = ['claude', 'codex', 'gemini'];
const MAX_DIFF = 20000;
const NOISE = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock',
  'composer.lock', 'go.sum', 'Podfile.lock', 'Package.resolved', '*.min.js', '*.min.css', '*.map'];
const DIFF_PATHSPEC = ['--', '.', ...NOISE.map((p) => `:(exclude,glob)**/${p}`)];
const isNoise = (p) => { const name = String(p).split('/').pop(); return NOISE.some((n) => (n.startsWith('*') ? name.endsWith(n.slice(1)) : name === n)); };
const CLAUDE_MODEL = 'haiku';
const CLAUDE_SYSTEM = 'You write concise, accurate git commit messages. Answer with the message only.';

/** What to describe: the staged changes, or everything when nothing is staged. `git` is (args) => Promise<stdout>. */
async function input(git, files) {
  const staged = files.some((f) => f.staged);
  let stat; let diff;
  if (staged) {
    stat = await git(['diff', '--cached', '--stat=200', '--no-color']).catch(() => '');
    diff = await git(['diff', '--cached', '--no-color', '-U1', ...DIFF_PATHSPEC]).catch(() => '');
  } else {
    const head = (await git(['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => '')).trim() ? ['HEAD'] : [];
    stat = await git(['diff', ...head, '--stat=200', '--no-color']).catch(() => '');
    diff = await git(['diff', ...head, '--no-color', '-U1', ...DIFF_PATHSPEC]).catch(() => '');
    const untracked = files.filter((f) => f.untracked);
    if (untracked.length) {
      stat += (stat ? '\n' : '') + untracked.map((f) => ` ${f.path} (new)`).join('\n');
      for (const f of untracked.filter((x) => !isNoise(x.path)).slice(0, 8)) {
        if (diff.length >= MAX_DIFF) break;
        diff += await git(['diff', '--no-color', '--no-index', '--', '/dev/null', f.path]).catch(() => '');
      }
    }
  }
  if (!stat.trim() && !diff) return null;
  const subjects = (await git(['log', '-n12', '--pretty=format:%s']).catch(() => '')).split('\n').filter(Boolean);
  const out = { files: stat.replace(/\n+$/, ''), diff, recentSubjects: subjects, stagedOnly: staged, truncated: false };
  if (diff.length > MAX_DIFF) { out.diff = diff.slice(0, MAX_DIFF); out.truncated = true; }
  return out;
}

function prompt(inp) {
  let p = 'Write a git commit message for the changes below.\n\nRules:\n'
    + '- Output only the commit message itself: no explanations, no quotes, no Markdown code fences.\n'
    + '- First line: a concise summary of at most 72 characters, in the imperative mood.\n'
    + '- If the change needs more explanation, add a blank line and a short body (wrapped at 72 characters) that says what changed and why. Leave the body out for small, obvious changes.\n'
    + '- Follow the language and conventions (prefixes, capitalization, style) of the recent commit messages if there are any; otherwise write in English.\n'
    + '- Do not mention files or details that are not in the changes.\n';
  if (inp.recentSubjects.length) p += '\nRecent commit messages of this repository:\n' + inp.recentSubjects.map((s) => '- ' + s).join('\n') + '\n';
  p += '\n' + (inp.stagedOnly ? 'Changed files (staged):' : 'Changed files:') + '\n' + inp.files + '\n';
  p += '\nDiff' + (inp.truncated ? ' (cut off, too long)' : '') + ':\n' + inp.diff;
  return p;
}

/** Arguments of the one-shot call; the prompt always arrives on stdin. Small model, no tools, no MCP. */
function args(kind) {
  if (kind === 'claude') return ['--print', '--output-format', 'text', '--no-session-persistence', '--tools=', '--strict-mcp-config', '--model', CLAUDE_MODEL, '--system-prompt', CLAUDE_SYSTEM];
  if (kind === 'codex') return ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '-c', 'model_reasoning_effort="low"', '-'];
  if (kind === 'gemini') return ['--prompt', 'Follow the instructions in the input exactly.'];
  throw new Error('This agent cannot write commit messages');
}

/** The message from the answer: no terminal codes, fences, quotes or preamble. */
function clean(output) {
  let text = String(output).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r\n/g, '\n').trim();
  const open = text.indexOf('```');
  if (open >= 0) {
    const after = text.slice(open + 3); const nl = after.indexOf('\n'); const body = nl >= 0 ? after.slice(nl + 1) : '';
    const close = body.indexOf('```'); if (close >= 0) text = body.slice(0, close);
  }
  const lines = text.split('\n');
  const first = (lines[0] || '').trim().toLowerCase();
  if (first.endsWith(':') && first.includes('commit message')) lines.shift();
  text = lines.join('\n').trim();
  for (const q of ['"', "'", '`']) if (text.length > 1 && text.startsWith(q) && text.endsWith(q)) text = text.slice(1, -1).trim();
  return text;
}

const validMessage = (m) => typeof m === 'string' && m.trim().length > 0 && m.length < 10000;

/** Runs a prepared launch (from sandbox.prepare) with stdin, collects stdout/stderr. */
function runOnce(launch, stdin, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const a = launch.backend === 'native' ? [...launch.args, '--pipes'] : launch.args;
    const proc = spawn(launch.file, a, { cwd: launch.cwd, env: { ...launch.env, NO_COLOR: '1', TERM: 'dumb' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } reject(new Error('The agent did not answer in time.')); }, timeoutMs);
    proc.stdout.on('data', (d) => { if (out.length < 1e6) out += d; });
    proc.stderr.on('data', (d) => { if (err.length < 1e5) err += d; });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: out, stderr: err }); });
    proc.stdin.on('error', () => { /* closed early */ });
    proc.stdin.end(stdin);
  });
}

module.exports = { SUPPORTED, MAX_DIFF, NOISE, isNoise, input, prompt, args, clean, validMessage, runOnce, CLAUDE_MODEL };
