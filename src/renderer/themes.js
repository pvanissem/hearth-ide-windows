'use strict';
// Themes ported from AppAppearance.swift: System (follows Windows), Hearth Light, Darcula, Storm.
// One palette colours the panes, the Monaco editor, the syntax and the terminals.
(() => {
  const hex = (v) => '#' + v.toString(16).padStart(6, '0');
  const P = (o) => ({ ...o, ansi: o.ansi.map(hex) });
  const palettes = {
    darcula: P({
      dark: true, window: 0x3C3F41, pane: 0x3C3F41, editorBackground: 0x2B2B2B, editorForeground: 0xA9B7C6, gutter: 0x313335, gutterText: 0x606366,
      selection: 0x214283, caret: 0xBBBBBB, accent: 0x4A88C7, keyword: 0xCC7832, type: 0xA9B7C6, string: 0x6A8759, number: 0x6897BB, comment: 0x808080,
      attribute: 0xBBB529, function: 0xFFC66D, key: 0x9876AA, tag: 0xE8BF6A, punctuation: 0xCC7832, heading: 0xCC7832,
      ansi: [0x000000, 0xFF6B68, 0xA8C023, 0xD6BF55, 0x5394EC, 0xAE8ABE, 0x299999, 0x999999, 0x555555, 0xFF8785, 0xB6D95F, 0xFFFF00, 0x7EAEF1, 0xFF99FF, 0x6CDADA, 0xFFFFFF],
    }),
    storm: P({
      dark: true, window: 0x1F2335, pane: 0x1F2335, editorBackground: 0x24283B, editorForeground: 0xC0CAF5, gutter: 0x1F2335, gutterText: 0x3B4261,
      selection: 0x364A82, caret: 0xC0CAF5, accent: 0x7AA2F7, keyword: 0xBB9AF7, type: 0x2AC3DE, string: 0x9ECE6A, number: 0xFF9E64, comment: 0x565F89,
      attribute: 0xE0AF68, function: 0x7AA2F7, key: 0x73DACA, tag: 0xF7768E, punctuation: 0x89DDFF, heading: 0x7AA2F7,
      ansi: [0x1D202F, 0xF7768E, 0x9ECE6A, 0xE0AF68, 0x7AA2F7, 0xBB9AF7, 0x7DCFFF, 0xA9B1D6, 0x414868, 0xF7768E, 0x9ECE6A, 0xE0AF68, 0x7AA2F7, 0xBB9AF7, 0x7DCFFF, 0xC0CAF5],
    }),
    hearthLight: P({
      dark: false, window: 0xF2F3F5, pane: 0xF7F8FA, editorBackground: 0xFFFFFF, editorForeground: 0x1F2328, gutter: 0xF7F8FA, gutterText: 0xAEB3C2,
      selection: 0xC9DCFB, caret: 0x1F2328, accent: 0x3574F0, keyword: 0x0033B3, type: 0x00627A, string: 0x067D17, number: 0x1750EB, comment: 0x8C8C8C,
      attribute: 0x9E880D, function: 0x00627A, key: 0x871094, tag: 0x0033B3, punctuation: 0x6E7781, heading: 0x0033B3,
      ansi: [0x24292F, 0xCF222E, 0x116329, 0x7D4E00, 0x0969DA, 0x8250DF, 0x1B7C83, 0x6E7781, 0x57606A, 0xA40E26, 0x1A7F37, 0x633C01, 0x218BFF, 0xA475F9, 0x3192AA, 0x8C959F],
    }),
  };
  // "Feuerring bei Nacht" (DESIGN.md): night ground, ash text, flame as the one warm light.
  palettes.hearth = P({
    dark: true, window: 0x0E0A12, pane: 0x170F1C, editorBackground: 0x120C15, editorForeground: 0xE9DFE6, gutter: 0x170F1C, gutterText: 0x6E5F73,
    selection: 0x4A2F3A, caret: 0xFFA62B, accent: 0xFFA62B, keyword: 0xFF7A3D, type: 0xFFE3A1, string: 0xA8D08D, number: 0xFFA62B, comment: 0x8F7D95,
    attribute: 0xFFA62B, function: 0xFFD58A, key: 0xFF8A4C, tag: 0xFF5A1F, punctuation: 0xBFB0BB, heading: 0xFFA62B,
    ansi: [0x1D1420, 0xFF6B5F, 0xA8D08D, 0xFFA62B, 0x8AB4F8, 0xD7A1E0, 0x7FD6D0, 0xBFB0BB, 0x5C4D63, 0xFF8A80, 0xC3E0A8, 0xFFE3A1, 0xA9C8FA, 0xE6BFEC, 0xA5E8E3, 0xE9DFE6],
  });
  for (const k of ['window', 'pane', 'editorBackground', 'editorForeground', 'gutter', 'gutterText', 'selection', 'caret', 'accent', 'keyword', 'type', 'string', 'number', 'comment', 'attribute', 'function', 'key', 'tag', 'punctuation', 'heading'])
    for (const p of Object.values(palettes)) p[k] = hex(p[k]);

  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const x = rgb(a); const y = rgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

  const media = matchMedia('(prefers-color-scheme: light)');
  let current = 'system';
  const listeners = new Set();

  /** The palette in effect. "System" follows Windows: Hearth at night, Hearth Light by day. */
  function palette(name = current) {
    if (name === 'system') name = systemDark() ? 'hearth' : 'hearthLight';
    return palettes[name] || null;
  }

  const rgba = (h, a) => `rgba(${rgb(h).join(',')},${a})`;
  /** Text colour on top of the accent: dark on light accents (flame), white on dark ones. */
  const onAccent = (accent) => { const [r, g, b] = rgb(accent); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#14100f' : '#ffffff'; };

  function systemDark() { return !media.matches; }

  function apply(name) {
    current = (name === 'system' || palettes[name]) ? name : 'system';
    const root = document.documentElement;
    const p = palette();
    const set = (k, v) => root.style.setProperty(k, v);
    root.dataset.theme = p.dark ? 'dark' : 'light';
    const fg = p.editorForeground;
    set('--bg', p.window);
    set('--panel', p.pane);
    set('--panel2', mix(p.pane, fg, 0.06));
    set('--panel3', mix(p.pane, fg, 0.11));
    set('--line', mix(p.pane, fg, 0.14));
    set('--line-soft', mix(p.pane, fg, 0.09));
    set('--fg', fg);
    set('--dim', mix(fg, p.pane, 0.42));
    set('--accent', p.accent);
    set('--accent-soft', rgba(p.accent, 0.16));
    set('--accent-line', rgba(p.accent, 0.4));
    set('--on-accent', onAccent(p.accent));
    set('--term-bg', p.editorBackground);
    set('--term-fg', fg);
    set('--sidebar', rgba(p.window, p.dark ? 0.78 : 0.7));   // lets Windows 11 Mica shine through the sidebar
    set('--shadow', p.dark ? 'rgba(0,0,0,.45)' : 'rgba(30,25,40,.16)');
    for (const cb of listeners) cb(current, p);
  }
  media.addEventListener('change', () => { if (current === 'system') apply('system'); });

  function terminalTheme() {
    const p = palette();
    const a = p.ansi;
    return { background: p.editorBackground, foreground: p.editorForeground, cursor: p.caret, selectionBackground: p.selection,
      black: a[0], red: a[1], green: a[2], yellow: a[3], blue: a[4], magenta: a[5], cyan: a[6], white: a[7],
      brightBlack: a[8], brightRed: a[9], brightGreen: a[10], brightYellow: a[11], brightBlue: a[12], brightMagenta: a[13], brightCyan: a[14], brightWhite: a[15] };
  }

  /** Monaco theme for the palette, or the built-in light/dark one for the system theme. */
  function monacoTheme(monaco) {
    const p = palette();
    const c = (h) => h.slice(1);
    monaco.editor.defineTheme('hearth-' + current, {
      base: p.dark ? 'vs-dark' : 'vs', inherit: true,
      rules: [
        { token: 'keyword', foreground: c(p.keyword) }, { token: 'string', foreground: c(p.string) }, { token: 'number', foreground: c(p.number) },
        { token: 'comment', foreground: c(p.comment), fontStyle: 'italic' }, { token: 'type', foreground: c(p.type) }, { token: 'type.identifier', foreground: c(p.type) },
        { token: 'tag', foreground: c(p.tag) }, { token: 'attribute.name', foreground: c(p.attribute) }, { token: 'attribute.value', foreground: c(p.string) },
        { token: 'string.key.json', foreground: c(p.key) }, { token: 'delimiter', foreground: c(p.punctuation) }, { token: 'predefined', foreground: c(p.function) },
        { token: 'identifier', foreground: c(p.editorForeground) },
      ],
      colors: {
        'editor.background': p.editorBackground, 'editor.foreground': p.editorForeground, 'editorLineNumber.foreground': p.gutterText,
        'editorGutter.background': p.gutter, 'editor.selectionBackground': p.selection, 'editorCursor.foreground': p.caret,
        'editor.lineHighlightBackground': mix(p.editorBackground, p.editorForeground, 0.05),
      },
    });
    return 'hearth-' + current;
  }

  window.Themes = {
    palettes, apply, palette, terminalTheme, monacoTheme, mix,
    get current() { return current; },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    list: [['system', 'System'], ['hearth', 'Hearth'], ['hearthLight', 'Hearth Light'], ['darcula', 'Darcula'], ['storm', 'Storm']],
  };
})();
