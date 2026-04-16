# AutoJobApp

AutoJobApp is a Chrome extension project for speeding up repetitive job applications while keeping the user in control. The long-term goal is smart, confidence-based autofill for multi-step application flows. The project now has a working extension foundation, a versioned applicant profile schema, a field classification engine, a first-pass autofill engine, a usable profile editor plus fill preview workflow, a first adapter layer for major ATS platforms, local resume-import plus workflow guidance, and a real fixture-backed hardening suite.

## Step-by-step build plan

1. Scaffold the extension foundation and developer documentation.
2. Define the applicant profile schema and storage layer.
3. Build generic field scanning and field classification.
4. Add autofill for text inputs, selects, and textareas.
5. Build profile editing and fill preview UI.
6. Add ATS adapters for Greenhouse, Lever, and similar platforms.
7. Add resume import, answer templates, and multi-step workflows.
8. Add tests, fixtures, and hardening.
9. Add local resume file import, repeated-section fill upgrades, and browser E2E coverage.
10. Add popup profile switching, lazy-loaded resume parsers, and deeper ATS browser coverage.
11. Add configurable fill modes, an optional auto-submit toggle, and saved resume upload controls.
12. Add profile JSON import and export for backup and restore.
13. Add AI-assisted autofill with an OpenAI API key setting.
14. Add a fully auto AI override that can bypass the default AI review safeguard.
15. Add broader AI control settings for scope, priority, and custom instructions.

This repo is currently on Step 15.

## What Step 15 includes

- Manifest V3 extension scaffold
- Background service worker
- On-demand content script injection with `activeTab`
- Popup UI for scanning the current page and previewing what is ready to fill
- Options UI for editing the active applicant profile
- Versioned applicant profile schema with migration support
- Storage helpers for reading, writing, resetting, and updating the active profile
- Field-level DOM scanning with label, placeholder, ARIA, section, and option context
- Rule-based field classification with weighted confidence scores
- High-confidence autofill for text inputs, textareas, selects, radios, and checkboxes
- Controlled-input friendly event dispatching for modern frontend frameworks
- Fill result tracking showing which fields were filled, skipped, unsupported, or errored
- Draft-based profile editing for personal info, links, work authorization, skills, templates, and repeated resume sections
- Fill preview surfaces that separate ready fields from review-needed fields
- ATS adapter layer for Greenhouse, Lever, and Workday
- Adapter-aware label, section, grouping, and metadata extraction for known platforms
- Adapter notes surfaced in scan summaries for debugging
- Local pasted-resume import that updates the draft applicant profile
- Local resume file import for `.txt`, `.pdf`, and `.docx`
- Lazy-loaded resume parser chunks so PDF and DOCX logic only loads when a file import is requested
- Template suggestion surfaces for motivation, salary, relocation, sponsorship, and similar questions
- Multi-step workflow detection with current-step and next-action hints
- Popup profile switching across saved applicant profiles
- Popup duplication of the active profile for quick role-specific variants
- Extension settings for Conservative, Neutral, and Liberal autofill behavior
- Optional auto-submit that only targets strongly detected final submit controls
- Saved resume upload and linking inside the active applicant profile
- Profile JSON export for local backup of the current applicant profile
- Profile JSON import that restores either a raw profile backup or a full extension-state backup into the draft profile
- Optional AI-assisted autofill using the OpenAI Responses API
- A locally stored OpenAI API key slot in extension settings
- Review-first AI suggestions for ambiguous blank fields
- Auto-submit blocking whenever an AI suggestion was actually used to fill a field
- An explicit fully auto override that allows AI-assisted fills to continue to final submit when you intentionally turn that safeguard off
- AI scope controls so you can keep AI focused, expand it across text-style blanks, or make it aggressive across most supported non-sensitive fields
- AI priority controls so you can keep saved profile values first or let AI suggestions win when both exist
- Custom AI instructions for tone, style, and answer behavior
- Vitest plus jsdom test harness
- HTML fixtures for generic, Greenhouse, Lever, and Workday application pages
- Resume import fixture coverage
- Hardening around headless DOM scanning and content-script testability
- Repeated-section autofill that maps sequential experience, education, and project fields to sequential saved entries
- Repeated-section expansion for simple “Add another experience” style flows
- Playwright browser-level autofill verification against built generic, Greenhouse, Lever, and Workday fixture pages
- A debugging-friendly project structure

Step 15 is configurable where it matters. Conservative mode only autofills `high` confidence matches, Neutral adds `medium`, and Liberal adds `low`. Auto-submit stays off by default, live job-site file inputs still do not accept scripted uploads, profile backups can now be exported and re-imported as JSON, AI assist only runs when the user enables it and provides an OpenAI API key, AI-filled submits remain review-first unless you explicitly enable the fully auto override, and you can now choose how wide AI scope should be plus whether AI or the saved profile gets first priority.

