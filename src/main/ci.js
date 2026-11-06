'use strict';
// CI/CD for GitHub Actions and GitLab pipelines, one client interface (ported from CI.swift,
// GitHubAPI.swift). Tokens only go to the https origin of the repository's own remote.

/** Parse a git remote (https, ssh://, scp-like) into host + project path. */
function parseRemote(url) {
  if (typeof url !== 'string') return null;
  let host; let p;
  let m = /^(?:ssh:\/\/)?(?:[\w.-]+@)?([A-Za-z0-9.-]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(url.trim());
  const web = /^https?:\/\/(?:[^@/]+@)?([A-Za-z0-9.-]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url.trim());
  if (web) { host = web[1]; p = web[2]; } else if (m) { host = m[1]; p = m[2]; } else return null;
  if (!/^[A-Za-z0-9._\/-]+$/.test(p) || p.includes('..') || !p.includes('/')) return null;
  host = host.toLowerCase();
  const provider = host === 'github.com' || host.includes('github') ? 'github' : 'gitlab';
  return { host, path: p, provider, origin: 'https://' + host };
}

class CIError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/** Normalise provider states to: success failed running pending canceled skipped manual. */
function normStatus(s, conclusion) {
  const v = String((conclusion || s) || '').toLowerCase();
  if (['success', 'passed'].includes(v)) return 'success';
  if (['failure', 'failed', 'timed_out', 'startup_failure', 'action_required'].includes(v)) return 'failed';
  if (['in_progress', 'running'].includes(v)) return 'running';
  if (['queued', 'waiting', 'pending', 'created', 'scheduled', 'preparing', 'waiting_for_resource', 'requested'].includes(v)) return 'pending';
  if (['cancelled', 'canceled', 'canceling'].includes(v)) return 'canceled';
  if (['skipped', 'neutral', 'stale'].includes(v)) return 'skipped';
  if (v === 'manual') return 'manual';
  return v || 'pending';
}
const isActive = (s) => s === 'running' || s === 'pending';

function explain(status, provider, body) {
  const who = provider === 'github' ? 'GitHub' : 'GitLab';
  if (status === 401) return `${who} rejects the token (401). Expired, or missing the needed scope?`;
  if (status === 403) return `No permission (403). Starting or retrying needs a token with write access${provider === 'gitlab' ? ' ("api" scope)' : ' (Actions: write)'}.`;
  if (status === 404) return 'Project not found or no permission (404).';
  return `${who} error ${status}: ${String(body || '').slice(0, 160)}`;
}

class Client {
  constructor(remote, { token, writeToken, fetchImpl = fetch }) {
    this.remote = remote; this.token = token; this.writeToken = writeToken; this.fetch = fetchImpl;
    this.project = encodeURIComponent(remote.path);
  }
  get base() {
    const { provider, host } = this.remote;
    if (provider === 'gitlab') return `https://${host}/api/v4`;
    return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  }
  headers(token) {
    return this.remote.provider === 'gitlab'
      ? { 'PRIVATE-TOKEN': token, Accept: 'application/json' }
      : { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  async req(method, p, { body, query, write = false, text = false } = {}) {
    const token = write ? this.writeToken : (this.token || this.writeToken);
    if (!token) throw new CIError(write ? 'For write actions, add a token with write access in Settings > Credentials.' : 'No token for this server. Add one in Settings > Credentials.', 401);
    const url = new URL(this.base + p);
    for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
    if (url.protocol !== 'https:' || url.host !== new URL(this.base).host) throw new CIError('Refusing to send the token to another origin.', 0);
    const res = await this.fetch(url, { method, headers: { ...this.headers(token), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'follow' });
    const raw = await res.text();
    if (!res.ok) throw new CIError(explain(res.status, this.remote.provider, raw), res.status);
    if (text) return raw;
    return raw ? JSON.parse(raw) : {};
  }

  get gh() { return this.remote.provider === 'github'; }
  get repo() { return `/repos/${this.remote.path.split('/').map(encodeURIComponent).join('/')}`; }

  async pipelines(ref) {
    if (this.gh) {
      const r = await this.req('GET', `${this.repo}/actions/runs`, { query: { per_page: '20', branch: ref || undefined } });
      return (r.workflow_runs || []).map((x) => ({ id: x.id, status: normStatus(x.status, x.conclusion), ref: x.head_branch, sha: (x.head_sha || '').slice(0, 8), name: x.name || x.display_title, url: x.html_url, created: x.created_at }));
    }
    const r = await this.req('GET', `/projects/${this.project}/pipelines`, { query: { per_page: '20', ref: ref || undefined } });
    return r.map((x) => ({ id: x.id, status: normStatus(x.status), ref: x.ref, sha: (x.sha || '').slice(0, 8), name: `#${x.id}`, url: x.web_url, created: x.created_at }));
  }
  async jobs(pipeline) {
    if (this.gh) {
      const r = await this.req('GET', `${this.repo}/actions/runs/${Number(pipeline)}/jobs`, { query: { per_page: '100' } });
      return (r.jobs || []).map((j) => ({ id: j.id, name: j.name, stage: j.workflow_name || '', status: normStatus(j.status, j.conclusion), url: j.html_url }));
    }
    const r = await this.req('GET', `/projects/${this.project}/pipelines/${Number(pipeline)}/jobs`, { query: { per_page: '100' } });
    return r.map((j) => ({ id: j.id, name: j.name, stage: j.stage, status: normStatus(j.status), url: j.web_url }));
  }
  async log(job) {
    const raw = await this.req('GET', this.gh ? `${this.repo}/actions/jobs/${Number(job)}/logs` : `/projects/${this.project}/jobs/${Number(job)}/trace`, { text: true });
    const text = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
    return text.length > 200000 ? '... (truncated)\n' + text.slice(-200000) : text;
  }
  async retry(pipeline) { await this.req('POST', this.gh ? `${this.repo}/actions/runs/${Number(pipeline)}/rerun` : `/projects/${this.project}/pipelines/${Number(pipeline)}/retry`, { write: true }); }
  async cancel(pipeline) { await this.req('POST', this.gh ? `${this.repo}/actions/runs/${Number(pipeline)}/cancel` : `/projects/${this.project}/pipelines/${Number(pipeline)}/cancel`, { write: true }); }
  async retryJob(job) { await this.req('POST', this.gh ? `${this.repo}/actions/jobs/${Number(job)}/rerun` : `/projects/${this.project}/jobs/${Number(job)}/retry`, { write: true }); }
  async playJob(job) { if (!this.gh) await this.req('POST', `/projects/${this.project}/jobs/${Number(job)}/play`, { write: true }); }
  async workflows() {
    if (!this.gh) return [];
    const r = await this.req('GET', `${this.repo}/actions/workflows`);
    return (r.workflows || []).filter((w) => w.state === 'active').map((w) => ({ id: w.id, name: w.name }));
  }
  async run(ref, workflow) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/.test(ref || '')) throw new CIError('Invalid branch', 0);
    if (this.gh) {
      if (!workflow) throw new CIError('Choose a workflow to run.', 0);
      await this.req('POST', `${this.repo}/actions/workflows/${Number(workflow)}/dispatches`, { write: true, body: { ref } });
    } else await this.req('POST', `/projects/${this.project}/pipeline`, { write: true, query: { ref } });
  }
  /** Merge request (GitLab) or pull request (GitHub); returns its web URL. */
  async createChangeRequest({ title, source, target, description }) {
    if (!title || !source || !target) throw new CIError('Title, source and target are required.', 0);
    if (this.gh) {
      const r = await this.req('POST', `${this.repo}/pulls`, { write: true, body: { title, head: source, base: target, body: description || '' } });
      return r.html_url;
    }
    const r = await this.req('POST', `/projects/${this.project}/merge_requests`, { write: true, body: { title, source_branch: source, target_branch: target, description: description || '' } });
    return r.web_url;
  }
}

module.exports = { parseRemote, normStatus, isActive, Client, CIError };
