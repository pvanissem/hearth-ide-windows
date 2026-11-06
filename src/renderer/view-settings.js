'use strict';
// Settings dialog: General (language, theme, overview), Sandbox, Credentials, About (updates).
(() => {
  const save = async (patch) => { state.settings = await window.hearth.setSettings({ ...state.settings, ...patch }); return state.settings; };

  bindTabs('#set-tabs', 'set-');
  // Theme choices
  for (const [id, name] of Themes.list) $('#set-theme').append(el('option', { value: id }, id === 'system' ? 'System' : name));
  // Live preview of language and theme
  $('#set-theme').addEventListener('change', (e) => Themes.apply(e.target.value));
  $('#set-language').addEventListener('change', (e) => { I18n.set(e.target.value); renderInbox(); showSandboxState(); });

  const foldersToText = (f) => f.map((x) => (x.write ? '+' : '') + x.path).join('\n');
  const textToFolders = (s) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => (l.startsWith('+') ? { path: l.slice(1).trim(), write: true } : { path: l, write: false }));

  async function loadCreds() {
    const c = await window.hearth.creds.list();
    const tokens = $('#cred-tokens'); tokens.replaceChildren();
    for (const tk of c.tokens) {
      const b = el('button', { type: 'button', class: 'ghost' }, t('Remove'));
      b.addEventListener('click', async () => { await window.hearth.creds.deleteToken(tk.host, tk.writing); loadCreds(); });
      tokens.append(el('div', { class: 'cred' }, el('span', {}, `${tk.host}  (${tk.writing ? t('write') : t('read')})`), b));
    }
    if (!c.tokens.length) tokens.append(el('div', { class: 'hint' }, t('No tokens saved.')));
    const env = $('#cred-env'); env.replaceChildren();
    for (const name of c.env) {
      const b = el('button', { type: 'button', class: 'ghost' }, t('Remove'));
      b.addEventListener('click', async () => { await window.hearth.creds.deleteEnv(name); loadCreds(); });
      env.append(el('div', { class: 'cred' }, el('span', {}, `${name} = ********`), b));
    }
    if (!c.env.length) env.append(el('div', { class: 'hint' }, t('No variables saved.')));
    if (!c.available) tokens.prepend(el('div', { class: 'hint danger' }, t('Windows secret storage is not available.')));
  }
  $('#cred-add').addEventListener('click', async () => {
    try {
      await window.hearth.creds.saveToken($('#cred-host').value.trim(), $('#cred-write').value === 'write', $('#cred-token').value);
      $('#cred-token').value = ''; loadCreds();
    } catch (err) { alert(errMsg(err)); }
  });
  $('#env-add').addEventListener('click', async () => {
    try { await window.hearth.creds.setEnv($('#env-name').value.trim(), $('#env-value').value); $('#env-name').value = ''; $('#env-value').value = ''; loadCreds(); }
    catch (err) { alert(errMsg(err)); }
  });

  async function open() {
    const s = state.settings = await window.hearth.getSettings();
    state.env = await window.hearth.detect(true);
    $('#set-language').value = s.language; $('#set-theme').value = s.theme; $('#set-journal').checked = s.journal;
    $('#set-domains').value = s.domains.join('\n'); $('#set-ports').value = s.ports.join(', '); $('#set-folders').value = foldersToText(s.folders);
    $('#set-network').value = s.network; $('#set-ssh').checked = s.gitSSH; $('#set-backend').value = s.backend; $('#set-unsandboxed').checked = s.allowUnsandboxed;
    const e = state.env;
    $('#env-info').textContent = e.backend === 'native' ? t('Sandbox: native Windows AppContainer (WSL2 not required)') : e.backend === 'wsl' ? t('Sandbox: nono in WSL2 ({distro})', { distro: e.distro }) : e.reason;
    $('#about-version').textContent = `Hearth IDE for Windows ${await window.hearth.version()}`;
    $('#update-result').textContent = '';
    await loadCreds();
    $('#dlg-settings').showModal();
  }
  $('#btn-settings').addEventListener('click', open);

  $('#btn-save-settings').addEventListener('click', async () => {
    await save({
      language: $('#set-language').value, theme: $('#set-theme').value, journal: $('#set-journal').checked,
      domains: $('#set-domains').value.split(/\s+/).filter(Boolean), ports: $('#set-ports').value.split(/[,\s]+/).filter(Boolean).map(Number),
      folders: textToFolders($('#set-folders').value), network: $('#set-network').value, gitSSH: $('#set-ssh').checked, backend: $('#set-backend').value,
      allowUnsandboxed: $('#set-unsandboxed').checked,
    });
    showSandboxState();
  });
  // Closing without saving restores the saved theme/language
  $('#dlg-settings').addEventListener('close', () => { if (state.settings) { Themes.apply(state.settings.theme); I18n.set(state.settings.language); renderInbox(); showSandboxState(); } });

  $('#btn-update').addEventListener('click', async () => {
    const out = $('#update-result'); out.textContent = t('Checking...');
    const r = await window.hearth.checkUpdate();
    if (r.error) out.textContent = r.error;
    else if (r.note) out.textContent = r.note;
    else if (r.newer) { out.textContent = ''; out.append(`${t('Version {v} is available.', { v: r.latest })} `, el('a', { href: '#' }, t('Open release')));
      out.lastChild.addEventListener('click', (e) => { e.preventDefault(); window.hearth.open(r.url); }); }
    else out.textContent = t('You have the latest version ({v}).', { v: r.current });
  });
})();
