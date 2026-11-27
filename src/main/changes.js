'use strict';
// Merge requests (GitLab) and pull requests (GitHub): list, review, comment on lines, reply, approve, merge.
// Reading uses the read token, every write the separately saved write token (ci.Client.req({ write: true })).
// Ported from ChangeRequests.swift.
const { Client, CIError } = require('./ci');

const validBranch = (b) => typeof b === 'string' && /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/.test(b) && !b.includes('..');
const num = (n) => { const v = Number(n); if (!Number.isInteger(v) || v <= 0) throw new CIError('Invalid number', 0); return v; };

const { parse: parseDiff, hunkHeader, counts } = require('../renderer/diff');

function message(body) {
  try { const j = JSON.parse(body); if (typeof j.message === 'string') return j.message; if (Array.isArray(j.message)) return String(j.message[0]); if (j.error) return String(j.error); } catch { /* not JSON */ }
  return String(body || '').slice(0, 160);
}

// ---------- GitLab ----------
const glState = (s) => (s === 'merged' ? 'merged' : s === 'closed' || s === 'locked' ? 'closed' : 'open');
function glSummary(j) {
  if (!j || j.iid == null) return null;
  return { number: j.iid, title: j.title || '', author: j.author?.username || '', source: j.source_branch || '', target: j.target_branch || '', state: glState(j.state),
    draft: j.draft === true || j.work_in_progress === true, updated: j.updated_at || null, url: j.web_url || null,
    sameRepository: j.source_project_id == null || j.source_project_id === j.target_project_id };
}
function glMergeability(j, state) {
  if (state !== 'open') return { kind: 'notOpen' };
  const m = { mergeable: { kind: 'ready' }, conflict: { kind: 'conflict' }, checking: { kind: 'checking' }, unchecked: { kind: 'checking' }, preparing: { kind: 'checking' }, approvals_syncing: { kind: 'checking' },
    draft_status: { kind: 'blocked', text: 'Marked as draft' }, not_approved: { kind: 'blocked', text: 'Approvals missing' }, discussions_not_resolved: { kind: 'blocked', text: 'Unresolved threads' },
    ci_must_pass: { kind: 'blocked', text: 'Pipeline must succeed first' }, status_checks_must_pass: { kind: 'blocked', text: 'Pipeline must succeed first' }, ci_still_running: { kind: 'blocked', text: 'Pipeline still running' },
    need_rebase: { kind: 'blocked', text: 'Needs a rebase onto the target branch' }, requested_changes: { kind: 'blocked', text: 'Changes were requested' } };
  const d = j.detailed_merge_status;
  if (d) return m[d] || { kind: 'blocked', text: String(d).replace(/_/g, ' ') };
  if (j.has_conflicts === true) return { kind: 'conflict' };
  return j.merge_status === 'can_be_merged' ? { kind: 'ready' } : j.merge_status === 'cannot_be_merged' ? { kind: 'conflict' } : { kind: 'checking' };
}

// ---------- GitHub ----------
function ghSummary(j, repo) {
  if (!j || j.number == null) return null;
  const merged = j.merged_at != null || j.merged === true;
  const headRepo = j.head?.repo?.full_name;
  return { number: j.number, title: j.title || '', author: j.user?.login || '', source: j.head?.ref || '', target: j.base?.ref || '',
    state: j.state === 'open' ? 'open' : merged ? 'merged' : 'closed', draft: j.draft === true, updated: j.updated_at || null, url: j.html_url || null,
    sameRepository: headRepo ? headRepo.toLowerCase() === repo.toLowerCase() : false };
}
function ghMergeability(j, state) {
  if (state !== 'open') return { kind: 'notOpen' };
  if (j.draft === true) return { kind: 'blocked', text: 'Marked as draft' };
  switch (j.mergeable_state) {
    case 'clean': case 'has_hooks': return { kind: 'ready' };
    case 'unstable': return { kind: 'warning', text: 'Some checks are failing' };
    case 'dirty': return { kind: 'conflict' };
    case 'blocked': return { kind: 'blocked', text: 'Required reviews or checks are missing' };
    case 'behind': return { kind: 'blocked', text: 'Branch is behind the target branch' };
    case 'draft': return { kind: 'blocked', text: 'Marked as draft' };
    default: return j.mergeable === true ? { kind: 'ready' } : j.mergeable === false ? { kind: 'conflict' } : { kind: 'checking' };
  }
}
function latestVerdicts(reviews) {
  const out = {};
  for (const r of reviews || []) { const u = r.user?.login; if (u && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) out[u] = r.state; }
  return out;
}

class ChangeRequests {
  constructor(client) { this.c = client; }
  get gh() { return this.c.gh; }
  get repoPath() { return this.c.remote.path; }
  mr(n) { return `/projects/${this.c.project}/merge_requests/${num(n)}`; }
  pr(n) { return `${this.c.repo}/pulls/${num(n)}`; }

