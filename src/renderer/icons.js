'use strict';
// Line icons (24x24, stroke = currentColor), drawn in the style of Lucide (ISC). Icons.html('name') -> SVG markup,
// Icons.el('name') -> element. File icons are chosen by extension (Icons.forFile).
(() => {
  const P = {
    sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    code: '<path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/><path d="M13.5 5l-3 14"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.5 0 4.5 2 4.5 4.5"/>',
    braces: '<path d="M8 4c-2 0-3 1-3 3v3c0 1.2-.8 2-2 2 1.2 0 2 .8 2 2v3c0 2 1 3 3 3"/><path d="M16 4c2 0 3 1 3 3v3c0 1.2.8 2 2 2-1.2 0-2 .8-2 2v3c0 2-1 3-3 3"/>',
    diamond: '<path d="M12 2.5l8.5 9.5-8.5 9.5L3.5 12z"/>',
    terminal: '<path d="M4 17l6-5-6-5"/><path d="M12 19h8"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'folder-open': '<path d="M3 8V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 10h18l-1.5 8a2 2 0 0 1-2 1.7H6.5a2 2 0 0 1-2-1.7z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    'file-code': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10 13l-2 2 2 2"/><path d="M14 13l2 2-2 2"/>',
    'file-json': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10 12c-1 0-1.5.5-1.5 1.5v.5c0 .6-.4 1-1 1 .6 0 1 .4 1 1v.5c0 1 .5 1.5 1.5 1.5"/><path d="M14 12c1 0 1.5.5 1.5 1.5v.5c0 .6.4 1 1 1-.6 0-1 .4-1 1v.5c0 1-.5 1.5-1.5 1.5"/>',
    'file-text': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/>',
    'git-branch': '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    'git-commit': '<circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/>',
    'git-merge': '<circle cx="6" cy="6" r="2.6"/><circle cx="18" cy="14" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M6 8.6v6.8"/><path d="M8.5 7c5 0 7.5 2 8.5 4.5"/>',
    'git-pr': '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M6 8.6v6.8"/><path d="M18 15.4V9a2 2 0 0 0-2-2h-3"/><path d="M15 4l-2.5 3L15 10"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5l-4.9-4.9"/>',
    sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1.5 14h5"/><path d="M9.5 8h5"/><path d="M17.5 16h5"/>',
    play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
    x: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    'chevron-right': '<path d="M9 6l6 6-6 6"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
    'x-circle': '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/>',
    'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.2v.1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
    flask: '<path d="M10 2.5v7L4.2 19a1.2 1.2 0 0 0 1 1.8h13.6a1.2 1.2 0 0 0 1-1.8L14 9.5v-7"/><path d="M8.5 2.5h7"/><path d="M7 15h10"/>',
    workflow: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/><path d="M6.7 10.5v3a2 2 0 0 0 2 2h4.8"/>',
    tree: '<path d="M4 5h5"/><path d="M11 5h9"/><path d="M8 12h3"/><path d="M13 12h7"/><path d="M8 19h3"/><path d="M13 19h7"/><path d="M6 5v14"/><path d="M6 12h2"/><path d="M6 19h2"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    shield: '<path d="M12 3l8 3v6c0 4.8-3.3 7.8-8 9-4.700-1.200-8-4.200-8-9V6z"/>',
    download: '<path d="M12 3v12"/><path d="M7 10.5l5 5 5-5"/><path d="M5 21h14"/>',
    upload: '<path d="M12 21V9"/><path d="M7 13.5l5-5 5 5"/><path d="M5 3h14"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7"/><path d="M8 21v-7h8v7"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    undo: '<path d="M4 9h11a5 5 0 0 1 0 10H8"/><path d="M8 5L4 9l4 4"/>',
    'help-circle': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17v.1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.600 3.800 5.600 3.800 9S14.500 18.400 12 21c-2.500-2.600-3.800-5.600-3.800-9S9.500 5.600 12 3z"/>',
    package: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3.300 7.500L12 12.500l8.700-5"/><path d="M12 12.500V21"/>',
  };

  const html = (name, size = 16, cls = '') => `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.file}</svg>`;
  const el = (name, size = 16, cls = '') => { const t = document.createElement('span'); t.className = 'ico-wrap'; t.innerHTML = html(name, size, cls); return t; };

  const FILE_BY_EXT = { json: 'file-json', md: 'file-text', txt: 'file-text', js: 'file-code', mjs: 'file-code', cjs: 'file-code', ts: 'file-code', tsx: 'file-code', jsx: 'file-code', java: 'file-code', kt: 'file-code',
    py: 'file-code', go: 'file-code', rs: 'file-code', swift: 'file-code', cs: 'file-code', c: 'file-code', h: 'file-code', cpp: 'file-code', html: 'file-code', css: 'file-code', xml: 'file-code', yml: 'file-code', yaml: 'file-code', sh: 'file-code', sql: 'file-code' };
  const forFile = (name) => FILE_BY_EXT[String(name).split('.').pop().toLowerCase()] || 'file';

  const AGENT = { claude: 'sparkles', codex: 'code', copilot: 'users', opencode: 'braces', gemini: 'diamond', shell: 'terminal' };

  window.Icons = { html, el, forFile, agent: (kind) => AGENT[kind] || 'terminal', names: Object.keys(P) };
})();
