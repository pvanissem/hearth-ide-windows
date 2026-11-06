'use strict';
// German texts. The key is the English source text (see scripts/i18n-strings.js --missing).
I18n.register('de', {
  // panes
  'Close view': 'Ansicht schließen', 'Larger text': 'Größerer Text', 'Smaller text': 'Kleinerer Text', 'Reset text size': 'Textgröße zurücksetzen', 'Text size': 'Textgröße',
  'Split right': 'Rechts teilen', 'Split down': 'Unten teilen', 'Restore size': 'Normale Größe', 'Maximize': 'Maximieren', 'Add view': 'Ansicht hinzufügen', 'Close pane': 'Bereich schließen',
  'Reset layout': 'Layout zurücksetzen', 'More': 'Mehr', 'Choose a view': 'Ansicht wählen', 'Pick what this pane should show.': 'Wähle, was dieser Bereich zeigen soll.',
  // design pass
  'Agents': 'Agenten', 'Needs attention': 'Braucht Aufmerksamkeit', 'No agents yet.': 'Noch keine Agenten.', 'Search everywhere': 'Überall suchen', 'Stop agent': 'Agent stoppen',
  '{n} sessions with activity, results, questions or errors.': '{n} Sitzungen mit Aktivität, Ergebnissen, Rückfragen oder Fehlern.', '{n} active': '{n} aktiv',
  'now': 'jetzt', '{n} s ago': 'vor {n} s', '{n} min ago': 'vor {n} min', '{n} h ago': 'vor {n} h', 'No sandbox': 'Keine Sandbox',
  'Filter': 'Filter', 'Local': 'Lokal', 'Remote': 'Remote', 'No upstream': 'Kein Upstream', 'Recent commits': 'Letzte Commits', 'No commits yet.': 'Noch keine Commits.',
  'Working tree clean.': 'Keine Änderungen.', 'Hearth, Hearth Light, Darcula and Storm also colour the editor, the syntax and the terminals.': 'Hearth, Hearth Light, Darcula und Storm färben auch Editor, Syntax und Terminals.',
  // inbox, start
  '+ Start agent': '+ Agent starten', 'Start agent': 'Agent starten', 'Start an agent to begin.': 'Starte einen Agenten, um loszulegen.',
  'Search': 'Suchen', 'Search everywhere (Shift Shift, Ctrl+K)': 'Überall suchen (Shift Shift, Strg+K)', 'Settings': 'Einstellungen',
  'Agent': 'Agent', 'Editor': 'Editor', 'sandbox': 'Sandbox', 'NO SANDBOX': 'KEINE SANDBOX', 'Close "{name}"?': '„{name}“ schließen?',
  '{name} needs you': '{name} braucht dich', 'process exited with code {code}': 'Prozess beendet mit Code {code}',
  'Starting': 'Startet', 'Running': 'Läuft', 'Needs input': 'Wartet auf dich', 'Idle': 'Ruhig', 'Done': 'Fertig', 'Failed': 'Fehlgeschlagen',
  'Source': 'Quelle', 'Existing folder': 'Vorhandener Ordner', 'Clone repository': 'Repository klonen', 'Repository URL': 'Repository-URL',
  'Folder': 'Ordner', 'Clone into folder': 'Klonen in Ordner', 'Choose a project folder': 'Projektordner wählen', 'Browse...': 'Durchsuchen ...',
  "Run the agent's login first": 'Zuerst die Anmeldung des Agenten ausführen', 'Cancel': 'Abbrechen', 'Start': 'Starten', 'Close': 'Schließen',
  'Install: {cmd} (the sandbox reads it from your PATH)': 'Installation: {cmd} (die Sandbox findet es über deinen PATH)',
  'Sandbox ready (Windows AppContainer, no install needed)': 'Sandbox bereit (Windows AppContainer, keine Installation nötig)',
  'Sandbox ready (WSL2 {distro} + nono)': 'Sandbox bereit (WSL2 {distro} + nono)', 'No sandbox: {reason}': 'Keine Sandbox: {reason}',
  // inspector tabs
  'Files': 'Dateien', 'Git': 'Git', 'Overview': 'Überblick', 'Tests': 'Tests', 'Architecture': 'Architektur', 'Build': 'Build', 'CI/CD': 'CI/CD',
  'No session selected': 'Keine Sitzung gewählt',
  // editor
  'Save (Ctrl+S)': 'Speichern (Strg+S)', 'modified': 'geändert', 'saved': 'gespeichert', 'Discard unsaved changes?': 'Ungespeicherte Änderungen verwerfen?',
  'Find usages': 'Verwendungen suchen', 'Go to definition': 'Gehe zu Definition', 'Usages of': 'Verwendungen von', 'in': 'in', 'All languages': 'Alle Sprachen',
  'Definitions': 'Definitionen', 'Code': 'Code', 'Imports': 'Imports', 'Comments': 'Kommentare', 'No results': 'Keine Treffer',
  // git
  'New branch': 'Neuer Branch', 'Fetch': 'Abrufen', 'Pull': 'Pull', 'Push': 'Push', 'MR / PR': 'MR / PR', 'Changes': 'Änderungen',
  'Stage all': 'Alle vormerken', 'Unstage all': 'Alle zurücknehmen', 'Stage': 'Vormerken', 'Unstage': 'Zurücknehmen',
  'Commit message': 'Commit-Nachricht', 'Commit staged': 'Vorgemerktes committen', 'Refresh': 'Aktualisieren', 'Stash': 'Stash',
  'Stash changes': 'Änderungen beiseitelegen', 'Stash message (optional)': 'Stash-Nachricht (optional)', 'Apply': 'Anwenden', 'Pop': 'Pop', 'Drop': 'Verwerfen',
  'Discard this stash?': 'Diesen Stash verwerfen?', 'Branches': 'Branches', 'Checkout': 'Wechseln', 'Merge into current': 'In aktuellen mergen',
  'Merge {name} into {current}?': '{name} in {current} mergen?', 'A merge is in progress.': 'Ein Merge läuft.', 'Abort merge': 'Merge abbrechen',
  'History': 'Verlauf', 'Name of the new branch': 'Name des neuen Branches', 'Not a Git repository': 'Kein Git-Repository', '(detached)': '(losgelöst)',
  '(untracked file - stage it to include it in the commit)': '(unversionierte Datei - vormerken, um sie zu committen)',
  'Detached HEAD: nothing to push': 'Losgelöster HEAD: nichts zu pushen',
  'Merge / pull request': 'Merge / Pull Request', 'Title': 'Titel', 'Source branch': 'Quell-Branch', 'Target branch': 'Ziel-Branch', 'Description': 'Beschreibung', 'Create': 'Erstellen',
  'No GitHub or GitLab remote found in this repository.': 'Kein GitHub- oder GitLab-Remote in diesem Repository gefunden.',
  // overview
  'All': 'Alle', 'Steps': 'Schritte', 'Decisions': 'Entscheidungen', 'Open': 'Offen', 'Ask agent to record its work': 'Agent bitten, seine Arbeit festzuhalten',
  'Now': 'Jetzt', 'Why': 'Warum', 'Rejected': 'Verworfen', 'Answer': 'Antwort', 'Revoked': 'Revidiert', 'Revoke': 'Revidieren', '{n} open': '{n} offen',
  'planned': 'geplant', 'running': 'läuft', 'done': 'erledigt', 'blocked': 'blockiert', 'open': 'offen', 'answered': 'beantwortet',
  'Why do you revoke "{title}"? (optional)': 'Warum revidierst du „{title}“? (optional)',
  'Nothing recorded yet. Claude Code and Codex get the hearth-journal command and its instruction automatically; for other agents use "Ask agent to record its work".':
    'Noch nichts festgehalten. Claude Code und Codex bekommen den Befehl hearth-journal samt Anweisung automatisch; bei anderen Agenten hilft „Agent bitten, seine Arbeit festzuhalten“.',
  // tests, build
  'Run tests': 'Tests ausführen', 'Reload reports': 'Berichte neu laden', 'Reload': 'Neu laden', 'Output': 'Ausgabe', 'Stop': 'Stoppen', 'Run': 'Ausführen',
  'Running...': 'Läuft ...', 'service': 'Dienst', 'failed': 'fehlgeschlagen', 'finished': 'beendet', 'stopped': 'gestoppt',
  '{total} tests: {passed} passed, {failed} failed, {skipped} skipped': '{total} Tests: {passed} bestanden, {failed} fehlgeschlagen, {skipped} übersprungen',
  'No test reports found (JUnit XML under target/surefire-reports, build/test-results, junit.xml ...).': 'Keine Testberichte gefunden (JUnit-XML unter target/surefire-reports, build/test-results, junit.xml ...).',
  'No build tasks found (package.json, Maven, Gradle, Go, Cargo, Makefile or .hearth/tasks.json).': 'Keine Build-Aufgaben gefunden (package.json, Maven, Gradle, Go, Cargo, Makefile oder .hearth/tasks.json).',
  // architecture
  'No Mermaid diagrams found. Put ```mermaid blocks into your Markdown files (docs/architecture.md) or use .mmd files.':
    'Keine Mermaid-Diagramme gefunden. Lege ```mermaid-Blöcke in deine Markdown-Dateien (docs/architecture.md) oder nutze .mmd-Dateien.',
  'Diagram error': 'Diagrammfehler',
  // ci
  'Run pipeline': 'Pipeline starten', 'Token...': 'Token ...', 'Retry': 'Wiederholen', 'Open in browser': 'Im Browser öffnen', 'Play': 'Starten',
  'Loading...': 'Lädt ...', 'No pipelines yet.': 'Noch keine Pipelines.', 'no token (Settings > Credentials)': 'kein Token (Einstellungen > Anmeldedaten)',
  'No active workflows found.': 'Keine aktiven Workflows gefunden.', 'Workflow to run on': 'Workflow ausführen auf', 'Run a pipeline for {branch}?': 'Pipeline für {branch} starten?',
  'success': 'erfolgreich', 'pending': 'wartet', 'canceled': 'abgebrochen', 'skipped': 'übersprungen', 'manual': 'manuell',
  // search
  'Search files, text, symbols, sessions, tests, actions': 'Dateien, Text, Symbole, Sitzungen, Tests, Aktionen suchen', 'Symbols': 'Symbole', 'Text': 'Text', 'Chats': 'Chats',
  'Sessions': 'Sitzungen', 'Actions': 'Aktionen', 'Start an agent to search its project folder.': 'Starte einen Agenten, um seinen Projektordner zu durchsuchen.',
  'Open settings': 'Einstellungen öffnen', 'Show files': 'Dateien zeigen', 'Show Git': 'Git zeigen', 'Show overview': 'Überblick zeigen', 'Show tests': 'Tests zeigen',
  'Show architecture': 'Architektur zeigen', 'Show build & deployment': 'Build & Deployment zeigen', 'Show CI/CD': 'CI/CD zeigen', 'Show agent': 'Agent zeigen', 'Show editor': 'Editor zeigen',
  'Git: fetch': 'Git: Abrufen', 'Git: pull': 'Git: Pull', 'Git: push': 'Git: Push', 'Check for updates': 'Nach Updates suchen', 'Theme': 'Theme', 'Language': 'Sprache',
  // settings
  'General': 'Allgemein', 'Sandbox': 'Sandbox', 'Credentials': 'Anmeldedaten', 'About': 'Info', 'Save': 'Speichern',
  'Hearth Light, Darcula and Storm also colour the editor, the syntax and the terminals.': 'Hearth Light, Darcula und Storm färben auch Editor, Syntax und Terminals.',
  'Overview: give agents the hearth-journal command': 'Überblick: Agenten den Befehl hearth-journal geben',
  'Network for sandboxed agents': 'Netzwerk für Agenten in der Sandbox', 'Internet (agents need their API)': 'Internet (Agenten brauchen ihre API)', 'Offline': 'Offline',
  'Extra allowed domains (one per line)': 'Zusätzlich erlaubte Domains (eine pro Zeile)',
  'Files and processes are isolated by Windows (AppContainer). The domain list is only enforced with the WSL2 backend.': 'Dateien und Prozesse isoliert Windows (AppContainer). Die Domain-Liste gilt nur mit dem WSL2-Backend.',
  'Extra open ports (comma separated)': 'Zusätzlich offene Ports (durch Komma getrennt)', 'Extra folders (one per line, prefix + for read/write)': 'Zusätzliche Ordner (einer pro Zeile, Präfix + für Lesen/Schreiben)',
  'Git over SSH (use ~/.ssh for push, pull and fetch)': 'Git über SSH (~/.ssh für Push, Pull und Abrufen nutzen)', 'Sandbox backend': 'Sandbox-Backend',
  'Automatic (Windows AppContainer)': 'Automatisch (Windows AppContainer)', 'Allow running agents WITHOUT a sandbox when no sandbox is available': 'Agenten OHNE Sandbox erlauben, wenn keine Sandbox verfügbar ist',
  'Sandbox: native Windows AppContainer (WSL2 not required)': 'Sandbox: nativer Windows AppContainer (WSL2 nicht nötig)', 'Sandbox: nono in WSL2 ({distro})': 'Sandbox: nono in WSL2 ({distro})',
  'Stored encrypted with Windows (DPAPI), never in a repository.': 'Verschlüsselt mit Windows (DPAPI) gespeichert, nie in einem Repository.',
  'CI/CD tokens': 'CI/CD-Tokens', 'read': 'lesen', 'write': 'schreiben', 'write (MR/PR, run)': 'schreiben (MR/PR, Start)', 'Environment variables for agents': 'Umgebungsvariablen für Agenten',
  'Environment variables are visible to the agent inside the sandbox.': 'Umgebungsvariablen sind für den Agenten in der Sandbox sichtbar.', 'Remove': 'Entfernen',
  'No tokens saved.': 'Keine Tokens gespeichert.', 'No variables saved.': 'Keine Variablen gespeichert.', 'Windows secret storage is not available.': 'Der Windows-Geheimnisspeicher ist nicht verfügbar.',
  'Checking...': 'Prüfe ...', 'Version {v} is available.': 'Version {v} ist verfügbar.', 'Open release': 'Release öffnen', 'You have the latest version ({v}).': 'Du hast die neueste Version ({v}).',
});
