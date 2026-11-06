'use strict';
// Lists every translatable UI text: t('...') calls in the renderer scripts and data-i18n markup.
//   node scripts/i18n-strings.js            prints all texts
//   node scripts/i18n-strings.js --missing  prints the texts without a German entry
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'src', 'renderer');

function collect() {
  const out = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f.startsWith('i18n') || f === 'themes.js') continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /\bt\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
    let m;
    while ((m = re.exec(src))) out.add(eval(m[1]));   // eslint-disable-line no-eval -- our own source, string literals only
  }
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  let m;
  const attr = /data-i18n(?:-ph|-title)="([^"]+)"/g;
  while ((m = attr.exec(html))) out.add(m[1]);
  const text = /<(\w+)([^>]*)\sdata-i18n(?:\s[^>]*|)>([^<]+)</g;
  while ((m = text.exec(html))) out.add(m[3].trim());
  for (const s of EXTRAS) out.add(s);
  return [...out].filter(Boolean).sort();
}

// Texts that reach t() through a variable (status names, categories, filters).
const EXTRAS = ['Starting', 'Running', 'Needs input', 'Idle', 'Done', 'Failed', 'planned', 'running', 'done', 'blocked', 'open', 'answered',
  'success', 'failed', 'pending', 'canceled', 'skipped', 'manual', 'finished', 'stopped', 'Definitions', 'Code', 'Imports', 'Comments',
  'Symbols', 'Text', 'Chats', 'Sessions', 'Actions', 'Open', 'Steps', 'Decisions'];

function missing() {
  const store = {};
  global.window = { I18n: null };
  global.I18n = { register: (code, entries) => { store[code] = { ...(store[code] || {}), ...entries }; } };
  require(path.join(dir, 'i18n-de.js'));
  return collect().filter((s) => !(store.de && s in store.de));
}

if (require.main === module) {
  const list = process.argv.includes('--missing') ? missing() : collect();
  console.log(JSON.stringify(list, null, 1));
}

module.exports = { collect, missing };
