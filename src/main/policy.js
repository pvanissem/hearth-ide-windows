'use strict';
// One source of truth for what a sandbox may do. Pure: the same inputs always give
// the same nono profile (ported from SandboxPolicy.swift; Linux/Landlock flavoured,
// because on Windows nono runs inside WSL2).
const { AGENTS } = require('./agents');

const RUNTIME_GROUPS = ['node_runtime', 'python_runtime', 'go_runtime', 'rust_runtime', 'java_runtime', 'git_config'];
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

const validDomain = (d) => DOMAIN_RE.test(String(d || ''));
const unique = (a) => [...new Set(a.filter(Boolean))];

/**
 * @param {'agent'|'build'|'gitNetwork'|'gitLocal'} purpose
 * @param {{kind?:string, wslHome:string, workdir:string, runDir:string, settings?:object, gitHosts?:string[]}} c
 */
function makePolicy(purpose, c) {
  const kind = purpose === 'agent' ? c.kind : 'shell';
  const spec = AGENTS[kind] || AGENTS.shell;
  const s = c.settings || {};
  const home = c.wslHome;

  const readWrite = [c.runDir, c.workdir];
  const read = [];

  // Per-agent private config folder (the real one is never writable from the sandbox).
  if (spec.configDir) readWrite.push(`${home}/.hearth/agents/${kind}`);
  for (const f of s.folders || []) (f.write ? readWrite : read).push(f.path);

  if (purpose === 'gitNetwork' && s.gitSSH) read.push(`${home}/.ssh`);

  const domains = [
    ...(spec.domains || []),
    ...(s.domains || []).filter(validDomain),
    ...(purpose === 'gitNetwork' ? (c.gitHosts || []).filter(validDomain) : []),
  ];
  const ports = unique([...(spec.ports || []), ...(s.ports || []).filter((p) => p > 0 && p < 65536)]).sort((a, b) => a - b);

  // .git/hooks run outside the sandbox: write-protect them.
  const denyWrite = [`${c.workdir}/.git/hooks`];

  const environment = { ...(spec.env || {}) };
  if (purpose === 'build' || purpose === 'agent') {
    environment.npm_config_cache = `${home}/.cache/hearth/npm`;
    environment.GRADLE_USER_HOME = `${home}/.cache/hearth/gradle`;
  }

  return {
    name: `hearth-${purpose === 'agent' ? kind : purpose}`,
    groups: unique([...RUNTIME_GROUPS]),
    readWrite: unique(readWrite), read: unique(read), denyWrite,
    domains: unique(domains), ports, environment,
  };
}

/** nono's profile JSON. */
function toProfile(p) {
  const network = { network_profile: 'developer' };
  if (p.domains.length) network.allow_domain = p.domains;
  if (p.ports.length) network.open_port = p.ports;
  const filesystem = { allow: p.readWrite };
  if (p.read.length) filesystem.read = p.read;
  const profile = {
    extends: 'default',
    meta: { name: p.name, description: `Hearth IDE for Windows: ${p.name} (generated, do not edit)` },
    groups: { include: p.groups },
    workdir: { access: 'readwrite' },
    filesystem, network,
  };
  if (Object.keys(p.environment).length) profile.environment = { set_vars: p.environment };
  return profile;
}

module.exports = { makePolicy, toProfile, validDomain };
