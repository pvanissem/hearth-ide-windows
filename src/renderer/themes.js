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
  for (const k of ['window', 'pane', 'editorBackground', 'editorForeground', 'gutter', 'gutterText', 'selection', 'caret', 'accent', 'keyword', 'type', 'string', 'number', 'comment', 'attribute', 'function', 'key', 'tag', 'punctuation', 'heading'])
    for (const p of Object.values(palettes)) p[k] = hex(p[k]);

  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const x = rgb(a); const y = rgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

  const media = matchMedia('(prefers-color-scheme: light)');
  let current = 'system';
  const listeners = new Set();

  /** The palette in effect (null: system colours from CSS). */
  function palette(name = current) { return palettes[name] || null; }

  function systemDark() { return !media.matches; }

  function apply(name) {
    current = palettes[name] ? name : 'system';
    const root = document.documentElement;
    const p = palette();
    const names = ['--bg', '--panel', '--panel2', '--line', '--fg', '--dim', '--accent', '--term-bg', '--term-fg'];
    if (!p) {
      for (const n of names) root.style.removeProperty(n);
      root.dataset.theme = systemDark() ? 'dark' : 'light';
    } else {
      root.dataset.theme = p.dark ? 'dark' : 'light';
      const fg = p.editorForeground;
      root.style.setProperty('--bg', p.window);
      root.style.setProperty('--panel', p.pane);
      root.style.setProperty('--panel2', mix(p.pane, fg, 0.07));
      root.style.setProperty('--line', mix(p.pane, fg, 0.16));
      root.style.setProperty('--fg', fg);
      root.style.setProperty('--dim', mix(fg, p.pane, 0.45));
      root.style.setProperty('--accent', p.accent);
      root.style.setProperty('--term-bg', p.editorBackground);
      root.style.setProperty('--term-fg', fg);
    }
    for (const cb of listeners) cb(current);
  }
  media.addEventListener('change', () => { if (current === 'system') apply('system'); });

  function terminalTheme() {
    const p = palette();
    if (!p) return systemDark() ? { background: '#14151a', foreground: '#dfe1e5', cursor: '#f08a4b' } : { background: '#ffffff', foreground: '#1d1f23', cursor: '#d96a1f' };
    const a = p.ansi;
    return { background: p.editorBackground, foreground: p.editorForeground, cursor: p.caret, selectionBackground: p.selection,
      black: a[0], red: a[1], green: a[2], yellow: a[3], blue: a[4], magenta: a[5], cyan: a[6], white: a[7],
      brightBlack: a[8], brightRed: a[9], brightGreen: a[10], brightYellow: a[11], brightBlue: a[12], brightMagenta: a[13], brightCyan: a[14], brightWhite: a[15] };
  }

  /** Monaco theme for the palette, or the built-in light/dark one for the system theme. */
  function monacoTheme(monaco) {
    const p = palette();
    if (!p) return systemDark() ? 'vs-dark' : 'vs';
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
    list: [['system', 'System'], ['hearthLight', 'Hearth Light'], ['darcula', 'Darcula'], ['storm', 'Storm']],
  };
})();
