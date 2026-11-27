'use strict';
// Specs: spec-driven development like Kiro. A spec goes requirements -> design -> tasks -> implementation; the agent of
// the selected session writes each document, the user reviews it here and approves it, which unlocks the next step.
// Guided mode shows a journey bar and always exactly the next step (with the agent's live status, the quality check,
// a preview and a checklist to tick before approving); free mode shows all documents as tabs.
// Documents live in the project (.hearth/specs/<name>/, .kiro/specs/ too); the main process builds every prompt.
(() => {
  const S = window.hearth.specs;
  const root = $('#specs-root');
  let data = { specs: [], steering: [] };
  let selected = null;       // spec id
  let freeTab = 'requirements';
  let lastSig = null;
  const activity = new Map(); // spec id -> { label, phase, started, before, interview, session }
  const PH = ['requirements', 'design', 'tasks'];
  const PH_TITLE = { requirements: 'Requirements', design: 'Design', tasks: 'Tasks' };
  const PH_ICON = { requirements: 'list-check', design: 'workflow', tasks: 'check-circle' };
  const KIND_ICON = { feature: 'sparkles', bugfix: 'bug', refactor: 'cycle' };
  const KIND_TITLE = { feature: 'Feature', bugfix: 'Bugfix', refactor: 'Refactoring' };
  const dir = () => cur()?.directory;
  const spec = () => data.specs.find((x) => x.id === selected) || null;
  const icon = (n, s = 14) => { const w = el('span', { class: 'ico-wrap' }); w.innerHTML = Icons.html(n, s); return w; };
  const btn = (label, cls, run, ic) => { const b = el('button', { class: cls || '' }, ...(ic ? [icon(ic)] : []), label); b.addEventListener('click', run); return b; };
  const fmtDur = (ms) => { const n = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
  const findingText = (f) => {
    const vars = { ...(f.vars || {}) };
    if (Array.isArray(vars.topics)) vars.topics = vars.topics.map((x) => t(x)).join(', ');
    return t(f.message, vars);
  };

  // ---------- tiny, safe Markdown preview (text only, no HTML from the document) ----------
  function md(text) {
    const box = el('div', { class: 'md' }); let list = null; let code = null;
    const inline = (s) => {
      const out = el('span'); const re = /(`[^`]+`|\*\*[^*]+\*\*)/g; let last = 0; let m;
      while ((m = re.exec(s))) { out.append(s.slice(last, m.index)); out.append(m[0].startsWith('`') ? el('code', {}, m[0].slice(1, -1)) : el('b', {}, m[0].slice(2, -2))); last = re.lastIndex; }
      out.append(s.slice(last)); return out;
    };
    for (const raw of String(text || '').split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (line.trim().startsWith('```')) { if (code) { box.append(code); code = null; } else { list = null; code = el('pre'); } continue; }
      if (code) { code.append(line + '\n'); continue; }
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) { list = null; box.append(el(`h${Math.min(6, h[1].length + 1)}`, {}, inline(h[2]))); continue; }
      const li = /^(\s*)([-*+]|\d+[.)])\s+(\[( |x|X)\]\s+)?(.*)$/.exec(line);
      if (li) {
        if (!list) { list = el('ul'); box.append(list); }
        const item = el('li', { style: `margin-left:${Math.floor(li[1].length / 2) * 16}px` });
        if (li[3]) item.append(el('span', { class: `cb ${li[4] !== ' ' ? 'on' : ''}` }, li[4] !== ' ' ? '✓' : ''));
        else if (/\d/.test(li[2])) item.append(el('span', { class: 'nr' }, li[2] + ' '));
        item.append(inline(li[5])); list.append(item); continue;
      }
      list = null;
      if (line.trim()) box.append(el('p', {}, inline(line)));
    }
    if (code) box.append(code);
    return box;
  }

  // ---------- data ----------
  async function refresh(force = false) {
    const d = dir();
    if (!d) { data = { specs: [], steering: [] }; draw(force); return; }
    try { data = await S.scan(d); } catch { data = { specs: [], steering: [] }; }
    if (d !== dir()) return;
    if (!spec()) selected = data.specs[0]?.id || null;
    // the agent finished a step: its turn is over and the document changed (or it waits for answers)
    for (const [id, a] of activity) {
      const s = data.specs.find((x) => x.id === id); const sess = state.sessions.get(a.session);
      const busy = sess && (sess.status === 'running' || sess.status === 'starting' || sess.status === 'needs-input');
      if (busy) a.seenBusy = true;
      const changed = Boolean(a.phase && s && s.documents[a.phase] !== a.before);
      const over = !busy && (a.seenBusy || Date.now() - a.started > 20000);
      if (!sess || sess.exited || (over && (!a.interview || changed))) activity.delete(id);
    }
    draw(force);
  }
  function draw(force) {
    const s = spec(); const a = s && activity.get(s.id); const sess = a && state.sessions.get(a.session);
    const sig = JSON.stringify([dir(), I18n.lang, data, selected, freeTab, a && { ...a, st: sess?.status }, cur()?.status]);
    const typing = root.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!force && (sig === lastSig || typing)) { tickTimers(); return; }
    lastSig = sig;
    const top = root.scrollTop;
    root.replaceChildren(...build());
    root.scrollTop = top;
    Layout.badge('specs', data.specs.length ? String(data.specs.length) : '');
    tickTimers();
  }
  function tickTimers() { for (const n of root.querySelectorAll('[data-since]')) n.textContent = fmtDur(Date.now() - Number(n.dataset.since)); }
  setInterval(tickTimers, 1000);

  // ---------- sending a step to the agent ----------
  async function send(action, opts = {}, track = null) {
    const s = cur(); const sp = spec();
    if (!s || s.exited) { alert(t('Start an agent in this folder first: the spec steps go to the agent of the selected session.')); return; }
    try {
      await S.send({ dir: s.directory, sessionId: s.id, id: sp ? sp.id : null, action, opts });
      if (track && sp) activity.set(sp.id, { label: track.label, vars: track.vars || {}, phase: track.phase || null, started: Date.now(), before: track.phase ? sp.documents[track.phase] : null, interview: Boolean(track.interview), session: s.id });
      toast(t('Sent to {name}', { name: s.name }));
      refresh(true);
    } catch (err) { alert(errMsg(err)); }
  }
  const write = (phase, opts = {}) => send(phase, opts, { label: { requirements: 'writes the requirements', design: 'writes the design', tasks: 'writes the tasks' }[phase], phase, interview: Boolean(opts.clarify) });
  async function approve(phase) {
    try { await S.approve(dir(), selected, phase); toast(t('{doc} approved', { doc: t(PH_TITLE[phase]) })); await refresh(true); } catch (err) { alert(errMsg(err)); }
  }
  function revise(phase) {
    const fb = prompt(t('What should the agent change in the {doc}?', { doc: t(PH_TITLE[phase]) }));
    if (fb && fb.trim()) send('revise', { phase, feedback: fb.trim() }, { label: 'revises the document', phase });
  }
  const openDoc = (phase) => { const sp = spec(); openFile(`${sp.folder}\\${phase}.md`); };

  // ---------- building ----------
  function build() {
    const d = dir();
    if (!d) return [el('div', { class: 'empty-note' }, el('h3', {}, t('Specs')), el('p', { class: 'hint' }, t('Select a session: specs belong to its project folder.')))];
    const bar = el('div', { class: 'spec-bar' });
    if (data.specs.length) {
      const sel = el('select', {}, ...data.specs.map((x) => el('option', { value: x.id }, `${x.name}${x.complete ? ' ✓' : ''}`)));
      sel.value = selected || ''; sel.addEventListener('change', () => { selected = sel.value; draw(true); });
      bar.append(sel);
    }
    bar.append(btn(t('New spec'), 'ghost', newSpec, 'plus'), el('span', { class: 'spacer' }), btn('', 'ib', () => refresh(true), 'refresh'));
    const out = [bar];
    if (!data.steering.length) {
      out.push(el('div', { class: 'spec-note' }, icon('help-circle'), el('span', {}, t('No steering documents yet (product, tech, structure). They give every spec step the context of your project.')),
        btn(t('Let the agent write them'), 'ghost', () => send('steering', {}, null))));
    }
    const sp = spec();
    if (!sp) {
      out.push(el('div', { class: 'empty-note' }, el('h3', {}, t('Spec-driven development')),
        el('p', { class: 'hint' }, t('Turn an idea into requirements, a design and a task list, approve each step, then let the agent implement task by task.')),
        btn(t('New spec'), 'primary', newSpec, 'sparkles')));
      return out;
    }
    const head = el('div', { class: 'spec-head' }, icon(KIND_ICON[sp.record.kind], 18), el('div', { style: 'min-width:0;flex:1' }, el('b', {}, sp.name), el('div', { class: 'hint' }, `${t(KIND_TITLE[sp.record.kind])} · ${sp.rel}`)));
    const seg = el('span', { class: 'seg' });
    for (const [guided, label] of [[true, 'Guided'], [false, 'Free']]) {
      const b = el('button', { class: sp.record.guided === guided ? 'on' : '' }, t(label));
      b.addEventListener('click', async () => { await S.update(dir(), sp.id, { guided }); refresh(true); });
      seg.append(b);
    }
    head.append(seg);
    out.push(head, ...(sp.record.guided ? guided(sp) : free(sp)));
    return out;
  }

  /** What the agent is doing for this spec right now. */
  function liveStatus(sp) {
    const a = activity.get(sp.id); if (!a) return null;
    const s = state.sessions.get(a.session); if (!s) return null;
    if (s.status === 'needs-input' || (a.interview && s.status !== 'running' && s.status !== 'starting')) {
      return el('div', { class: 'spec-live wait' }, icon('message', 16), el('span', {}, t('The agent is waiting for you - answer in the chat.')), btn(t('Open chat'), 'ghost', () => { select(s.id); showCenter('agent'); }));
    }
    if (s.status === 'running' || s.status === 'starting') {
      return el('div', { class: 'spec-live' }, el('span', { class: 'flame' }), el('span', {}, `${t('The agent')} ${t(a.label, a.vars)}… `, el('span', { class: 'hint' }, t('working for') + ' '), el('span', { class: 'mono', 'data-since': String(a.started) })));
    }
    return null;
  }

  // ---------- guided ----------
  function journey(sp) {
    const steps = [...PH, 'impl'];
    const now = sp.implementing ? 'impl' : sp.currentPhase;
    const bar = el('div', { class: 'journey' });
    steps.forEach((p, i) => {
      const done = p === 'impl' ? sp.complete : sp.status[p] === 'approved';
      const on = p === now;
      const stepEl = el('div', { class: `jstep ${done ? 'done' : ''} ${on ? 'on' : ''} ${!done && !on ? 'locked' : ''}` },
        el('span', { class: 'jdot' }, done ? '✓' : String(i + 1)), el('span', {}, t(p === 'impl' ? 'Implementation' : PH_TITLE[p])));
      bar.append(stepEl);
      if (i < steps.length - 1) bar.append(el('span', { class: `jline ${done ? 'done' : ''}` }));
    });
    return bar;
  }
  const WHAT = {
    requirements: 'User stories with acceptance criteria in EARS notation (WHEN … THEN the system SHALL …), edge cases and open questions. No code.',
    design: 'Architecture, components and interfaces, data models, error handling and testing strategy, and how each requirement is met.',
    tasks: 'A checklist of small, testable coding steps, each linked to the acceptance criteria it covers.',
  };
  function guided(sp) {
    const out = [journey(sp)];
    const live = liveStatus(sp);
    if (sp.implementing) { out.push(...implementation(sp, live)); return out; }
    const p = sp.currentPhase; const st = sp.status[p];
    const card = el('div', { class: 'spec-card' }, el('div', { class: 'sc-title' }, icon(PH_ICON[p], 16), el('b', {}, t(PH_TITLE[p]))));
    if (live) card.append(live);
    if (st === 'missing') {
      card.append(el('p', { class: 'hint' }, t('What you get:') + ' ' + t(WHAT[p])));
      if (!live) {
        const clarify = el('input', { type: 'checkbox' });
        if (p === 'requirements') card.append(el('label', { class: 'check' }, clarify, el('span', {}, t('Let the agent ask up to 5 questions first'))));
        card.append(el('div', { class: 'row' }, btn(t('Let the agent write it'), 'primary', () => write(p, { clarify: clarify.checked }), 'sparkles')));
      }
      out.push(card); return out;
    }
    if (st === 'changed') card.append(el('div', { class: 'spec-note warn' }, t('Changed since the approval: please look at it again.')));
    // quality check
    const fs = sp.analysis.findings.filter((f) => f.phase === p);
    card.append(findings(fs, p));
    // preview
    const prev = el('details', { class: 'spec-doc', open: '' }, el('summary', {}, t('Document'), el('span', { class: 'spacer' }), btn(t('Open in editor'), 'ghost', (e) => { e.preventDefault(); openDoc(p); }, 'file-code')), md(sp.documents[p]));
    card.append(prev);
    // checklist
    const ticks = new Set(sp.record.checks[p] || []);
    const items = sp.checklists[p];
    const cl = el('div', { class: 'spec-check' }, el('h4', {}, t('Before you approve')));
    items.forEach((text, i) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = ticks.has(i);
      cb.addEventListener('change', async () => { await S.update(dir(), sp.id, { check: { phase: p, index: i, on: cb.checked } }); refresh(true); });
      cl.append(el('label', { class: 'check' }, cb, el('span', {}, t(text))));
    });
    card.append(cl);
    const allTicked = items.every((_, i) => ticks.has(i));
    const next = PH[PH.indexOf(p) + 1];
    const ok = btn(next ? t('Approve → {doc}', { doc: t(PH_TITLE[next]) }) : t('Approve → Implementation'), 'primary', async () => {
      await approve(p);
      if (next) { const sp2 = spec(); if (sp2 && sp2.status[next] === 'missing' && confirm(t('Let the agent write the {doc} now?', { doc: t(PH_TITLE[next]) }))) write(next); }
    }, 'check');
    ok.disabled = !allTicked || Boolean(live);
    if (!allTicked) ok.title = t('Tick the checklist first');
    card.append(el('div', { class: 'row wrap' }, ok, btn(t('Revise...'), '', () => revise(p), 'message'), btn(t('Write again'), 'ghost', () => { if (confirm(t('Let the agent write the {doc} again?', { doc: t(PH_TITLE[p]) }))) write(p); }, 'refresh')));
    out.push(card);
    return out;
  }

  function findings(list, p) {
    const box = el('div', { class: 'spec-findings' });
    if (!list.length) { box.append(el('div', { class: 'qf ok' }, icon('check-circle'), t('Quality check: nothing found.'))); return box; }
    box.append(el('h4', {}, t('Quality check')));
    for (const f of list) {
      const row = el('div', { class: `qf ${f.severity}` }, icon(f.severity === 'issue' ? 'alert-circle' : 'help-circle'), el('span', { class: 'qt' }, findingText(f)));
      if (f.answerQuestions) row.append(btn(t('Go through them with the agent'), 'ghost', () => send('questions', {}, { label: 'asks you the open questions', phase: p, interview: true })));
      else if (f.fix) row.append(btn(t('Let the agent fix it'), 'ghost', () => send('fix', { finding: f.id }, { label: 'fixes the document', phase: f.phase })));
      box.append(row);
    }
    return box;
  }

  function ring(done, total) {
    const r = 26; const c = 2 * Math.PI * r; const frac = total ? done / total : 0;
    const w = el('div', { class: 'ring' });
    w.innerHTML = `<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" class="rb"/><circle cx="32" cy="32" r="${r}" class="rf" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" transform="rotate(-90 32 32)"/></svg>`;
    w.append(el('span', {}, `${done}/${total}`));
    return w;
  }

  function taskList(sp) {
    const box = el('div', { class: 'spec-tasks' });
    for (const task of sp.tasks) {
      const cb = el('input', { type: 'checkbox' }); cb.checked = task.done;
      cb.addEventListener('change', async () => { await S.setTask(dir(), sp.id, task.line, cb.checked); refresh(true); });
      const row = el('div', { class: `stask ${task.done ? 'done' : ''}`, style: `padding-left:${8 + task.depth * 18}px` }, cb, el('span', { class: 'tid' }, task.id.startsWith('L') ? '' : task.id),
        el('span', { class: 'tt', title: task.details.join('\n') }, task.title), task.requirements.length ? el('span', { class: 'pill mono' }, task.requirements.join(', ')) : '');
      if (!task.done) { const run = el('button', { class: 'ib', title: t('Let the agent implement this task') }, icon('play', 13)); run.addEventListener('click', () => send('run', { line: task.line }, { label: 'implements task {id}', vars: { id: task.id } })); row.append(run); }
      box.append(row);
    }
    return box;
  }

  function coverage(sp) {
    const tr = sp.analysis.traces;
    const box = el('div', { class: 'spec-cov' });
    if (!tr.length) { box.append(el('div', { class: 'hint' }, t('No acceptance criteria found.'))); return box; }
    const planned = tr.filter((x) => x.state !== 'uncovered').length; const done = tr.filter((x) => x.state === 'done').length;
    const bar = (label, n) => el('div', { class: 'covbar' }, el('span', {}, label), el('span', { class: 'track' }, el('span', { style: `width:${Math.round((n / tr.length) * 100)}%` })), el('span', { class: 'mono' }, `${n}/${tr.length}`));
    box.append(bar(t('Planned'), planned), bar(t('Implemented'), done));
    const STATE = { uncovered: ['bad', 'open'], planned: ['', 'planned'], partial: ['warn', 'partly'], done: ['ok', 'implemented'] };
    for (const x of tr) {
      const [cls, label] = STATE[x.state];
      box.append(el('div', { class: 'covrow', title: x.criterion.text }, el('span', { class: 'mono cid' }, x.criterion.id), el('span', { class: 'ct' }, x.criterion.text),
        el('span', { class: 'hint' }, x.tasks.map((k) => k.id).join(', ')), el('span', { class: `pill ${cls}` }, t(label))));
    }
    return box;
  }

  function implementation(sp, live) {
    const out = [];
    const total = sp.tasks.length; const done = sp.tasks.filter((x) => x.done).length;
    if (live) out.push(live);
    if (sp.complete) {
      const tr = sp.analysis.traces;
      out.push(el('div', { class: 'spec-card done' }, el('div', { class: 'sc-title' }, icon('flag', 18), el('b', {}, t('Spec complete'))),
        el('p', {}, t('{tasks} tasks done, {criteria} of {all} acceptance criteria covered.', { tasks: total, criteria: tr.filter((x) => x.state === 'done').length, all: tr.length })),
        el('div', { class: 'row' }, btn(t('Check against the requirements'), 'primary', () => send('verify', {}, { label: 'checks the implementation' }), 'check-circle'))));
    } else {
      const next = sp.tasks.find((x) => !x.done && !sp.tasks.some((o) => !o.done && o.depth > x.depth && o.id.startsWith(x.id + '.'))) || sp.tasks.find((x) => !x.done);
      const crit = next ? sp.analysis.traces.filter((x) => next.requirements.some((r) => r === x.criterion.id || r === x.criterion.id.split('.')[0])) : [];
      out.push(el('div', { class: 'spec-impl' }, ring(done, total), el('div', { style: 'min-width:0;flex:1' },
        el('h4', {}, t('Next')), next ? el('b', {}, `${next.id.startsWith('L') ? '' : next.id + ' '}${next.title}`) : el('span', { class: 'hint' }, t('No tasks found.')),
        ...(next ? next.details.slice(0, 4).map((x) => el('div', { class: 'hint' }, '· ' + x)) : []),
        crit.length ? el('div', { class: 'hint' }, t('Meets: {ids}', { ids: crit.map((x) => x.criterion.id).join(', ') })) : '',
        el('div', { class: 'row wrap', style: 'margin-top:8px' },
          next ? btn(t('Implement this task'), 'primary', () => send('run', { line: next.line }, { label: 'implements task {id}', vars: { id: next.id } }), 'play') : '',
          btn(t('All open tasks one after another'), '', () => send('runAll', {}, { label: 'works through the tasks' }), 'list-check')))));
    }
    out.push(el('h4', {}, t('Tasks')), taskList(sp), el('h4', {}, t('Coverage')), coverage(sp));
    return out;
  }

  // ---------- free ----------
  function free(sp) {
    const STATUS = { missing: ['', 'missing'], draft: ['warn', 'draft'], approved: ['ok', 'approved'], changed: ['warn', 'changed'] };
    const tabs = el('nav', { class: 'gtabs-bar' });
    for (const p of [...PH, 'coverage']) {
      const issues = p === 'coverage' ? 0 : sp.analysis.findings.filter((f) => f.phase === p && f.severity === 'issue').length;
      const b = el('button', { class: freeTab === p ? 'on' : '' }, t(p === 'coverage' ? 'Coverage' : PH_TITLE[p]),
        p !== 'coverage' ? el('span', { class: `dot ${STATUS[sp.status[p]][0]}`, title: t(STATUS[sp.status[p]][1]) }) : '', issues ? el('span', { class: 'cnt bad' }, String(issues)) : '');
      b.addEventListener('click', () => { freeTab = p; draw(true); });
      tabs.append(b);
    }
    const out = [tabs];
    const live = liveStatus(sp); if (live) out.push(live);
    if (freeTab === 'coverage') { out.push(coverage(sp)); return out; }
    const p = freeTab; const st = sp.status[p];
    const acts = el('div', { class: 'row wrap spec-acts' }, el('span', { class: `pill ${STATUS[st][0]}` }, t(STATUS[st][1])));
    if (sp.canWrite[p]) acts.append(btn(st === 'missing' ? t('Let the agent write it') : t('Write again'), st === 'missing' ? 'primary' : 'ghost', () => write(p), 'sparkles'));
    else acts.append(el('span', { class: 'hint' }, t('Approve the {doc} first.', { doc: t(PH_TITLE[PH[PH.indexOf(p) - 1]]) })));
    if (st === 'draft' || st === 'changed') acts.append(btn(t('Approve'), 'primary', () => approve(p), 'check'));
    if (st === 'approved' || st === 'changed') acts.append(btn(t('Revoke approval'), 'ghost', async () => { await S.revoke(dir(), sp.id, p); refresh(true); }));
    if (st !== 'missing') acts.append(btn(t('Revise...'), 'ghost', () => revise(p), 'message'), btn(t('Open in editor'), 'ghost', () => openDoc(p), 'file-code'));
    out.push(acts);
    if (st === 'missing') { out.push(el('p', { class: 'hint gpad' }, t(WHAT[p]))); return out; }
    out.push(findings(sp.analysis.findings.filter((f) => f.phase === p), p));
    if (p === 'tasks') {
      out.push(el('div', { class: 'row wrap gpad' }, btn(t('All open tasks one after another'), '', () => send('runAll', {}, { label: 'works through the tasks' }), 'list-check'),
        sp.complete ? btn(t('Check against the requirements'), '', () => send('verify', {}, { label: 'checks the implementation' }), 'check-circle') : ''), taskList(sp));
    } else out.push(md(sp.documents[p]));
    return out;
  }

  // ---------- new spec wizard ----------
  function newSpec() {
    if (!dir()) { alert(t('Select a session: specs belong to its project folder.')); return; }
    const dlg = el('dialog', { class: 'wide wizard' }); document.body.append(dlg);
    const v = { step: 0, name: '', idea: '', kind: 'feature', current: '', expected: '', goals: '', keep: '', guided: true, clarify: false, start: true };
    const close = () => { dlg.close(); dlg.remove(); };
    function page() {
      const steps = [t('Idea'), t('Kind'), t('Way of working')];
      const head = el('div', { class: 'wsteps' }, ...steps.map((s, i) => el('span', { class: i === v.step ? 'on' : i < v.step ? 'done' : '' }, `${i + 1}. ${s}`)));
      const body = el('div');
      const field = (label, key, area = false, ph = '') => { const inp = el(area ? 'textarea' : 'input', { rows: '4', placeholder: ph }); inp.value = v[key]; inp.addEventListener('input', () => { v[key] = inp.value; }); return el('label', {}, el('span', {}, label), inp); };
      if (v.step === 0) body.append(field(t('Name'), 'name', false, t('e.g. Export as PDF')), field(t('What should it do?'), 'idea', true, t('Describe the idea in a few sentences.')));
      if (v.step === 1) {
        const grid = el('div', { class: 'kinds' });
        for (const [k, sub] of [['feature', 'Something new: user stories and acceptance criteria.'], ['bugfix', 'Something broken: current and expected behaviour, cause, regression guard.'], ['refactor', 'Better structure, same behaviour: goals, limits, what must not change.']]) {
          const b = el('button', { type: 'button', class: `kind ${v.kind === k ? 'on' : ''}` }, icon(KIND_ICON[k], 20), el('b', {}, t(KIND_TITLE[k])), el('small', {}, t(sub)));
          b.addEventListener('click', () => { v.kind = k; render(); }); grid.append(b);
        }
        body.append(grid);
        if (v.kind === 'bugfix') body.append(field(t('Current behaviour'), 'current', true), field(t('Expected behaviour'), 'expected', true));
        if (v.kind === 'refactor') body.append(field(t('Goals'), 'goals', true), field(t('What must not change'), 'keep', true));
      }
      if (v.step === 2) {
        const grid = el('div', { class: 'kinds' });
        for (const [g, title, sub] of [[true, 'Guided', 'One step at a time: what comes next, the agent\'s status, a check before each approval.'], [false, 'Free', 'All documents at once as tabs, for people who know the workflow.']]) {
          const b = el('button', { type: 'button', class: `kind ${v.guided === g ? 'on' : ''}` }, icon(g ? 'flag' : 'board', 20), el('b', {}, t(title)), el('small', {}, t(sub)));
          b.addEventListener('click', () => { v.guided = g; render(); }); grid.append(b);
        }
        const c1 = el('input', { type: 'checkbox' }); c1.checked = v.clarify; c1.addEventListener('change', () => { v.clarify = c1.checked; });
        const c2 = el('input', { type: 'checkbox' }); c2.checked = v.start; c2.addEventListener('change', () => { v.start = c2.checked; });
        body.append(grid, el('label', { class: 'check' }, c1, el('span', {}, t('Let the agent ask up to 5 questions first'))), el('label', { class: 'check' }, c2, el('span', {}, t('Let the agent write the requirements right away'))));
        if (!cur() || cur().exited) body.append(el('p', { class: 'hint' }, t('No running agent in this session: you can start the steps later.')));
      }
      const back = el('button', { type: 'button' }, v.step ? t('Back') : t('Cancel')); back.addEventListener('click', () => { if (v.step) { v.step--; render(); } else close(); });
      const next = el('button', { type: 'button', class: 'primary' }, v.step < 2 ? t('Next') : t('Create spec'));
      next.addEventListener('click', async () => {
        if (v.step === 0 && !v.name.trim()) { alert(t('The spec needs a name')); return; }
        if (v.step < 2) { v.step++; render(); return; }
        let idea = v.idea.trim();
        if (v.kind === 'bugfix') idea += `${idea ? ' ' : ''}Current behaviour: ${v.current.trim() || '?'}. Expected behaviour: ${v.expected.trim() || '?'}.`;
        if (v.kind === 'refactor') idea += `${idea ? ' ' : ''}Goals: ${v.goals.trim() || '?'}. Must not change: ${v.keep.trim() || '?'}.`;
        try {
          selected = await S.create(dir(), { name: v.name.trim(), idea, kind: v.kind, guided: v.guided });
          close(); await refresh(true);
          if (v.start && cur() && !cur().exited) write('requirements', { clarify: v.clarify });
        } catch (err) { alert(errMsg(err)); }
      });
      return [el('h3', {}, t('New spec')), head, body, el('div', { class: 'row end', style: 'margin-top:14px' }, back, next)];
    }
    function render() { dlg.replaceChildren(...page()); }
    render(); dlg.addEventListener('cancel', () => setTimeout(() => dlg.remove(), 0)); dlg.showModal();
  }

  document.addEventListener('hearth:select', () => { selected = null; lastSig = null; refresh(true); });
  document.addEventListener('hearth:status', () => { if (Layout.isActive('specs')) refresh(); });
  document.addEventListener('hearth:lang', () => draw(true));
  document.addEventListener('hearth:tab', (e) => { if (e.detail === 'specs') refresh(true); });
  document.addEventListener('hearth:saved', () => refresh());
  setInterval(() => { if (Layout.isActive('specs') && document.hasFocus()) refresh(); }, 3000);
  window.SpecsView = { refresh, newSpec, md, get data() { return data; } };
})();
