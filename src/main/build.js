'use strict';
// Build & Deployment: detect the project's tasks (npm scripts, Maven, Gradle, Go, Cargo, Make,
// .hearth/tasks.json) and run them inside the sandbox. Ported from BuildDeploy.swift / BuildRunner.swift.
// The renderer only sends a task id; the command always comes from a fresh scan of the project.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,60}$/;
const SKIP = new Set(['node_modules', '.git', 'target', 'build', 'dist', '.gradle', '.idea', 'vendor', 'out', '.venv', '__pycache__']);

const read = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch { return null; } };
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const rel = (root, dir) => path.relative(root, dir).replace(/\\/g, '/') || '.';
const id = (tool, dir, name) => `${tool}:${dir}:${name}`;
const port = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 65536 ? n : null; };

function nodeTasks(dir, root) {
  const pkg = read(path.join(dir, 'package.json'));
  if (!pkg) return [];
  let scripts = {};
  try { scripts = JSON.parse(pkg).scripts || {}; } catch { return []; }
  const pm = exists(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : exists(path.join(dir, 'yarn.lock')) ? 'yarn' : 'npm';
  const services = new Set(['start', 'dev', 'serve', 'preview']);
  return Object.keys(scripts).filter((n) => NAME_RE.test(n) && !/^(pre|post)/.test(n)).map((name) => ({
    id: id('node', rel(root, dir), name), tool: 'Node', name, title: `${pm} run ${name}`, dir,
    command: pm === 'npm' && name === 'test' ? 'npm test' : `${pm} run ${name}`, kind: services.has(name) ? 'service' : 'task', test: name === 'test',
    port: (/(?:--port|-p|PORT=)\s*=?\s*(\d{2,5})/.exec(scripts[name]) || [])[1] ? port(/(?:--port|-p|PORT=)\s*=?\s*(\d{2,5})/.exec(scripts[name])[1]) : null,
  }));
}

function mavenTasks(dir, root) {
  const pom = read(path.join(dir, 'pom.xml'));
  if (!pom) return [];
  const wrapper = exists(path.join(dir, 'mvnw.cmd')) ? 'mvnw.cmd' : 'mvn';
  const mk = (name, title, goals, extra = {}) => ({ id: id('maven', rel(root, dir), name), tool: 'Maven', name, title, dir, command: `${wrapper} ${goals}`, kind: 'task', ...extra });
  const tasks = [mk('test', 'Maven test', 'test', { test: true }), mk('package', 'Maven package', 'package'), mk('install', 'Maven clean install', 'clean install')];
  if (/spring-boot-maven-plugin|spring-boot-starter-parent/.test(pom)) {
    const p = port((read(path.join(dir, 'src/main/resources/application.properties')) || '').match(/^server\.port\s*=\s*(\d+)/m)?.[1]);
    tasks.push(mk('spring-boot:run', 'Spring Boot run', 'spring-boot:run', { kind: 'service', port: p || 8080 }));
  }
  return tasks;
}

function gradleTasks(dir, root) {
  const has = ['build.gradle', 'build.gradle.kts'].some((f) => exists(path.join(dir, f)));
  if (!has) return [];
  const gw = exists(path.join(dir, 'gradlew.bat')) ? 'gradlew.bat' : 'gradle';
  const build = (read(path.join(dir, 'build.gradle')) || '') + (read(path.join(dir, 'build.gradle.kts')) || '');
  const mk = (name, kind = 'task', extra = {}) => ({ id: id('gradle', rel(root, dir), name), tool: 'Gradle', name, title: `Gradle ${name}`, dir, command: `${gw} ${name}`, kind, ...extra });
  const tasks = [mk('build'), mk('test', 'task', { test: true })];
  if (/org\.springframework\.boot/.test(build)) tasks.push(mk('bootRun', 'service', { port: 8080 }));
  return tasks;
}

function goTasks(dir, root) {
  if (!exists(path.join(dir, 'go.mod'))) return [];
  const mk = (name, command, kind = 'task', extra = {}) => ({ id: id('go', rel(root, dir), name), tool: 'Go', name, title: `go ${name}`, dir, command, kind, ...extra });
  return [mk('build', 'go build ./...'), mk('test', 'go test ./...', 'task', { test: true }), mk('vet', 'go vet ./...')];
}

function cargoTasks(dir, root) {
  if (!exists(path.join(dir, 'Cargo.toml'))) return [];
  const mk = (name, kind = 'task', extra = {}) => ({ id: id('cargo', rel(root, dir), name), tool: 'Cargo', name, title: `cargo ${name}`, dir, command: `cargo ${name}`, kind, ...extra });
  return [mk('build'), mk('test', 'task', { test: true }), mk('run', 'service')];
}

function makeTasks(dir, root) {
  const mf = read(path.join(dir, 'Makefile'));
  if (!mf) return [];
  const targets = [...new Set([...mf.matchAll(/^([A-Za-z][A-Za-z0-9_-]{0,40}):(?!=)/gm)].map((m) => m[1]))].filter((t) => !['PHONY', 'default'].includes(t)).slice(0, 12);
  return targets.map((name) => ({ id: id('make', rel(root, dir), name), tool: 'Make', name, title: `make ${name}`, dir, command: `make ${name}`, kind: 'task', test: name === 'test' }));
}

/** .hearth/tasks.json: [{ "name": "...", "command": "...", "kind": "task|service" }] - the project's own tasks. */
function customTasks(root) {
  const raw = read(path.join(root, '.hearth', 'tasks.json'));
  if (!raw) return [];
  try {
    return JSON.parse(raw).filter((t) => t && NAME_RE.test(t.name || '') && typeof t.command === 'string' && t.command.length < 500)
      .map((t) => ({ id: id('custom', '.', t.name), tool: 'Custom', name: t.name, title: t.name, dir: root, command: t.command, kind: t.kind === 'service' ? 'service' : 'task', test: /test/i.test(t.name) }));
  } catch { return []; }
}

/** All tasks of a project folder (root and direct subfolders). */
function scan(root) {
  const dirs = [root];
  try {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) dirs.push(path.join(root, e.name));
  } catch { /* unreadable */ }
  const tasks = [];
  for (const d of dirs) tasks.push(...mavenTasks(d, root), ...gradleTasks(d, root), ...nodeTasks(d, root), ...goTasks(d, root), ...cargoTasks(d, root), ...makeTasks(d, root));
  tasks.push(...customTasks(root));
  return tasks;
}

