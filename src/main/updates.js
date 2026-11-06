'use strict';
// "Check for updates": compares the running version with the latest GitHub release.
const REPO = 'pvanissem/hearth-ide-windows';

/** Compare "1.2.3" style versions: 1 if a > b, -1 if a < b, 0 if equal. */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function check(current, { token, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 404) return { current, latest: null, newer: false, note: 'No release published yet (or the repository is private: add a github.com token).' };
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const r = await res.json();
  const latest = String(r.tag_name || '').replace(/^v/i, '');
  return { current, latest, newer: compareVersions(latest, current) > 0, url: r.html_url };
}

module.exports = { compareVersions, check, REPO };
