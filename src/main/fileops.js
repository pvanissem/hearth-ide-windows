'use strict';
// File operations of the file browser: copy, move, rename, create. Pure Node (no Electron) so they can be tested.
// The caller checks that every path is inside an opened workspace.
const fs = require('node:fs');
const path = require('node:path');

const fail = (m) => { throw new Error(m); };
const exists = (p) => fs.promises.lstat(p).then(() => true, () => false);
const inside = (parent, child) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

function checkName(name) {
  const n = String(name || '').trim();
  if (!n || n === '.' || n === '..' || /[\\/:*?"<>|]/.test(n) || /[. ]$/.test(n)) fail('Invalid name');
  return n;
}
/** The write protection of .git/hooks also applies to the file browser. */
function checkProtected(p) {
  const parts = path.resolve(p).split(path.sep).map((x) => x.toLowerCase());
  if (parts.some((x, i) => x === '.git' && parts[i + 1] === 'hooks')) fail('.git/hooks is write-protected');
}

/** "a.txt" -> "a copy.txt" -> "a copy 2.txt" */
async function uniquePath(dir, name) {
  const ext = path.extname(name); const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 1; await exists(candidate); i++) candidate = path.join(dir, `${stem} copy${i > 1 ? ' ' + i : ''}${ext}`);
  return candidate;
}

async function copyInto(src, destDir) {
  src = path.resolve(src); destDir = path.resolve(destDir);
  checkProtected(destDir);
  if (!(await fs.promises.stat(destDir)).isDirectory()) fail('Target is not a folder');
  if (inside(src, destDir) && (await fs.promises.stat(src)).isDirectory()) fail('A folder cannot be copied into itself');
  const target = await uniquePath(destDir, path.basename(src));
  await fs.promises.cp(src, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  return target;
}

async function moveInto(src, destDir) {
  src = path.resolve(src); destDir = path.resolve(destDir);
  checkProtected(src); checkProtected(destDir);
  if (!(await fs.promises.stat(destDir)).isDirectory()) fail('Target is not a folder');
  if (inside(src, destDir)) fail('A folder cannot be moved into itself');
  const target = path.join(destDir, path.basename(src));
  if (target === src) return src;
  if (await exists(target)) fail(`"${path.basename(src)}" already exists in the target folder`);
  try { await fs.promises.rename(src, target); }
  catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.promises.cp(src, target, { recursive: true, errorOnExist: true, force: false });
    await fs.promises.rm(src, { recursive: true, force: true });
  }
  return target;
}

async function rename(src, newName) {
  src = path.resolve(src); checkProtected(src);
  const target = path.join(path.dirname(src), checkName(newName));
  if (target === src) return src;
  if (await exists(target) && target.toLowerCase() !== src.toLowerCase()) fail(`"${path.basename(target)}" already exists`);
  await fs.promises.rename(src, target);
  return target;
}

async function create(dir, name, isDir) {
  dir = path.resolve(dir); checkProtected(dir);
  const target = path.join(dir, checkName(name));
  if (await exists(target)) fail(`"${path.basename(target)}" already exists`);
  if (isDir) await fs.promises.mkdir(target);
  else await fs.promises.writeFile(target, '', { flag: 'wx' });
  return target;
}

module.exports = { copyInto, moveInto, rename, create, uniquePath, checkName, inside };
