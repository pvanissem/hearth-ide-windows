'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on(channel, h); return () => ipcRenderer.removeListener(channel, h); };

contextBridge.exposeInMainWorld('hearth', {
  detect: invoke('env:detect'),
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),
  agents: invoke('agents:list'),
  pickFolder: invoke('dialog:folder'),
  start: invoke('session:start'),
  stop: invoke('session:stop'),
  remove: invoke('session:remove'),
  sessions: invoke('session:list'),
  input: (id, data) => ipcRenderer.send('session:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('session:resize', { id, cols, rows }),
  onData: on('session:data'), onStatus: on('session:status'), onExit: on('session:exit'),
  list: invoke('fs:list'), read: invoke('fs:read'), write: (file, content) => ipcRenderer.invoke('fs:write', { file, content }),
  git: {
    isRepo: invoke('git:isRepo'), status: invoke('git:status'), diff: invoke('git:diff'), stage: invoke('git:stage'),
    unstage: invoke('git:unstage'), commit: invoke('git:commit'), log: invoke('git:log'),
  },
});
