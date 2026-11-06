'use strict';
// Overview ("Anti-Burnout"): the agent's steps, decisions and open questions as a tree. Entries can be revoked.
(() => {
  let data = null;
  let timer = null;

  const KIND = { step: '▶', decision: '⚖', question: '?' };
  const matches = (n, f) => f === 'all' || (f === 'step' && n.kind === 'step') || (f === 'decision' && n.kind === 'decision') || (f === 'question' && (n.kind === 'question' || n.open > 0));

  function render() {
    const host = $('#jr-tree');
    host.replaceChildren();
    const s = cur();
    if (!s) { host.append(el('div', { class: 'hint' }, t('No session selected'))); return; }
    if (!data || data.empty) {
      host.append(el('div', { class: 'hint' }, t('Nothing recorded yet. Claude Code and Codex get the hearth-journal command and its instruction automatically; for other agents use "Ask agent to record its work".')));
      $('#jr-current').textContent = '';
      return;
    }
    const filter = $('#jr-filter').value;
    const byId = new Map();
    const index = (nodes) => nodes.forEach((n) => { byId.set(n.id, n); index(n.children); });
    index(data.tree);
    $('#jr-current').textContent = data.current ? `${t('Now')}: ${byId.get(data.current)?.title || data.current}` : '';
    const draw = (nodes, into) => {
      for (const n of nodes) {
        const kids = n.children.filter((c) => matches(c, filter) || c.children.length);
        if (!matches(n, filter) && !kids.length) continue;
        const row = el('div', { class: `jn ${n.revoked ? 'revoked' : ''}` });
        row.append(el('div', { class: 'jt' }, el('span', {}, KIND[n.kind] || ''), el('span', { class: 'jid hint' }, n.id), el('span', {}, n.title),
          el('span', { class: `jbadge ${n.status}` }, t(n.status)), n.open ? el('span', { class: 'jbadge open' }, t('{n} open', { n: n.open })) : ''));
        if (n.why) row.append(el('div', { class: 'why' }, `${t('Why')}: ${n.why}`));
        for (const r of n.rejected) row.append(el('div', { class: 'rej' }, `${t('Rejected')}: ${r}`));
        if (n.answer) row.append(el('div', { class: 'why' }, `${t('Answer')}: ${n.answer}`));
        if (n.revoked) row.append(el('div', { class: 'why' }, `${t('Revoked')}${n.revoked.reason ? ': ' + n.revoked.reason : ''}${n.revoked.replacedBy ? ` → ${n.revoked.replacedBy}` : ''}`));
        else {
          const b = el('button', { class: 'ghost' }, t('Revoke'));
          b.addEventListener('click', () => revoke(n));
          row.append(el('div', { class: 'acts' }, b));
        }
        into.append(row);
        if (kids.length) { const box = el('div', { class: 'jkids' }); draw(kids, box); into.append(box); }
      }
    };
    draw(data.tree, host);
  }

  async function revoke(n) {
    const s = cur(); if (!s) return;
    const reason = prompt(t('Why do you revoke "{title}"? (optional)', { title: n.title }));
    if (reason === null) return;
    try {
      const text = await window.hearth.journal.revoke(s.id, n.id, reason);
      if (text) window.hearth.input(s.id, text + '\r');
      await poll();
    } catch (err) { alert(errMsg(err)); }
  }

  async function poll() {
    const s = cur();
    if (!s) { data = null; render(); return; }
    try { data = await window.hearth.journal.get(s.id); } catch { data = null; }
    render();
  }

  $('#jr-filter').addEventListener('change', render);
  $('#jr-ask').addEventListener('click', async () => {
    const s = cur(); if (!s) return;
    window.hearth.input(s.id, (await window.hearth.journal.instruction()) + '\r');
  });
  const active = () => $('#insp-overview').classList.contains('active');
  document.addEventListener('hearth:select', poll);
  document.addEventListener('hearth:tab', (e) => { if (e.detail === 'overview') poll(); });
  clearInterval(timer);
  timer = setInterval(() => { if (active() && document.hasFocus()) poll(); }, 2000);
  window.JournalView = { poll };
})();
