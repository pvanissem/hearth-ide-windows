'use strict';
// Architecture: Mermaid diagrams found in the project's Markdown and .mmd files.
(() => {
  let found = []; let n = 0;
  const themeName = () => (document.documentElement.dataset.theme === 'light' ? 'default' : 'dark');

  function initMermaid() {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: themeName(), fontFamily: 'Segoe UI, sans-serif' });
  }

  async function load() {
    const s = cur(); const view = $('#arch-view'); const sel = $('#arch-file');
    view.replaceChildren(); sel.replaceChildren();
    if (!s) { view.append(el('div', { class: 'hint' }, t('No session selected'))); return; }
    try { found = await window.hearth.arch.scan(s.directory); } catch (err) { view.append(el('div', { class: 'hint' }, errMsg(err))); return; }
    if (!found.length) { view.append(el('div', { class: 'hint' }, t('No Mermaid diagrams found. Put ```mermaid blocks into your Markdown files (docs/architecture.md) or use .mmd files.'))); return; }
    found.forEach((f, i) => sel.append(el('option', { value: String(i) }, `${f.rel} (${f.blocks.length})`)));
    draw(0);
  }

  async function draw(i) {
    const view = $('#arch-view'); view.replaceChildren();
    const f = found[i]; if (!f) return;
    initMermaid();
    for (const b of f.blocks) {
      const box = el('div', { class: 'mm' }, b.title ? el('h4', {}, b.title) : '');
      view.append(box);
      try {
        const { svg } = await mermaid.render(`mm-${++n}`, b.code);
        const holder = el('div', {}); holder.innerHTML = svg; box.append(holder);   // mermaid output is sanitized (securityLevel strict)
      } catch (err) { box.append(el('pre', { class: 'tmsg' }, `${t('Diagram error')}: ${errMsg(err)}`)); document.getElementById(`dmm-${n}`)?.remove(); }
    }
  }

  $('#arch-file').addEventListener('change', (e) => draw(Number(e.target.value)));
  $('#arch-reload').addEventListener('click', load);
  document.addEventListener('hearth:select', load);
  document.addEventListener('hearth:tab', (e) => { if (e.detail === 'arch') load(); });
  Themes.onChange(() => { if ($('#insp-arch').classList.contains('active')) draw(Number($('#arch-file').value || 0)); });
})();