  async list(state = 'open') {
    if (!['open', 'merged', 'closed'].includes(state)) state = 'open';
    if (this.gh) {
      const r = await this.c.req('GET', `${this.c.repo}/pulls`, { query: { state: state === 'open' ? 'open' : 'closed', sort: 'updated', direction: 'desc', per_page: '50' } });
      return (r || []).map((j) => ghSummary(j, this.repoPath)).filter((x) => x && x.state === state);
    }
    const r = await this.c.req('GET', `/projects/${this.c.project}/merge_requests`, { query: { state: state === 'open' ? 'opened' : state, per_page: '50', order_by: 'updated_at' } });
    return (r || []).map(glSummary).filter(Boolean);
  }

  async detail(n) {
    if (this.gh) {
      const j = await this.c.req('GET', this.pr(n));
      const summary = ghSummary(j, this.repoPath); if (!summary) throw new CIError('No pull request in the response', 502);
      const d = { summary, body: j.body || '', mergeability: ghMergeability(j, summary.state), refs: { base: j.base?.sha || '', start: j.base?.sha || '', head: j.head?.sha || '' }, approvedBy: [], changesRequestedBy: [], pipeline: null };
      try {
        const v = latestVerdicts(await this.c.req('GET', this.pr(n) + '/reviews', { query: { per_page: '100' } }));
        d.approvedBy = Object.keys(v).filter((k) => v[k] === 'APPROVED').sort(); d.changesRequestedBy = Object.keys(v).filter((k) => v[k] === 'CHANGES_REQUESTED').sort();
      } catch { /* optional */ }
      return d;
    }
    const j = await this.c.req('GET', this.mr(n));
    const summary = glSummary(j); if (!summary) throw new CIError('No merge request in the response', 502);
    const d = { summary, body: j.description || '', mergeability: glMergeability(j, summary.state),
      refs: { base: j.diff_refs?.base_sha || '', start: j.diff_refs?.start_sha || '', head: j.diff_refs?.head_sha || j.sha || '' },
      approvedBy: [], changesRequestedBy: [], pipeline: j.head_pipeline?.status || j.pipeline?.status || null };
    try { const a = await this.c.req('GET', this.mr(n) + '/approvals'); d.approvedBy = (a.approved_by || []).map((x) => x.user?.username).filter(Boolean); } catch { /* optional */ }
    return d;
  }

  async files(n) {
    if (this.gh) {
      const r = await this.c.req('GET', this.pr(n) + '/files', { query: { per_page: '100' } });
      return (r || []).filter((f) => f.filename).map((f) => ({ path: f.filename, oldPath: f.previous_filename || f.filename,
        status: { added: 'added', removed: 'removed', renamed: 'renamed' }[f.status] || 'modified', diff: f.patch || '', added: f.additions || 0, removed: f.deletions || 0 }));
    }
    let list;
    try { list = await this.c.req('GET', this.mr(n) + '/diffs', { query: { per_page: '100' } }); } catch (e) {
      if (e.status !== 404) throw e;
      list = (await this.c.req('GET', this.mr(n) + '/changes')).changes || [];      // before GitLab 15.7
    }
    return (list || []).map((f) => {
      const c = counts(f.diff || '');
      return { path: f.new_path || '', oldPath: f.old_path || f.new_path || '', status: f.new_file ? 'added' : f.deleted_file ? 'removed' : f.renamed_file ? 'renamed' : 'modified', diff: f.diff || '', ...c };
    });
  }

  async comments(n) {
    if (this.gh) {
      const page = { query: { per_page: '100' } };
      const [issue, reviews, lines] = await Promise.all([this.c.req('GET', `${this.c.repo}/issues/${num(n)}/comments`, page), this.c.req('GET', this.pr(n) + '/reviews', page), this.c.req('GET', this.pr(n) + '/comments', page)]);
      const out = [];
      for (const c of issue || []) out.push({ id: 'i' + c.id, author: c.user?.login || '', body: c.body || '', created: c.created_at, kind: 'comment' });
      for (const r of reviews || []) {
        const kind = r.state === 'APPROVED' ? 'approved' : r.state === 'CHANGES_REQUESTED' ? 'changesRequested' : 'comment';
        if (kind === 'comment' && !r.body) continue;
        out.push({ id: 'r' + r.id, author: r.user?.login || '', body: r.body || '', created: r.submitted_at, kind });
      }
      for (const c of lines || []) {
        if (!c.path) continue;
        const left = c.side === 'LEFT'; const line = c.line ?? null;
        out.push({ id: 'c' + c.id, author: c.user?.login || '', body: c.body || '', created: c.created_at, kind: 'comment',
          anchor: { path: c.path, oldPath: c.path, oldLine: left ? line : null, newLine: left ? null : line }, thread: String(c.in_reply_to_id || c.id), outdated: line == null });
      }
      return out.sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')));
    }
    const ds = await this.c.req('GET', this.mr(n) + '/discussions', { query: { per_page: '100' } });
    const out = [];
    for (const d of ds || []) {
      const thread = d.individual_note ? null : d.id;
      for (const note of d.notes || []) {
        const p = note.position;
        const anchor = p && (p.new_path || p.old_path) ? { path: p.new_path || p.old_path, oldPath: p.old_path || p.new_path, oldLine: p.old_line ?? null, newLine: p.new_line ?? null } : null;
        const system = note.system === true;
        out.push({ id: String(note.id), author: note.author?.username || '', body: note.body || '', created: note.created_at,
          kind: !system ? 'comment' : note.body === 'approved this merge request' ? 'approved' : 'system', anchor, thread: system ? null : thread });
      }
    }
    return out;
  }

