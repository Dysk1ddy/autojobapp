# AutoJobApp

AutoJobApp is a Chrome extension for speeding up repetitive job applications while keeping the applicant in control. It stores one or more structured applicant profiles locally, scans job application pages, classifies fields, previews likely matches, autofills supported controls, and keeps detailed scan and fill summaries for debugging.

## How to use

### 1. Build and load the extension

```powershell
npm.cmd install
npm.cmd run build
```

Then:

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select this project's `dist` folder

### 2. Configure your profile in Options

Open the extension Options page and fill in:

- personal and contact details
- LinkedIn, GitHub, portfolio, and website links
- education, experience, projects, skills, and certifications
- work authorization and employer-specific screening answers
- reusable answer templates
- saved resume file for autofill uploads
- optional OpenAI API key and AI settings

You can also:

- import pasted resume text
- import local `.txt`, `.pdf`, or `.docx` resumes
- send extracted resume text to ChatGPT to help populate the draft profile
- export or restore profile JSON backups

### 3. Use it on an application page

1. Open a job application page
2. Open the popup
3. Choose the active applicant profile
4. Click `Scan current page`
5. Review the ready-to-fill fields and review-needed fields
6. Click `Autofill ready fields`
7. Manually review the page before submitting, unless you have explicitly enabled auto-submit

You can also trigger autofill with:

- `Ctrl` + `Shift` + `Y` on Windows/Linux
- `Command` + `Shift` + `Y` on macOS

Handshake mode has its own toggle shortcut:

- `Ctrl` + `Shift` + `H` on Windows/Linux
- `Command` + `Shift` + `H` on macOS

Indeed mode has its own toggle shortcut:

- `Ctrl` + `Shift` + `K` on Windows/Linux
- `Command` + `Shift` + `K` on macOS

The shortcut can be changed in `chrome://extensions/shortcuts`.

## What the extension does

### Profile and settings

- stores multiple applicant profiles locally
- supports active-profile switching from the popup
- supports draft-based editing in Options
- saves fill mode, auto-submit, fully auto, AI scope, AI priority, and custom AI instructions
- stores upload-ready resume metadata and file bytes locally for resume autofill
- supports JSON export and import for backup and restore

### Autofill behavior

- scans the current page on demand instead of injecting everywhere
- classifies fields using labels, placeholders, ARIA metadata, nearby text, section headings, names, ids, autocomplete hints, and option labels
- fills text inputs, textareas, selects, radios, checkboxes, contenteditable fields, ARIA textboxes, comboboxes, listboxes, and many custom choice controls
- retries fills when framework rerenders wipe values
- supports repeated experience, education, and project sections
- expands simple `Add another...` flows before filling when needed
- can auto-upload a saved resume when the page exposes a reachable file input
- never auto-submits unless the user explicitly enables auto-submit

### Yes/no screening policy

For yes/no dropdowns and radio-button questions:

- default answer is `No`
- exception: if the question is about being authorized or legally eligible to work, default answer is `Yes`

This policy is applied as a deterministic fallback for supported binary choice controls and is especially useful for employer-specific screening questions.

### Resume import

- local pasted-text parsing
- local `.txt`, `.pdf`, and `.docx` parsing
- lazy-loaded file parsers so the initial Options bundle stays lighter
- ChatGPT-assisted resume drafting from locally extracted resume text
- parse-only imports stay lightweight unless you explicitly link a file for upload

### AI assistance

- optional AI-assisted autofill using the OpenAI Responses API
- saved OpenAI API key and model configuration in Options
- default AI model: `gpt-5.4-nano` / GPT-5.4 nano
- API key verification inside Options before relying on AI features
- AI scope controls: Focused, Expanded, Aggressive
- AI priority control: saved profile first or AI first
- custom AI instructions
- review-first behavior by default
- fully auto override if you explicitly want AI-assisted fills to continue to final submit
- Handshake mode for `app.joinhandshake.com` job search pages: it only clicks in-Handshake `Apply` or `Quick Apply` controls, skips `Apply Externally`, rejects applications that ask for cover letters/transcripts/extra questions, submits resume-only applications, then scrolls or advances through more listings until toggled off
- Indeed mode for `indeed.com` job search pages: it only clicks in-page `Apply now` or `Easily apply` button controls, skips `Apply on company site`, rejects applications that ask for cover letters/additional questions, submits resume-only applications, then scrolls or advances through more listings until toggled off

### ATS and workflow support

- generic fallback field detection
- adapter-aware handling for Handshake, Indeed, Greenhouse, Lever, Workday, and Dover flows
- adapter notes surfaced in scan summaries for debugging
- workflow detection for likely current step, detected steps, and next actions

### Testing and hardening