## Project structure

```text
AutoJobApp/
|-- public/
|   |-- fixtures/
|   |   |-- greenhouse-application.html
|   |   |-- lever-application.html
|   |   |-- repeated-experience-application.html
|   |   `-- workday-application.html
|   `-- manifest.json
|-- scripts/
|   `-- e2e-server.mjs
|-- src/
|   |-- background/
|   |   `-- index.ts
|   |-- content/
|   |   |-- adapters.ts
|   |   |-- workflow.ts
|   |   `-- index.ts
|   |-- e2e/
|   |   `-- autofill.spec.ts
|   |-- options/
|   |   `-- main.tsx
|   |-- popup/
|   |   `-- main.tsx
|   |-- shared/
|   |   |-- ai.ts
|   |   |-- core.ts
|   |   |-- resume-file-helpers.ts
|   |   |-- resume-files.ts
|   |   `-- resume.ts
|   |-- test/
|   |   |-- fixture-loader.ts
|   |   `-- fixtures/
|   |       |-- generic-application.html
|   |       |-- greenhouse-application.html
|   |       |-- lever-application.html
|   |       |-- repeated-experience-application.html
|   |       |-- resume-sample.txt
|   |       `-- workday-application.html
|   `-- styles/
|       `-- global.css
|-- options.html
|-- package.json
|-- popup.html
|-- playwright.config.ts
|-- tsconfig.json
`-- vite.config.ts
```

## Architecture

### Background service worker

Responsible for:

- seeding default storage
- receiving popup commands
- injecting the content script into the active tab
- asking the content script to scan the page
- optionally requesting AI suggestions from OpenAI based on the configured AI control scope
- storing the last scan result

### Content script

Responsible for:

- scanning the current DOM on demand
- summarizing page structure
- detecting common ATS platform hints
- applying Greenhouse, Lever, and Workday adapter rules when a known platform is detected
- detecting likely multi-step application progress and next actions
- collecting field-level metadata for classifier input
- mapping candidate fields to profile keys with confidence scores
- filling controls according to the configured confidence threshold with framework-friendly events
- using background-provided AI suggestions as a fallback for ambiguous blank fields
- optionally clicking a strongly detected final submit control after fill when auto-submit is enabled
- blocking auto-submit if any AI-assisted fill was used on the page
- highlighting changed controls for manual review
- returning scan data without modifying the page

### ATS adapter layer

Responsible for:

- identifying when a page belongs to a known ATS platform
- extracting stronger labels and section headings from platform-specific wrappers
- adding platform metadata such as `data-automation-id` or `data-qa` into candidate hints
- preserving the generic fallback path when a site is unsupported or partially supported

### Resume import layer

Responsible for:

- parsing pasted resume text locally in the browser
- parsing local `.txt`, `.pdf`, and `.docx` resume files in the browser
- lazy-loading the file parser modules so the options UI stays lighter on first load
- extracting contact details, summary, skills, and first-pass experience or education hints
- updating the draft profile for review before the user saves it

### Repeated-fill layer

Responsible for:

- mapping repeated experience, education, and project fields to the corresponding saved entry instead of always reusing the first one
- looking for simple “add another” buttons before filling when the profile has more saved entries than visible form blocks
- keeping repeated-section behavior conservative when a page does not expose enough structure

### Test and hardening layer

Responsible for:

- exercising generic and ATS-specific scan behavior against repeatable HTML fixtures
- validating local resume parsing against a known sample input
- validating local file-import helpers for file-type detection and DOCX/PDF text normalization
- validating repeated-section fill behavior in jsdom and a real browser
- catching brittle DOM assumptions before they show up on real application pages
- keeping the content script importable in a test environment without live Chrome APIs

### Popup

Responsible for:

- showing current extension status
- editing the active fill mode, auto-submit toggle, AI scope, AI priority, and fully auto override
- switching between saved applicant profiles
- duplicating the active profile into a new variant
- triggering a page scan
- previewing fields that are ready to fill
- flagging ambiguous or incomplete matches for review
- linking to the options page

### Options page

Responsible for:

- editing the active applicant profile through a draft form
- editing extension-level fill mode, auto-submit, fully auto, AI scope, and AI priority settings
- editing the AI-assist toggle, locally stored OpenAI API key, and custom AI instructions
- linking a saved resume file to the active profile
- importing and exporting applicant profile JSON backups
- showing readiness metrics for the saved profile
- exposing the active applicant profile shape for debugging
- resetting state while we iterate
- surfacing last scan and last fill results

## Current storage model

The extension stores a versioned object under:

```text
autojobapp.state.v1
```

It currently contains:

