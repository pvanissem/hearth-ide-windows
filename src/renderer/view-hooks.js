'use strict';
// Agent Hooks (like Kiro): react to what the agent did. When its turn ends, hooks for saved / created / deleted files
// (path pattern as a regular expression) or for the end of the turn send their prompt to the agent or run a command in
// the sandbox. Hook files from the repository or written by the agent only run after the user allowed exactly that
// content. "Recently" shows what fired when.
(() => {
  const HK = window.hearth.hooks;
  const root = $('#hooks-root');
  let view = null; let lastSig = null;
  const dir = () => cur()?.directory;
  const icon = (n, s = 14) => { const w = el('span', { class: 'ico-wrap' }); w.innerHTML = Icons.html(n, s); return w; };
  const TRIG = { FileSave: ['save', 'Agent saved a file'], FileCreate: ['file-plus', 'Agent created a file'], FileDelete: ['trash', 'Agent deleted a file'], Stop: ['flag', 'Agent finished its turn'], Manual: ['hand', 'Manually'] };
  const OUT = { sent: ['ok', 'sent to the agent'], queued: ['', 'waiting for the agent'], noAgent: ['warn', 'no running agent'], commandOK: ['ok', 'command succeeded'], commandFailed: ['bad', 'command failed'], running: ['run', 'running'] };

  async function refresh(force = false) {
    const d = dir();
    if (!d) { view = null; draw(force); return; }
    try { view = await HK.get(d); } catch (err) { view = { error: errMsg(err) }; }
    if (d === dir()) draw(force);
  }
  function draw(force) {
    const sig = JSON.stringify([dir(), I18n.lang, view]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    const top = root.scrollTop;
    root.replaceChildren(...build());
    root.scrollTop = top;
    const n = view?.hooks?.filter((h) => h.enabled && h.trusted && h.supported).length || 0;
    Layout.badge('hooks', n ? String(n) : '');
  }

  const act = (fn) => async () => { try { await fn(); } catch (err) { alert(errMsg(err)); } refresh(true); };

  function build() {
    const d = dir();
    if (!d) return [el('div', { class: 'empty-note' }, el('h3', {}, t('Agent Hooks')), el('p', { class: 'hint' }, t('Select a session: hooks belong to its project folder.')))];
    if (view?.error) return [el('div', { class: 'hint gpad danger' }, view.error)];
    const bar = el('div', { class: 'spec-bar' }, el('b', {}, t('Agent Hooks')), el('span', { class: 'spacer' }));
    const add = el('button', { class: 'ghost' }, icon('plus'), t('New hook')); add.addEventListener('click', () => newHook());
    const re = el('button', { class: 'ib', title: t('Refresh') }, icon('refresh')); re.addEventListener('click', () => refresh(true));
    bar.append(add, re);
    const out = [bar];
    if (!view) return out;

    // files that need permission
    for (const f of view.files.filter((x) => !x.trusted)) {
      const allow = el('button', { class: 'primary' }, t('Allow')); allow.addEventListener('click', act(() => HK.allow(d, f.file)));
      const look = el('button', { class: 'ghost' }, t('Show')); look.addEventListener('click', () => openFile(`${d}\\${f.file.replace(/\//g, '\\')}`));
      out.push(el('div', { class: 'spec-note warn' }, icon('shield'), el('span', {}, t('{file} is not allowed yet. Hooks run prompts and commands: allow this file only if you trust its content. Every change needs a new approval.', { file: f.file })), look, allow));
    }
    for (const p of view.problems) out.push(el('div', { class: 'spec-note bad' }, icon('alert-circle'), el('span', {}, `${p.file}: ${p.message}`)));

    if (!view.hooks.length) {
      out.push(el('div', { class: 'empty-note' }, el('p', { class: 'hint' }, t('Hooks react to what the agent did: when its turn ends, Hearth looks at the files it saved, created or deleted and sends a prompt to the agent or runs a command. A turn started by a hook never triggers hooks.')),
        el('div', { class: 'tpl-grid' }, ...Object.entries(view.templates).map(([k, tp]) => { const b = el('button', { class: 'kind' }, icon(TRIG[tp.trigger][0], 16), el('b', {}, t(tp.title))); b.addEventListener('click', () => newHook(k)); return b; }))));
    }
    for (const h of view.hooks) {
      const [ic, trig] = TRIG[h.trigger] || ['alert-circle', h.rawTrigger || '?'];
      const sw = el('input', { type: 'checkbox', title: t('Enabled') }); sw.checked = h.enabled; sw.disabled = !h.supported;
      sw.addEventListener('change', act(() => HK.setEnabled(d, h.id, sw.checked)));
      const card = el('div', { class: `hook ${h.enabled && h.trusted && h.supported ? '' : 'off'}` },
        el('div', { class: 'hrow' }, icon(ic, 16), el('b', {}, h.name), el('span', { class: 'spacer' }),
          !h.supported ? el('span', { class: 'pill warn' }, t('not supported')) : !h.trusted ? el('span', { class: 'pill warn' }, t('not allowed')) : '', el('label', { class: 'switch' }, sw, el('span'))),
        el('div', { class: 'hint' }, `${t(trig)}${h.matcher ? ` · /${h.matcher}/` : ''} · ${h.file}`),
        h.description ? el('div', { class: 'hint' }, h.description) : '',
        el('div', { class: 'hbody mono' }, h.action.type === 'agent' ? h.action.prompt : h.action.type === 'command' ? `$ ${h.action.command}` : t('Unsupported action: {name}', { name: h.action.name })));
      const acts = el('div', { class: 'row' });
      if (h.supported && h.trusted) { const run = el('button', { class: 'ghost' }, icon('play', 12), t('Run now')); run.addEventListener('click', act(() => HK.run(d, h.id))); acts.append(run); }
      const open = el('button', { class: 'ghost' }, t('Edit file')); open.addEventListener('click', () => openFile(`${d}\\${h.file.replace(/\//g, '\\')}`));
      const del = el('button', { class: 'ghost' }, t('Delete')); del.addEventListener('click', act(async () => { if (confirm(t('Delete the hook "{name}"?', { name: h.name }))) await HK.remove(d, h.id); }));
      acts.append(open, del); card.append(acts);
      out.push(card);
    }
    if (view.files.some((f) => f.trusted)) {
      const m = el('div', { class: 'hint gpad' }, t('Allowed files: '));
      for (const f of view.files.filter((x) => x.trusted)) { const b = el('button', { class: 'ghost', title: t('Withdraw the permission') }, f.file, ' ×'); b.addEventListener('click', act(() => HK.disallow(d, f.file))); m.append(b); }
      out.push(m);
    }
    out.push(el('h4', {}, t('Recently')));
    if (!view.activity.length) out.push(el('div', { class: 'hint gpad' }, t('Nothing has fired yet.')));
    for (const a of view.activity) {
      const [cls, label] = OUT[a.outcome] || ['', a.outcome];
      out.push(el('div', { class: 'hact' }, el('small', { class: 'mono' }, new Date(a.date).toLocaleTimeString()), el('b', {}, a.hook), el('span', { class: 'hint', title: a.detail }, t(a.detail)),
        el('span', { class: `pill ${cls}` }, t(label) + (a.outcome === 'commandFailed' && a.code != null ? ` (${a.code})` : ''))));
    }
    return out;
  }

  function newHook(template = 'blank') {
    const d = dir(); if (!d) { alert(t('Select a session: hooks belong to its project folder.')); return; }
    const tpls = view?.templates || {};
    const dlg = el('dialog', { class: 'wide' }); document.body.append(dlg);
    const name = el('input'); const desc = el('input');
    const trig = el('select', {}, ...Object.entries(TRIG).map(([k, [, l]]) => el('option', { value: k }, t(l))));
    const matcher = el('input', { placeholder: '\\.(ts|js)$' });
    const kind = el('select', {}, el('option', { value: 'agent' }, t('Send a prompt to the agent')), el('option', { value: 'command' }, t('Run a command in the sandbox')));
    const body = el('textarea', { rows: '5' });
    const tplSel = el('select', {}, ...Object.entries(tpls).map(([k, tp]) => el('option', { value: k }, t(tp.title))));
    const apply = (k) => { const tp = tpls[k]; if (!tp) return; tplSel.value = k; name.value = k === 'blank' ? '' : t(tp.title); trig.value = tp.trigger; matcher.value = tp.matcher; kind.value = tp.command ? 'command' : 'agent'; body.value = tp.command ? tp.body : t(tp.body); sync(); };
    const mRow = el('label', {}, el('span', {}, t('Path pattern (regular expression, empty = every file)')), matcher);
    const sync = () => { mRow.hidden = !['FileSave', 'FileCreate', 'FileDelete'].includes(trig.value); body.placeholder = kind.value === 'agent' ? t('What should the agent do?') : 'npm test'; };
    trig.addEventListener('change', sync); kind.addEventListener('change', sync); tplSel.addEventListener('change', () => apply(tplSel.value));
    const cancel = el('button', { type: 'button' }, t('Cancel')); cancel.addEventListener('click', () => { dlg.close(); dlg.remove(); });
    const ok = el('button', { type: 'button', class: 'primary' }, t('Create hook'));
    ok.addEventListener('click', async () => {
      try {
        await HK.create(d, { name: name.value, description: desc.value, trigger: trig.value, matcher: matcher.value.trim(), action: kind.value === 'agent' ? { type: 'agent', prompt: body.value } : { type: 'command', command: body.value } });
        dlg.close(); dlg.remove(); refresh(true);
      } catch (err) { alert(errMsg(err)); }
    });
    dlg.append(el('h3', {}, t('New hook')), el('label', {}, el('span', {}, t('Template')), tplSel), el('label', {}, el('span', {}, t('Name')), name), el('label', {}, el('span', {}, t('Description (optional)')), desc),
      el('label', {}, el('span', {}, t('When')), trig), mRow, el('label', {}, el('span', {}, t('Then')), kind), el('label', {}, el('span', {}, t('Prompt or command')), body),
      el('p', { class: 'hint' }, t('Saved as .hearth/hooks/<name>.json in the project (Kiro format).')), el('div', { class: 'row end' }, cancel, ok));
    apply(template);
    dlg.addEventListener('cancel', () => setTimeout(() => dlg.remove(), 0));
    dlg.showModal();
  }

  HK.onChange(() => { if (Layout.isActive('hooks')) refresh(); });
  document.addEventListener('hearth:select', () => { lastSig = null; refresh(true); });
  document.addEventListener('hearth:lang', () => draw(true));
  document.addEventListener('hearth:tab', (e) => { if (e.detail === 'hooks') refresh(true); });
  document.addEventListener('hearth:saved', () => refresh());
  window.HooksView = { refresh, newHook };
})();
