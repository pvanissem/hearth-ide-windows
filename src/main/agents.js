'use strict';
// The agent CLIs Hearth can run. Each brings its own login; Hearth only grants
// the paths and hosts that agent needs (ported from AgentKind.swift).

const AGENTS = {
  claude: {
    name: 'Claude Code', executable: 'claude', install: 'npm install -g @anthropic-ai/claude-code',
    resume: (id) => (id ? ['--resume', id] : []), login: ['auth', 'login'], continueLast: ['--continue'],
    domains: ['statsig.anthropic.com', 'console.anthropic.com', 'api.anthropic.com'],
    env: { DISABLE_AUTOUPDATER: '1' }, configDir: '.claude',
  },
  codex: {
    name: 'Codex', executable: 'codex', install: 'npm install -g @openai/codex',
    resume: (id) => (id ? ['resume', id] : []), login: ['login'], continueLast: ['resume', '--last'],
    domains: ['chatgpt.com', 'auth.openai.com', 'ab.chatgpt.com', 'api.openai.com'],
    ports: [1455], configDir: '.codex',
  },
  copilot: {
    name: 'GitHub Copilot CLI', executable: 'copilot', install: 'npm install -g @github/copilot',
    resume: () => [], login: null,
    domains: ['api.githubcopilot.com', 'api.individual.githubcopilot.com', 'api.business.githubcopilot.com',
      'api.enterprise.githubcopilot.com', 'copilot-proxy.githubusercontent.com', 'github.com', 'api.github.com'],
    configDir: '.copilot',
  },
  opencode: {
    name: 'OpenCode', executable: 'opencode', install: 'npm install -g opencode-ai',
    resume: (id) => (id ? ['--session', id] : []), login: ['auth', 'login'],
    domains: ['models.dev', 'opencode.ai', 'api.githubcopilot.com'],
    env: { OPENCODE_DISABLE_AUTOUPDATE: '1' }, configDir: '.config/opencode',
  },
  gemini: {
    name: 'Gemini CLI', executable: 'gemini', install: 'npm install -g @google/gemini-cli',
    resume: () => [], login: null,
    domains: ['cloudcode-pa.googleapis.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'accounts.google.com'],
    configDir: '.gemini',
  },
  shell: {
    name: 'Sandbox shell', executable: 'bash', install: '', resume: () => [], login: null,
    args: ['--noprofile', '--norc', '-i'], domains: [], configDir: null,
  },
};

AGENTS.claude.statusSource = 'hooks';
AGENTS.codex.statusSource = 'notify';
AGENTS.claude.models = ['sonnet', 'haiku', 'opus', 'fable'];
AGENTS.claude.efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
AGENTS.codex.efforts = ['low', 'medium', 'high'];

/** Arguments for the chosen model and effort. Unknown values are dropped (they come back from the stored history). */
function optionArgs(kind, { model, effort } = {}) {
  const a = AGENTS[kind] || {};
  const m = (a.models || []).includes(model) ? model : null;
  const e = (a.efforts || []).includes(effort) ? effort : null;
  if (kind === 'claude') return [...(m ? ['--model', m] : []), ...(e ? ['--effort', e] : [])];
  if (kind === 'codex' && e) return ['-c', `model_reasoning_effort="${e}"`];
  return [];
}

/** Claude Code hooks (via --settings) / Codex notify that report the status to <run>/events.jsonl through the helper. */
const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'];
function statusHookArgs(kind, helperInBin, runDir) {
  const exe = helperInBin.replace(/\\/g, '/');
  if (kind === 'claude') {
    // Exec form (command + args): no shell. Claude would otherwise run hooks through Git Bash, which cannot start
    // inside an AppContainer; the helper is a real .exe.
    const hooks = Object.fromEntries(CLAUDE_EVENTS.map((e) => [e, [{ hooks: [{ type: 'command', command: exe, args: ['event'], timeout: 5 }] }]]));
    // Inline JSON: inside the AppContainer Claude cannot vet the parent folders of a settings file and refuses to read it.
    // (The run folder still gets a copy, for looking at it.) The JSON has no cmd.exe metacharacters (& | < > ^ %).
    const json = JSON.stringify({ hooks });
    try { require('node:fs').writeFileSync(require('node:path').join(runDir, 'claude-settings.json'), json); } catch { /* only informative */ }
    return ['--settings', json];
  }
  if (kind === 'codex') return ['-c', `notify=${JSON.stringify([exe, 'event'])}`];
  return [];
}

module.exports = { AGENTS, optionArgs, statusHookArgs, CLAUDE_EVENTS };
