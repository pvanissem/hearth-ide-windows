# Takes the real screenshots of the landing page with the neutral demo project "campfire-demo" and an isolated HOME.
#   powershell -File scripts/site-shots.ps1      -> site/assets/hearth-app.webp, hearth-app-phone.webp, spec-review.webp, spec-build.webp
$root = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $env:TEMP 'hearth-site-shots'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
$p = Join-Path $tmp 'campfire-demo'
function W($rel, $text) { $f = Join-Path $p $rel; New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null; [IO.File]::WriteAllText($f, $text) }
W 'package.json' "{`n  `"name`": `"campfire-demo`",`n  `"version`": `"1.0.0`",`n  `"scripts`": { `"test`": `"node --test`" }`n}`n"
W 'README.md' "# campfire-demo`n`nA tiny demo project for Hearth IDE.`n"
W 'src\campfire.js' "'use strict';`n// Greets the people around the campfire.`nfunction greet(name) {`n  return ``Welcome to the fire, `${name}!``;`n}`n`nfunction warmth(logs) {`n  return Math.min(100, logs * 20);`n}`n`nmodule.exports = { greet, warmth };`n"
W 'test\campfire.test.js' "'use strict';`nconst test = require('node:test');`nconst assert = require('node:assert');`nconst { greet, warmth } = require('../src/campfire');`n`ntest('greet', () => assert.equal(greet('Ada'), 'Welcome to the fire, Ada!'));`ntest('warmth is capped', () => assert.equal(warmth(9), 100));`n"
# spec 1: requirements in review (one untestable criterion, open questions)
W '.hearth\specs\share-a-recipe\spec.json' "{`"name`": `"Share a recipe`", `"idea`": `"Share a campfire recipe as a link`", `"created`": `"2026-11-27T10:00:00.000Z`", `"approved`": {}, `"kind`": `"feature`", `"guided`": true, `"checks`": {}}"
W '.hearth\specs\share-a-recipe\requirements.md' @"
# Requirements: Share a recipe

People at the campfire want to pass a recipe on without copying it by hand.

### Requirement 1: Share link
**User Story:** As a cook, I want to share a recipe as a link, so that others can open it.

#### Acceptance Criteria
1. WHEN the cook presses Share THEN the system SHALL create a link to the recipe
2. WHEN someone opens the link THEN the system SHALL show the recipe read-only
3. the link should be short

### Requirement 2: Expiry
**User Story:** As a cook, I want links to expire, so that old recipes are not passed around forever.

#### Acceptance Criteria
1. WHEN a link is older than 30 days THEN the system SHALL show that it expired

## Open questions
- Can a cook revoke a link before it expires?
- Should opening a link require an account?
"@
# spec 2: everything approved, a third of the tasks done
W '.hearth\specs\ember-timer\spec.json' "{`"name`": `"Ember timer`", `"idea`": `"Warn before the fire goes out`", `"created`": `"2026-11-26T10:00:00.000Z`", `"approved`": {}, `"kind`": `"feature`", `"guided`": true, `"checks`": {}}"
W '.hearth\specs\ember-timer\requirements.md' @"
# Requirements: Ember timer

### Requirement 1: Countdown
**User Story:** As a camper, I want a countdown for the fire, so that I add wood in time.

1. WHEN logs are added THEN the system SHALL restart the countdown
2. WHEN the countdown reaches 5 minutes THEN the system SHALL warn the camper

### Requirement 2: Night mode
**User Story:** As a camper, I want a dim display at night, so that it does not dazzle.

1. WHILE it is night THEN the system SHALL dim the display

## Open questions
"@
W '.hearth\specs\ember-timer\design.md' "# Design: Ember timer`n`n## Overview`nRequirement 1 and 2 are met by a small timer module.`n`n## Architecture`nA timer service and a display.`n`n## Components and interfaces`n``startTimer(logs)``, ``onWarning(cb)```n`n## Data models`n``{ endsAt, warned }```n`n## Error handling`nNegative logs are rejected.`n`n## Testing strategy`nUnit tests with a fake clock.`n"
W '.hearth\specs\ember-timer\tasks.md' "# Tasks: Ember timer`n`n- [x] 1. Timer service`n  - Countdown restarts when logs are added`n  - _Requirements: 1.1_`n- [ ] 2. Warning five minutes before the end`n  - Fire onWarning once`n  - Test with a fake clock`n  - _Requirements: 1.2_`n- [ ] 3. Night mode for the display`n  - Dim between sunset and sunrise`n  - _Requirements: 2.1_`n"
Push-Location $p
git init -q -b main 2>$null; git config user.email demo@example.com; git config user.name Demo
git add . ; git commit -qm "Campfire basics" 2>$null
Pop-Location
# the agent's work: farewell() and its test (uncommitted)
W 'src\campfire.js' "'use strict';`n// Greets the people around the campfire.`nfunction greet(name) {`n  return ``Welcome to the fire, `${name}!``;`n}`n`nfunction farewell(name) {`n  return ``Good night, `${name}. The embers stay warm.``;`n}`n`nfunction warmth(logs) {`n  return Math.min(100, logs * 20);`n}`n`nmodule.exports = { greet, farewell, warmth };`n"
W 'test\campfire.test.js' "'use strict';`nconst test = require('node:test');`nconst assert = require('node:assert');`nconst { greet, farewell, warmth } = require('../src/campfire');`n`ntest('greet', () => assert.equal(greet('Ada'), 'Welcome to the fire, Ada!'));`ntest('farewell', () => assert.match(farewell('Ada'), /Good night, Ada/));`ntest('farewell keeps the embers', () => assert.match(farewell('Lin'), /embers/));`ntest('warmth is capped', () => assert.equal(warmth(9), 100));`n"
$body = Get-Content (Join-Path $root 'test\site-shots.js') -Raw
"(async()=>{const PROJECT=String.raw``$p``;return await $body})()" | Set-Content (Join-Path $tmp 'run.js') -Encoding utf8
$env:HEARTH_HOME = Join-Path $tmp 'home'
$env:HEARTH_SMOKE = Join-Path $tmp 'run.js'
$env:HEARTH_SMOKE_DIR = $p
$env:HEARTH_SHOT = Join-Path $tmp 'final.png'
$out = Join-Path $tmp 'out.txt'
Start-Process -FilePath (Join-Path $root 'node_modules\electron\dist\electron.exe') -ArgumentList '.' -WorkingDirectory $root `
  -RedirectStandardOutput $out -RedirectStandardError (Join-Path $tmp 'err.txt') -Wait -NoNewWindow
(Get-Content $out | Select-String 'SMOKE_RESULT' | Select-Object -Last 1).Line
foreach ($n in 'hearth-app.webp', 'hearth-app-phone.webp', 'spec-review.webp', 'spec-build.webp') {
  $f = Join-Path $tmp $n
  if (Test-Path $f) { Copy-Item $f (Join-Path $root "site\assets\$n") -Force; "copied $n" }
}
