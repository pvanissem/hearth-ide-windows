# Hearth IDE for Windows

Windows companion to [Hearth IDE](https://github.com/pvanissem/hearth-ide) (native macOS/SwiftUI).
The macOS app cannot be compiled for Windows (SwiftUI, AppKit, Seatbelt and the Keychain are macOS-only),
so this is a separate Electron client with the same ideas: every agent runs in a sandbox, one inbox shows
what each of them needs, and next to the terminal you get files, Git, an overview of the agent's work, tests,
architecture, build tasks and CI/CD.

## Features (v0.2, compared with macOS v0.8.0)

| Area | macOS | Windows |
|---|---|---|
| Agents: Claude Code, Codex, Copilot CLI, OpenCode, Gemini, sandbox shell; resume/login arguments | yes | yes |
| Inbox with status (running / needs input / idle / done), desktop notification | hooks, notify | terminal heuristics + bell |
| Terminal in the chat area | SwiftTerm | xterm.js + ConPTY, Ctrl +/- zoom |
| **Sandbox** | nono + Seatbelt | native Windows AppContainer, nothing to install (see below) |
| Start from an existing folder or **clone a repository** | yes | yes |
| Files, **Monaco editor** with tabs, syntax colours, unsaved-changes handling | yes | yes |
| **Find usages** (Alt+F7, with enclosing class/function, filters), go to definition (F12, Ctrl+click) | yes | yes (word match, no compiler, like macOS) |
| **Search Everywhere** (Shift Shift / Ctrl+K): files, symbols, text, chats, sessions, tests, actions; word-start matching ("mlv" finds MainLayoutView) | yes | yes |
| **Git**: status, diff, stage/unstage (single or all), commit, branches, checkout, new branch, fetch, pull (ff-only), push (never forced), merge + abort, stash (save/apply/pop/drop), history | yes | yes (host Git, hooks disabled) |
| **MR / PR** creation (GitLab / GitHub) | yes | yes |
| **Overview** (journal): tree of steps, decisions with reasons and rejected options, open questions, revoke with reason | yes | yes (`hearth-journal` inside the sandbox) |
| **Tests**: JUnit reports (Maven, Gradle, jest-junit, pytest, ...), run the test task | yes | yes |
| **Architecture**: Mermaid diagrams from Markdown / `.mmd` | yes | yes |
| **Build & Deployment**: npm/pnpm/yarn scripts, Maven (+ Spring Boot), Gradle, Go, Cargo, Make, `.hearth/tasks.json`; run in the sandbox | yes | yes |
| **CI/CD**: GitHub Actions + GitLab pipelines, jobs, logs, retry, cancel, run | yes | yes |
| Themes: **System, Hearth, Hearth Light, Darcula, Storm** (panes, editor, syntax, terminals); "System" follows Windows (Hearth by night, Hearth Light by day) | yes | yes |
| Look: brand fonts (Bricolage Grotesque, Hanken Grotesk, Azeret Mono), line icons, session cards with status and a live summary line, "needs attention" section, chat header with status and sandbox badge, diff stats, branch cards, task cards, Windows 11 title bar with Mica | SwiftUI | yes (Electron, same palette as DESIGN.md) |
| **German and English** UI | yes | yes |
| Credentials: CI tokens (read/write) and environment variables for agents, encrypted with DPAPI | Keychain, nono proxy | DPAPI; variables are visible to the agent |
| Update check | yes | checks GitHub releases (no auto-install) |

**Panes.** Every view (Sessions, Agent, Editor, Files, Git, Overview, Tests, Architecture, Build, CI/CD) lives in a pane that holds
tabs. Drag a tab into another pane, or onto a pane's edge to cut a new column or row (a flame preview shows where it lands).
Each pane has text size ("AA"), split right/down, maximise (Esc restores) and close; narrow panes fold these into a "..." menu.
Dividers are draggable (double-click evens them out), closed views come back through "+" , the pane chooser, Search Everywhere
or "Reset layout". The layout is saved and restored.

**Not (yet) in the Windows version**

- Extra windows: a pane cannot be torn off into its own window yet (everything lives in one window).
- Per-host network domain allowlist and credential *proxy* (placeholder tokens) - see the sandbox limits below.
- Status through agent hooks (`Notification`/`Stop`) and Codex `notify`: the inbox uses terminal activity and the bell instead.
- Usage/limit displays per agent, iTerm2/Terminal.app integration, auto-install of updates, code signing.
- Git runs on the host (hooks and fsmonitor disabled), not in a separate sandbox.

## Sandbox on Windows

Agents run through `hearth-sandbox.exe` (C#, built with the compiler that ships with Windows; no SDK, no
admin rights, no WSL). It starts the agent as a Windows **AppContainer** process (the isolation Chromium
and UWP apps use) inside a job object that is killed with the app.

| | |
|---|---|
| Files | writable: the project folder, a private home per agent (`~/.hearth/agents/<agent>/home`, where logins and config live), a run folder. Read-only: tool folders on your `PATH` inside your profile (Node, npm globals, ...). Everything else is denied: `~/.ssh`, other projects, browser data, shell config. |
| `.git/hooks` | read-only for the agent (hooks run outside the sandbox) |
| Network | Settings: Internet (default, agents need their API) or Offline |
| Environment | `HOME`, `USERPROFILE`, `APPDATA`, `TEMP` point to the private home; `NODE_PRESERVE_SYMLINKS` is set because an AppContainer cannot `lstat` `C:\` |
| Cleanup | the grants are removed when the last sandboxed process (session, build, test run) of a project ends; counted per project, also while a process is still starting |

Verified end to end by `npm run smoke` in a real ConPTY session and for the packaged app
(`scripts/smoke.ps1 -Packaged`): a secret outside the project cannot be read, writes outside the project and
into `.git/hooks` are denied, build and test tasks run inside the sandbox, no grants are left behind.

**Known limits (compared with the macOS app)**

- **No domain allowlist.** Windows blocks loopback for AppContainers unless an administrator exempts them, so
  a filtering proxy cannot be enforced without an installer with admin rights. The choice is all of the
  internet or none. (The domain list is only applied with the optional WSL2 backend.)
- Folder grants are ACL entries on your folders while a process runs. If the app is killed hard they can
  remain; they only name that project's private container. `.git/hooks` keeps a few duplicate explicit
  entries after a session (harmless).
- Environment variables you store for agents are visible to them (there is no proxy that swaps in secrets).
- Agent logins from the macOS Keychain do not exist here: sign in once inside the sandbox (private home).
- A project that contains Electron itself (like this repo) must not be used as the agent folder.

Optional backend: nono inside WSL2 (Settings, backend `wsl`), which also enforces the domain list.

## Develop

```
npm install
npm start               # builds the sandbox helper if needed, runs the app
npm test                # unit tests: paths, policy, sandbox rules, leases, journal, CI, credentials, build, tests, search, Git, translations
npm run smoke           # drives the real app: sandboxed PTY, escape attempts, every inspector view, themes, German UI
npm run dist            # NSIS installer in dist/ (bundles hearth-sandbox.exe)
npx electron-builder --win --dir && powershell -File scripts/smoke.ps1 -Packaged     # test the packaged app
node scripts/sandbox-run.js claude <folder>             # run an agent in the sandbox without the UI
node scripts/i18n-strings.js --missing                  # texts without a German translation
```

Needs Node 20+. `node-pty` ships Windows prebuilds; the only compiler needed is the built-in `csc.exe`.
Project tasks for Build & Deployment can be added in `.hearth/tasks.json`:
`[{ "name": "deploy", "command": "npm run deploy", "kind": "service" }]`.

## Security notes

- The renderer is sandboxed (`contextIsolation`, no Node); all file, Git, CI and credential access goes through
  the main process and is limited to folders you picked or started a session in. Build tasks are looked up by
  id from a fresh scan of the project; the renderer never sends a command line.
- Host-side Git runs with `core.hooksPath` pointing at the null device, `core.fsmonitor=false` and no prompts.
- CI tokens are bound to one host and only sent to that host's HTTPS API; secrets are stored with DPAPI.
- Settings live in `%USERPROFILE%\.hearth\settings.json` (override with `HEARTH_HOME`).
