'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on(channel, h); return () => ipcRenderer.removeListener(channel, h); };
const group = (prefix, names) => Object.fromEntries(names.map((n) => [n, invoke(`${prefix}:${n}`)]));

contextBridge.exposeInMainWorld('hearth', {
  detect: invoke('env:detect'),
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),
  agents: invoke('agents:list'),
  version: invoke('app:version'),
  open: invoke('app:open'),
  checkUpdate: invoke('app:checkUpdate'),
  smokeShot: invoke('smoke:shot'),
  pickFolder: invoke('dialog:folder'),
  start: invoke('session:start'),
  stop: invoke('session:stop'),
  remove: invoke('session:remove'),
  sessions: invoke('session:list'),
  input: (id, data) => ipcRenderer.send('session:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('session:resize', { id, cols, rows }),
  onData: on('session:data'), onStatus: on('session:status'), onExit: on('session:exit'), onRunEnd: on('run:end'),
  list: invoke('fs:list'), read: invoke('fs:read'), write: (file, content) => ipcRenderer.invoke('fs:write', { file, content }),
  git: group('git', ['isRepo', 'status', 'diff', 'stage', 'unstage', 'commit', 'log', 'branches', 'checkout', 'createBranch', 'fetch', 'pull', 'push',
    'stageAll', 'unstageAll', 'merge', 'mergeAbort', 'mergeInProgress', 'remoteUrl', 'stashList', 'stashSave', 'stashApply', 'stashPop', 'stashDrop']),
  journal: { get: invoke('journal:get'), revoke: (id, node, reason, replacedBy) => ipcRenderer.invoke('journal:revoke', { id, node, reason, replacedBy }), instruction: invoke('journal:instruction') },
  search: group('search', ['files', 'text', 'symbols', 'usages']),
  arch: { scan: invoke('arch:scan') },
  build: { tasks: invoke('build:tasks'), start: (dir, taskId) => ipcRenderer.invoke('build:start', { dir, taskId }), output: (id, from) => ipcRenderer.invoke('build:output', { id, from }), stop: invoke('build:stop') },
  tests: { load: invoke('tests:load'), run: invoke('tests:run') },
  ci: group('ci', ['info', 'pipelines', 'jobs', 'log', 'retry', 'cancel', 'retryJob', 'playJob', 'workflows', 'run', 'changeRequest']),
  creds: {
    list: invoke('creds:list'), saveToken: (host, writing, token) => ipcRenderer.invoke('creds:saveToken', { host, writing, token }),
    deleteToken: (host, writing) => ipcRenderer.invoke('creds:deleteToken', { host, writing }),
    setEnv: (name, value) => ipcRenderer.invoke('creds:setEnv', { name, value }), deleteEnv: invoke('creds:deleteEnv'),
  },
});