- `schemaVersion`: current storage schema version
- `profiles[]`: one or more applicant profiles
- `activeProfileId`: which profile the extension should use
- `settings.fillMode`: Conservative, Neutral, or Liberal autofill behavior
- `settings.autoSubmit`: whether the extension should click a detected final submit control after fill
- `settings.fullyAutoEnabled`: whether AI-assisted fills may bypass the default review-before-submit safeguard
- `settings.aiAssistEnabled`: whether AI suggestions should run during scan or fill
- `settings.aiAssistScope`: how broadly AI should participate in field suggestion
- `settings.aiPreferGeneratedValues`: whether AI or the saved profile gets first choice when both have a value
- `settings.openAiApiKey`: the locally stored OpenAI API key used for optional AI assistance
- `settings.aiAssistModel`: the OpenAI model alias used for optional AI assistance
- `settings.aiCustomInstructions`: optional extra guidance appended to the AI system prompt
- `lastScan`: latest scan summary from the popup
- `lastResumeImport`: latest local resume-import summary from the options page
- `lastResumeImport.sourceKind`: whether the last import came from pasted text or a local file
- `lastResumeImport.sourceName`: last imported file name or pasted-text label
- `lastResumeImport.parserLabel`: which local parser path ran
- `debugMode`: simple debug toggle for later instrumentation
- `lastUpdatedAt`: storage timestamp for debugging and migration visibility

The latest scan now also includes:

- `adapterLabel`: which adapter shaped the latest scan
- `adapterNotes[]`: adapter-specific debug notes
- `workflow`: current step, detected steps, and next-action hints
- `fieldMatches[]`: per-field classification results
- `matchBreakdown`: high / medium / low / unmatched counts

The extension now also stores:

- `lastFill`: the latest autofill attempt summary and per-field outcomes
- `lastFill.strategy`: which fill mode was used on the most recent autofill run
- `lastFill.autoSubmitMessage`: whether auto-submit was disabled, skipped, or actually clicked a final submit control

The popup now treats profile changes as a fresh context:

- switching or duplicating the active profile clears the previous scan and fill preview so the next run reflects the new profile

The active profile currently includes:

- `personal`
- `contact`
- `links`
- `education[]`
- `experience[]`
- `projects[]`
- `skills[]`
- `certifications[]`
- `workAuthorization`
- `documents`
- `templates[]`

If an older Step 1 storage object is present, the extension migrates the legacy `profileSeed` into the new Step 2 profile shape automatically.

## How to run locally

1. Install dependencies:

```powershell
npm.cmd install
```

2. Build the extension:

```powershell
npm.cmd run build
```

3. Run the fixture-backed test suite:

```powershell
npm.cmd run test:run
```

4. Run the browser-level E2E autofill check:

```powershell
npm.cmd run test:e2e
```

5. Open Chrome and go to `chrome://extensions`
6. Enable Developer Mode
7. Click `Load unpacked`
8. Select the `dist` folder inside this project

## How to debug

### Popup

- Click the extension icon to open the popup
- Right-click the popup and inspect it to view UI logs and state

### Background service worker

1. Open `chrome://extensions`
2. Find AutoJobApp
3. Click `service worker`
4. Inspect logs for injection, storage, and scan errors

### Content script

- Open any supported page
- Run `Scan current page` from the popup
- Inspect the page DevTools console to verify scan-side messages if we add them in later steps

### Tests

- Run `npm.cmd run test:run` to execute the jsdom fixture suite
- Run `npm.cmd run test:e2e` to execute the Playwright browser fixture against built `dist/`
- The fixtures in `src/test/fixtures/` cover generic, Greenhouse, Lever, Workday, and pasted resume text
- The browser suite exercises the built content script against `public/fixtures/` pages for repeated sections plus Greenhouse, Lever, and Workday flows
- If a scan regression appears on a real site, add a minimal fixture first so the bug stays fixed

### Options page

- Open the options page from the popup
- Use it to edit the active profile, import pasted resume text into the draft, import or export profile JSON backups, save or reset your draft, and inspect the active profile JSON when debugging
- Use the lower debug sections to inspect field match breakdown, last fill summary, and the last scan snapshot
- Reset state there if the scaffold gets into a bad state while testing

## Privacy posture for the scaffold

- The extension uses `activeTab` instead of broad automatic page injection
- No background network calls are made unless AI assist is explicitly enabled
- When AI assist is enabled, reduced field context plus saved profile data may be sent to OpenAI
- Final submit clicks only happen when the user explicitly enables auto-submit
- AI-assisted fills require manual review before submit unless the fully auto override is explicitly enabled
- AI scope and AI priority stay conservative by default
- High-confidence autofill happens only when the user explicitly triggers it
- All state stays in local extension storage

## Step 1 acceptance criteria