- Vitest + jsdom unit and integration coverage
- fixture-backed DOM scanning and autofill tests
- Playwright browser-level autofill checks against built fixtures
- regression tests for resume import, AI resume parsing, screening questions, repeated sections, dropdown matching, radio handling, resume upload, and yes/no defaults

## Current feature summary

- Manifest V3 extension scaffold
- background service worker
- on-demand content script injection with `activeTab`
- popup workflow for scanning, reviewing, and autofilling the active page
- full Options workspace for editing profile data and extension settings
- versioned local storage schema with migration support
- profile summaries, scan summaries, fill summaries, and AI summaries for debugging
- resume upload support through saved local file data
- employer-specific screening fields such as:
  - ethnicity
  - self-identification language
  - age eligibility
  - legal work verification
  - termination history
  - friends or relatives at company
  - export-control prompts
  - board-of-directors disclosures

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
|   |   |-- form-fields.tsx
|   |   `-- main.tsx
|   |-- popup/
|   |   `-- main.tsx
|   |-- shared/
|   |   |-- ai.ts
|   |   |-- core.ts
|   |   |-- matching.ts
|   |   |-- resume-ai.ts
|   |   |-- resume-file-helpers.ts
|   |   |-- resume-files.ts
|   |   `-- resume.ts
|   |-- styles/
|   |   `-- global.css
|   `-- test/
|       |-- fixture-loader.ts
|       `-- fixtures/
|-- options.html
|-- popup.html
|-- playwright.config.ts
|-- tsconfig.json
|-- vite.config.ts
`-- vite.content.config.ts
```

## Architecture

### Background service worker

Responsible for:

- seeding and normalizing local extension state
- handling popup requests
- injecting the content script into the active tab
- storing the latest scan and fill results
- requesting optional AI suggestions
- handling ChatGPT resume parsing requests
- verifying OpenAI API access from the Options page

### Content script

Responsible for:

- scanning the DOM
- classifying fields
- applying adapter-specific hints
- filling supported controls with framework-friendly events
- retrying verification-sensitive fields
- uploading saved resumes to reachable file inputs
- returning scan and fill summaries without hiding what changed

### Popup

Responsible for:

- switching active profiles
- changing fill mode and AI behavior quickly
- scanning the current page
- previewing ready fields and review-needed fields
- running autofill
- surfacing workflow hints and the latest fill outcome

### Options page

Responsible for:

- editing the active applicant profile
- configuring extension behavior
- linking and importing resumes
- verifying OpenAI access
- importing and exporting JSON backups
- exposing active state, scan, and fill snapshots for debugging

## Storage model

The extension stores a versioned object under:

```text
autojobapp.state.v1
```

Important pieces include:

- `schemaVersion`
- `profiles[]`
- `activeProfileId`
- `settings.fillMode`
- `settings.autoSubmit`
- `settings.fullyAutoEnabled`
- `settings.aiAssistEnabled`
- `settings.aiAssistScope`
- `settings.aiPreferGeneratedValues`
- `settings.openAiApiKey`
- `settings.aiAssistModel`
- `settings.aiCustomInstructions`
- `lastScan`
- `lastFill`
- `lastResumeImport`
- `lastAiVerification`
- `profiles[].documents.resume.dataBase64`
- `lastUpdatedAt`

Older stored state is normalized on load, including legacy `profileSeed` data when present.

## Local development

### Useful commands

```powershell
npm.cmd run build
npm.cmd run test:run
npm.cmd run test:e2e
```

## Debugging

### Popup

- open the popup from the extension icon
- inspect popup DevTools if needed

### Background worker

1. Open `chrome://extensions`
2. Find AutoJobApp
3. Click `service worker`
4. Inspect logs for runtime, storage, and injection issues

### Content script

- scan a real application page from the popup
- use the Options page debug panels to inspect:
  - last scan snapshot
  - latest fill summary
  - AI assist summary
  - active profile JSON

### Tests

- `src/test/fixtures/` contains repeatable DOM fixtures
- `public/fixtures/` is used for browser-level E2E coverage
- add a minimal fixture when a real-site regression appears so the bug stays fixed

## Privacy and safety

- uses `activeTab` instead of broad automatic injection
- keeps profile data in local extension storage
- only talks to OpenAI when AI features are explicitly enabled
- keeps AI-assisted submit review-first by default
- auto-submit is opt-in
- resume file data stays local unless the user explicitly chooses to use AI features on extracted resume text

## Current limitations

- fully custom upload widgets may still require manual interaction
- cross-origin iframe content can still limit what a content script can reach
- adapter coverage is strongest on generic forms plus Greenhouse, Lever, Workday, and Dover
- AI assistance depends on a valid OpenAI key and network access

## Suggested next improvements

- stronger ATS adapter coverage beyond the current platforms
- more real-world fixtures from problematic application flows
- encrypted local document storage
- better answer-template ranking and job-specific caching
- richer debug export for failed scans and fills
