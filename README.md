# Hearth IDE for Windows

Windows companion to [Hearth IDE](https://github.com/pvanissem/hearth-ide) (native macOS/SwiftUI).
The macOS app cannot be compiled for Windows (SwiftUI, AppKit, Seatbelt and the Keychain are
macOS-only), so this is a separate Electron client that keeps the same ideas and ports the
platform-independent logic: agent catalog, sandbox rules, inbox status and Git handling.

## What works (v0.1)

| Area | macOS app (v0.8.0) | This client |
|---|---|---|
| Agents: Claude Code, Codex, Copilot CLI, OpenCode, Gemini, shell | yes | yes (catalog, resume and login arguments ported) |
| Terminal in the chat area | SwiftTerm | xterm.js + node-pty (ConPTY) |
| Inbox with status (running / needs input / idle / done) | hooks, notify, terminal | terminal heuristics + bell, desktop notification |
| Sandbox | nono + Seatbelt | **native Windows AppContainer, nothing to install** (see below) |
| File tree and editor | Monaco | Monaco, workspace-restricted |
| Git: status, diff, stage, commit, history | sandboxed Git | host Git with hooks and fsmonitor disabled |
| Settings: domains, ports, SSH for Git | yes | network on/off, SSH, extra folders |
| Search Everywhere, Architecture (Mermaid), CI/CD, Build & Deployment, Journal, themes, German UI | yes | not yet |

## Sandbox on Windows

Agents run through `hearth-sandbox.exe` (C#, built with the compiler that ships with Windows, no SDK,
no admin rights, no WSL). It starts the agent as a Windows **AppContainer** process (the isolation
Chromium and UWP apps use) inside a job object that is killed with the app:

| | |
|---|---|
| Files | readable/writable: the project folder, a private home per agent (`~/.hearth/agents/<agent>/home`, where logins and config live), a run folder. Read-only: tool folders on your `PATH` inside your profile (Node, npm globals, ...). Everything else is denied: `~/.ssh`, other projects, browser data, shell config. |
| `.git/hooks` | read-only for the agent (hooks run outside the sandbox) |
| Network | Settings: Internet (default, agents need their API) or Offline |
| Environment | `HOME`, `USERPROFILE`, `APPDATA`, `TEMP` point to the private home |
| Cleanup | the folder grants are removed again when the last session of a project ends |

Verified end to end by `npm run smoke` in a real ConPTY session: a secret outside the project cannot be
read, writes outside the project and into `.git/hooks` are denied, project read/write works, no grants
are left behind.

**Known limits (compared to the macOS app)**

- **No domain allowlist.** Windows blocks loopback for AppContainers unless an administrator exempts
  them, so a filtering proxy cannot be enforced without an installer with admin rights. Today the
  choice is all of the internet or none. (The domain list is only applied with the optional WSL2 backend.)
- Folder grants are ACL entries on your folders while a session runs. If the app is killed hard they can
  remain. They only name that project's private container, and the next normal session end removes
  them again. `.git/hooks` keeps a few duplicate explicit entries after a session (harmless).
- The Git pane runs on the host (with hooks and fsmonitor disabled), not in the sandbox.
- Agent logins that live in the macOS Keychain need a re-login inside the sandbox (their own credential
  files in the private home). Not exercised with real agents yet.
- A project that contains Electron itself (like this repo) must not be used as the agent folder.

Optional backend: nono inside WSL2 (`Settings`, backend `wsl`), which also enforces the domain list.

## Develop

```
npm install
npm start          # builds the sandbox helper if needed, runs the app
npm test           # unit tests (paths, policy, native rules, Git parsing, status, settings)
npm run smoke      # drives the real app: sandboxed PTY, UI, Git, editor, escape attempts
npm run dist       # NSIS installer via electron-builder (bundles hearth-sandbox.exe)
```

Needs Node 20+. `node-pty` ships Windows prebuilds; no compiler besides the built-in `csc.exe`.

## Security notes

- The renderer is sandboxed (`contextIsolation`, no Node); all file and Git access goes through the
  main process and is limited to folders you picked or started a session in.
- Host-side Git runs with `core.hooksPath` pointing at the null device and `core.fsmonitor=false`.
- Settings live in `%USERPROFILE%\.hearth\settings.json` (override with `HEARTH_HOME`).