  /** A general comment, or one on a diff line when `anchor` is set. */
  async comment(n, body, anchor, refs = {}) {
    body = String(body || '').trim(); if (!body) throw new CIError('The comment is empty.', 0);
    if (this.gh) {
      if (!anchor) return this.c.req('POST', `${this.c.repo}/issues/${num(n)}/comments`, { write: true, body: { body } });
      const line = anchor.newLine ?? anchor.oldLine; if (line == null) throw new CIError('No line', 0);
      return this.c.req('POST', this.pr(n) + '/comments', { write: true, body: { body, commit_id: refs.head, path: anchor.path, line, side: anchor.newLine != null ? 'RIGHT' : 'LEFT' } });
    }
    if (!anchor) return this.c.req('POST', this.mr(n) + '/notes', { write: true, body: { body } });
    const position = { position_type: 'text', base_sha: refs.base, start_sha: refs.start, head_sha: refs.head, new_path: anchor.path, old_path: anchor.oldPath || anchor.path };
    if (anchor.newLine != null) position.new_line = anchor.newLine;
    if (anchor.oldLine != null) position.old_line = anchor.oldLine;
    return this.c.req('POST', this.mr(n) + '/discussions', { write: true, body: { body, position } });
  }

  async reply(n, thread, body) {
    body = String(body || '').trim(); if (!body) throw new CIError('The reply is empty.', 0);
    if (this.gh) { if (!/^\d{1,20}$/.test(String(thread))) throw new CIError('Invalid thread', 0); return this.c.req('POST', `${this.pr(n)}/comments/${thread}/replies`, { write: true, body: { body } }); }
    if (!/^[0-9a-f]{8,64}$/.test(String(thread))) throw new CIError('Invalid thread', 0);
    return this.c.req('POST', `${this.mr(n)}/discussions/${thread}/notes`, { write: true, body: { body } });
  }

  /** verdict: approve | requestChanges | comment */
  async review(n, verdict, body = '') {
    if (this.gh) {
      const event = { approve: 'APPROVE', requestChanges: 'REQUEST_CHANGES', comment: 'COMMENT' }[verdict];
      if (!event) throw new CIError('Invalid review', 0);
      return this.c.req('POST', this.pr(n) + '/reviews', { write: true, body: { event, body: String(body || '') } });
    }
    if (verdict === 'requestChanges') throw new CIError('GitLab has no "request changes" through the API. Leave a comment instead.', 422);
    if (verdict === 'approve') await this.c.req('POST', this.mr(n) + '/approve', { write: true });
    if (String(body || '').trim()) await this.c.req('POST', this.mr(n) + '/notes', { write: true, body: { body: String(body) } });
    return null;
  }

  /** Merges only the reviewed head: the server refuses when the branch moved on. */
  async merge(n, { method = 'merge', deleteSource = false } = {}, detail) {
    const head = detail?.refs?.head || '';
    if (this.gh) {
      if (!['merge', 'squash', 'rebase'].includes(method)) method = 'merge';
      await this.c.req('PUT', this.pr(n) + '/merge', { write: true, body: { merge_method: method, ...(head ? { sha: head } : {}) } });
      const branch = detail?.summary?.source;
      if (deleteSource && detail?.summary?.sameRepository && validBranch(branch)) {
        await this.c.req('DELETE', `${this.c.repo}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, { write: true }).catch(() => null);
      }
      return;
    }
    await this.c.req('PUT', this.mr(n) + '/merge', { write: true, body: { squash: method === 'squash', should_remove_source_branch: Boolean(deleteSource), ...(head ? { sha: head } : {}) } });
  }
}

/** Errors in terms of change requests (the CI texts talk about pipelines). */
function describe(e, provider, writing) {
  const s = e && e.status;
  if (provider === 'github') {
    if (s === 403 || s === 404) return writing ? 'GitHub refused (403/404). The write token needs "Pull requests: Read and write" - and "Contents: Read and write" to merge.' : 'GitHub refused (403/404). The read token needs "Pull requests: Read-only" for this repository.';
    if (s === 405 || s === 409) return `GitHub cannot merge this pull request: ${e.message}`;
  } else if (s === 403) return 'GitLab refused (403). This needs a token with the "api" scope and at least Developer access.';
  return String((e && e.message) || e);
}

module.exports = { ChangeRequests, parseDiff, hunkHeader, counts, message, glSummary, ghSummary, glMergeability, ghMergeability, latestVerdicts, describe, Client };
