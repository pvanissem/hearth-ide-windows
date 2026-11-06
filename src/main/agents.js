'use strict';
// The agent CLIs Hearth can run. Each brings its own login; Hearth only grants
// the paths and hosts that agent needs (ported from AgentKind.swift).

const AGENTS = {
  claude: {
    name: 'Claude Code', executable: 'claude', install: 'npm install -g @anthropic-ai/claude-code',
    resume: (id) => (id ? ['--resume', id] : []), login: ['auth', 'login'],
    domains: ['statsig.anthropic.com', 'console.anthropic.com', 'api.anthropic.com'],
    env: { DISABLE_AUTOUPDATER: '1' }, configDir: '.claude',
  },
  codex: {
    name: 'Codex', executable: 'codex', install: 'npm install -g @openai/codex',
    resume: (id) => (id ? ['resume', id] : []), login: ['login'],
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

module.exports = { AGENTS };