- The extension builds into a loadable unpacked bundle
- The popup can trigger a DOM scan on the current tab
- The background worker stores the latest scan result
- The options page shows stored state and supports reset

## Step 2 acceptance criteria

- The extension stores a versioned applicant profile schema locally
- Existing Step 1 storage can migrate into the new shape
- The options page exposes the active profile and schema metadata for debugging
- The popup reflects that a real applicant profile is now present

## Step 3 acceptance criteria

- The content script returns field-level scan metadata instead of only page counts
- Candidate fields are mapped to profile keys with confidence scores
- The popup and options page surface matched, ambiguous, and unmatched fields
- The latest scan remains buildable and storable in local extension state

## Step 4 acceptance criteria

- The popup can trigger a real autofill pass on the active job application page
- Only high-confidence matches are autofilled by default
- Text inputs, textareas, selects, radios, and checkboxes use event dispatch compatible with controlled components
- Non-empty fields and file-upload controls are left alone and recorded in the fill summary

## Step 5 acceptance criteria

- The options page supports editing the active profile without manually editing JSON
- Draft changes can be saved or discarded cleanly
- The popup shows which detected fields are ready to fill versus which ones need review
- The active profile remains debuggable through stored state snapshots

## Step 6 acceptance criteria

- Greenhouse, Lever, and Workday pages use adapter-specific extraction before falling back to generic scanning
- Scan summaries expose which adapter ran and what platform-specific notes were applied
- Adapter-provided signals feed into field classification without breaking generic forms
- Autofill behavior remains conservative and manual-submit only

## Step 7 acceptance criteria

- The options page can parse pasted resume text locally and apply extracted values into the draft profile
- The popup surfaces template-backed question opportunities separately from generic field matches
- Scan summaries expose likely multi-step application progress and next actions
- Imported resume data and workflow hints remain review-first and never auto-submit

## Step 8 acceptance criteria

- Generic and ATS-specific scanning behavior is covered by repeatable fixture tests
- Local resume import has regression coverage against a known sample
- The content script can be imported and exercised under jsdom without Chrome runtime crashes
- Hardening fixes keep scan behavior stable in both headless tests and real browser execution

## Step 9 acceptance criteria

- The options page can parse local `.txt`, `.pdf`, and `.docx` resume files into the draft profile
- Repeated experience-style fields can fill sequential saved entries instead of only the first one
- Simple repeated-section add buttons can be expanded before fill when additional saved entries exist
- Browser-level Playwright coverage verifies the built content script against a live fixture page

## Step 10 acceptance criteria

- The popup can switch between saved applicant profiles and duplicate the active one into a new variant
- Changing the active profile clears stale scan and fill previews so the next scan reflects the correct data source
- Resume file parsing loads through lazy chunks instead of bloating the initial options bundle
- Browser-level Playwright coverage verifies built Greenhouse, Lever, and Workday fixture flows in addition to the repeated generic form

## Step 11 acceptance criteria

- The popup and options page can both show or edit the current fill mode and auto-submit setting
- Conservative, Neutral, and Liberal modes change which confidence bands are actually filled
- Auto-submit stays off by default and only targets strongly detected final submit controls
- A resume file can be linked as the saved resume for the active profile without requiring immediate parsing

## Step 12 acceptance criteria

- The options page can export the current applicant profile as a JSON backup file
- The options page can import either a raw profile JSON export or a full stored-state JSON backup into the current draft profile
- Imported backups are normalized into the current schema before they are saved
- Import remains review-first by updating the draft profile only until the user saves changes

## Step 13 acceptance criteria

- The options page exposes an AI-assist toggle and a locally stored OpenAI API key field
- The background worker can request structured AI suggestions for ambiguous blank fields during scan and fill
- The popup and options page both surface AI suggestion output for review
- Auto-submit is skipped whenever any AI suggestion was actually used to fill the page

## Step 14 acceptance criteria

- The popup and options page both expose a fully auto setting for AI-assisted autofill
- Fully auto remains off by default in fresh state and migrated state
- AI-assisted fills still block auto-submit unless the fully auto override is explicitly enabled
- When fully auto is enabled alongside auto-submit, AI-assisted fills may continue to the detected final submit control

## Step 15 acceptance criteria

- The popup and options page expose broader AI controls without enabling risky behavior by default
- AI scope defaults to focused and can be widened to expanded or aggressive
- Saved profile values remain first priority by default, but AI can be configured to take priority when both exist
- Optional custom AI instructions are stored in settings and included in AI requests

## Next step

The planned build sequence is complete. The highest-value follow-on work would be encrypted local document metadata, stronger confidence tuning for fields like Lever LinkedIn, better answer-template ranking, and more fixture growth for edge cases discovered on real application pages.