/** One running or finished command with its output (paged by cursor, bounded). */
class Run {
  constructor(task) { this.task = task; this.chunks = []; this.size = 0; this.state = 'running'; this.code = null; this.started = Date.now(); this.proc = null; }
  append(buf) {
    const MAX = 2 * 1024 * 1024;
    this.chunks.push(buf); this.size += buf.length;
    while (this.size > MAX && this.chunks.length > 1) this.size -= this.chunks.shift().length;
  }
  get text() { return Buffer.concat(this.chunks).toString('utf8'); }
  stop() { if (this.state === 'running') { this.state = 'stopped'; try { this.proc.kill(); } catch { /* gone */ } } }
}

/** Starts a launch (from sandbox.prepare with pipes) and returns the Run. */
function start(task, launch, onEnd) {
  const run = new Run(task);
  const args = launch.backend === 'native' ? [...launch.args, '--pipes'] : launch.args;
  const proc = spawn(launch.file, args, { cwd: launch.cwd, env: launch.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  run.proc = proc;
  proc.stdout.on('data', (d) => run.append(d));
  proc.stderr.on('data', (d) => run.append(d));
  proc.on('error', (e) => { run.append(Buffer.from(`\n${e.message}\n`)); if (run.state === 'running') run.state = 'failed'; onEnd?.(run); });
  proc.on('close', (code) => { run.code = code; if (run.state === 'running') run.state = code === 0 ? 'done' : 'failed'; onEnd?.(run); });
  return run;
}

module.exports = { scan, start, Run, nodeTasks, mavenTasks, gradleTasks, goTasks, cargoTasks, makeTasks, customTasks, NAME_RE };
