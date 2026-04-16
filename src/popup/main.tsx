import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import {
  AiAssistScope,
  DetectedFieldMatch,
  FillMode,
  FilledFieldResult,
  RuntimeResponse,
  ScanSummary,
  StoredState,
  getAiAssistScopeDescription,
  getAiAssistScopeLabel,
  getActiveProfile,
  getFillModeDescription,
  getFillModeLabel,
  sendRuntimeMessage,
  shouldFillConfidence,
  summarizeApplicantProfile
} from "../shared/core";

const popupHighlights = [
  "Scan the current application, preview ready matches, and autofill from the popup or keyboard shortcut.",
  "Use saved applicant profiles, JSON backups, upload-ready resumes, and draft-based options editing.",
  "Run deterministic autofill first, then optionally let AI assist on ambiguous blanks with review-first safeguards.",
  "Handle text fields, selects, radios, checkboxes, resume uploads, repeated sections, and common ATS flows.",
  "Default yes-no policy: answer No unless the question is about being authorized or legally eligible to work."
];

function PopupApp() {
  const [state, setState] = useState<StoredState | null>(null);
  const [status, setStatus] = useState("Loading extension state...");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshState();
  }, []);

  const lastScan = state?.lastScan ?? null;
  const lastFill = state?.lastFill ?? null;
  const fillMode = state?.settings.fillMode ?? "conservative";
  const autoSubmitEnabled = state?.settings.autoSubmit ?? false;
  const fullyAutoEnabled = state?.settings.fullyAutoEnabled ?? false;
  const aiAssistEnabled = state?.settings.aiAssistEnabled ?? false;
  const aiAssistScope = state?.settings.aiAssistScope ?? "focused";
  const aiPreferGeneratedValues =
    state?.settings.aiPreferGeneratedValues ?? false;
  const aiAssistConfigured = Boolean(state?.settings.openAiApiKey?.trim());
  const activeProfile = useMemo(
    () => (state ? getActiveProfile(state) : null),
    [state]
  );
  const profileOptions = useMemo(
    () =>
      state?.profiles.map((profile) => ({
        id: profile.id,
        label: profile.label
      })) ?? [],
    [state]
  );
  const profileSummary = useMemo(
    () => (activeProfile ? summarizeApplicantProfile(activeProfile) : null),
    [activeProfile]
  );
  const fillableMatches = useMemo(
    () => getFillableMatches(lastScan, fillMode),
    [lastScan, fillMode]
  );
  const reviewMatches = useMemo(
    () => getReviewMatches(lastScan, fillMode),
    [lastScan, fillMode]
  );
  const templateMatches = useMemo(() => getTemplateMatches(lastScan), [lastScan]);
  const aiSuggestions = useMemo(
    () => lastScan?.aiAssist.suggestions.slice(0, 6) ?? [],
    [lastScan]
  );
  const scanStatus = useMemo(
    () =>
      getScanStatus(
        lastScan,
        fillableMatches.length,
        reviewMatches.length,
        aiSuggestions.length
      ),
    [lastScan, fillableMatches.length, reviewMatches.length, aiSuggestions.length]
  );
  const latestFillResults = useMemo(
    () => lastFill?.results.slice(0, 6) ?? [],
    [lastFill]
  );

  async function refreshState() {
    const response = await sendRuntimeMessage({ type: "GET_STATE" });
    handleStateResponse(response, "Extension state loaded.");
  }

  async function runScan() {
    setBusy(true);
    setStatus("Scanning and classifying fields on the active tab...");

    try {
      const response = await sendRuntimeMessage({ type: "SCAN_ACTIVE_TAB" });
      handleStateResponse(response, response.ok ? "Scan completed." : status);
    } finally {
      setBusy(false);
    }
  }

  async function runFill() {
    setBusy(true);
    setStatus(
      `Autofilling ${getFillModeLabel(fillMode).toLowerCase()} matches${
        autoSubmitEnabled ? " and watching for a final submit button" : ""
      }${aiAssistEnabled ? " with AI assistance enabled" : ""}...`
    );

    try {
      const response = await sendRuntimeMessage({ type: "FILL_ACTIVE_TAB" });
      handleStateResponse(
        response,
        response.ok ? "Autofill attempt completed." : status
      );
    } finally {
      setBusy(false);
    }
  }

  async function switchActiveProfile(profileId: string) {
    if (!state || profileId === state.activeProfileId) {
      return;
    }

    setBusy(true);
    setStatus("Switching the active applicant profile...");

    try {
      const response = await sendRuntimeMessage({
        type: "SET_ACTIVE_PROFILE",
        profileId
      });
      handleStateResponse(
        response,
        response.ok
          ? "Active profile switched. Scan again to refresh page matches for this profile."
          : status
      );
    } finally {
      setBusy(false);
    }
  }

  async function duplicateActiveProfile() {
    setBusy(true);
    setStatus("Creating a profile copy from the active profile...");

    try {
      const response = await sendRuntimeMessage({
        type: "DUPLICATE_ACTIVE_PROFILE"
      });
      handleStateResponse(
        response,
        response.ok
          ? "Created a profile copy and set it active. Rename it in options when you are ready."
          : status
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateFillMode(nextFillMode: FillMode) {
    if (!state || nextFillMode === state.settings.fillMode) {
      return;
    }

    setBusy(true);
    setStatus(`Switching fill mode to ${getFillModeLabel(nextFillMode)}...`);

    try {
      const response = await sendRuntimeMessage({
        type: "UPDATE_SETTINGS",
        settings: {
          fillMode: nextFillMode
        }
      });
      handleStateResponse(
        response,
        response.ok
          ? `${getFillModeLabel(nextFillMode)} mode saved.`
          : status
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateAutoSubmit(nextAutoSubmit: boolean) {
    if (!state || nextAutoSubmit === state.settings.autoSubmit) {
      return;
    }

    setBusy(true);
    setStatus(nextAutoSubmit ? "Enabling auto-submit..." : "Disabling auto-submit...");

    try {
      const response = await sendRuntimeMessage({
        type: "UPDATE_SETTINGS",
        settings: {
          autoSubmit: nextAutoSubmit
        }
      });
      handleStateResponse(
        response,
        response.ok
          ? nextAutoSubmit
            ? "Auto-submit enabled. Final submit clicks remain opt-in and best-effort."
            : "Auto-submit disabled."
          : status
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateFullyAuto(nextFullyAutoEnabled: boolean) {
    if (!state || nextFullyAutoEnabled === state.settings.fullyAutoEnabled) {
      return;
    }

    setBusy(true);
    setStatus(
      nextFullyAutoEnabled
        ? "Enabling fully auto AI autofill..."
        : "Restoring AI review safeguards..."
    );

    try {
      const response = await sendRuntimeMessage({
        type: "UPDATE_SETTINGS",
        settings: {
          fullyAutoEnabled: nextFullyAutoEnabled
        }
      });
      handleStateResponse(
        response,
        response.ok
          ? nextFullyAutoEnabled
            ? "Fully auto enabled. AI-assisted fills may now auto-submit when auto-submit is also on."
            : "Fully auto disabled. AI-assisted fills will require review before submit again."
          : status
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateAiAssistScope(nextAiAssistScope: AiAssistScope) {
    if (!state || nextAiAssistScope === state.settings.aiAssistScope) {
      return;
    }

    setBusy(true);
    setStatus(`Switching AI control scope to ${getAiAssistScopeLabel(nextAiAssistScope)}...`);

    try {
      const response = await sendRuntimeMessage({
        type: "UPDATE_SETTINGS",
        settings: {
          aiAssistScope: nextAiAssistScope
        }
      });
      handleStateResponse(
        response,
        response.ok
          ? `${getAiAssistScopeLabel(nextAiAssistScope)} AI scope saved.`
          : status
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateAiPriority(nextAiPreferGeneratedValues: boolean) {
    if (
      !state ||
      nextAiPreferGeneratedValues === state.settings.aiPreferGeneratedValues
    ) {
      return;
    }

    setBusy(true);
    setStatus(
      nextAiPreferGeneratedValues
        ? "Letting AI suggestions take priority over saved profile values..."
        : "Restoring saved profile values as the first choice..."
    );

    try {
      const response = await sendRuntimeMessage({
        type: "UPDATE_SETTINGS",
        settings: {
          aiPreferGeneratedValues: nextAiPreferGeneratedValues
        }
      });
      handleStateResponse(
        response,
        response.ok
          ? nextAiPreferGeneratedValues
            ? "AI suggestions now take priority when both AI and the saved profile have a value."
            : "Saved profile values now take priority again."
          : status
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateAiAssist(nextAiAssistEnabled: boolean) {
    if (!state || nextAiAssistEnabled === state.settings.aiAssistEnabled) {
      return;
    }

    setBusy(true);
    setStatus(
      nextAiAssistEnabled
        ? "Enabling AI-assisted autofill..."
        : "Disabling AI-assisted autofill..."
    );

    try {
      const response = await sendRuntimeMessage({
        type: "UPDATE_SETTINGS",
        settings: {
          aiAssistEnabled: nextAiAssistEnabled
        }
      });
      handleStateResponse(
        response,
        response.ok
          ? nextAiAssistEnabled
            ? aiAssistConfigured
              ? "AI-assisted autofill enabled."
              : "AI assist enabled. Add an OpenAI API key in options to use it."
            : "AI-assisted autofill disabled."
          : status
      );
    } finally {
      setBusy(false);
    }
  }

  function handleStateResponse(
    response: RuntimeResponse,
    successMessage: string
  ) {
    if (!response.ok) {
      setStatus(response.error);
      return;
    }

    if (response.state) {
      setState(response.state);
    }

    setStatus(successMessage);
  }

  return (
    <main className="page-shell popup-shell">
      <section className="surface hero-card">
        <div className="hero-copy">
          <span className="eyebrow">AutoJobApp</span>
          <h1>Preview first. Fill second.</h1>
          <p>
            Scan the active application, preview what will change, and autofill
            with saved profile data, resume uploads, deterministic yes-no
            defaults, and optional AI assistance when you want extra help.
          </p>
        </div>
        <div className="badge-row">
          <span className="badge badge-accent">
            Fill mode: {getFillModeLabel(fillMode)}
          </span>
          <span className="badge badge-warm">
            {autoSubmitEnabled ? "Auto-submit on" : "Manual submit"}
          </span>
          <span className="badge">
            {aiAssistEnabled ? "AI assist on" : "AI assist off"}
          </span>
          <span className="badge">
            AI scope: {getAiAssistScopeLabel(aiAssistScope)}
          </span>
          <span className="badge">
            {fullyAutoEnabled ? "Fully auto on" : "Fully auto off"}
          </span>
        </div>
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Current status</h2>
          <span className="inline-note">{status}</span>
        </div>

        <div className="stat-grid">
          <article className="stat-card">
            <span className="stat-label">Platform</span>
            <strong>{scanStatus.platform}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Adapter</span>
            <strong>{lastScan?.adapterLabel ?? "Awaiting scan"}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Ready to fill</span>
            <strong>{scanStatus.readyToFill}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">AI suggestions</span>
            <strong>{scanStatus.aiSuggestions}</strong>
          </article>
        </div>

        {lastScan?.adapterNotes.length ? (
          <div className="match-list">
            {lastScan.adapterNotes.map((note) => (
              <article key={note} className="match-row">
                <div className="match-main">
                  <div className="match-title-row">
                    <strong className="match-title">ATS adapter note</strong>
                    <span className="confidence-pill confidence-high">active</span>
                  </div>
                  <p className="helper-line">{note}</p>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className="button-row">
          <button className="button" disabled={busy} onClick={runScan}>
            {busy ? "Working..." : "Scan current page"}
          </button>
          <button className="button button-secondary" disabled={busy} onClick={runFill}>
            {busy ? "Working..." : "Autofill ready fields"}
          </button>
          <button
            className="button button-ghost"
            disabled={busy}
            onClick={() => chrome.runtime.openOptionsPage()}
          >
            Open options
          </button>
        </div>
        <p className="helper-line">
          Shortcut: press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Y</kbd> to run
          autofill on the active tab. You can customize it in
          <code>chrome://extensions/shortcuts</code>.
        </p>
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Autofill settings</h2>
          <span className="inline-note">{getFillModeDescription(fillMode)}</span>
        </div>

        <div className="form-grid">
          <label className="field">
            <span className="field-label">Fill mode</span>
            <select
              className="field-control"
              disabled={busy}
              value={fillMode}
              onChange={(event) => void updateFillMode(event.target.value as FillMode)}
            >
              <option value="conservative">Conservative</option>
              <option value="neutral">Neutral</option>
              <option value="liberal">Liberal</option>
            </select>
            <span className="field-helper">
              Conservative fills only high-confidence matches. Neutral adds
              medium-confidence matches. Liberal also includes low-confidence
              matches.
            </span>
          </label>

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={autoSubmitEnabled}
              disabled={busy}
              onChange={(event) => void updateAutoSubmit(event.target.checked)}
            />
            <span className="field-label">Enable auto-submit</span>
          </label>

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={aiAssistEnabled}
              disabled={busy}
              onChange={(event) => void updateAiAssist(event.target.checked)}
            />
            <span className="field-label">Enable AI assist</span>
          </label>

          <label className="field">
            <span className="field-label">AI control scope</span>
            <select
              className="field-control"
              disabled={busy}
              value={aiAssistScope}
              onChange={(event) =>
                void updateAiAssistScope(event.target.value as AiAssistScope)
              }
            >
              <option value="focused">Focused</option>
              <option value="expanded">Expanded</option>
              <option value="aggressive">Aggressive</option>
            </select>
            <span className="field-helper">
              {getAiAssistScopeDescription(aiAssistScope)}
            </span>
          </label>

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={aiPreferGeneratedValues}
              disabled={busy}
              onChange={(event) => void updateAiPriority(event.target.checked)}
            />
            <span className="field-label">Prefer AI-generated values</span>
          </label>

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={fullyAutoEnabled}
              disabled={busy}
              onChange={(event) => void updateFullyAuto(event.target.checked)}
            />
            <span className="field-label">Fully auto AI autofill</span>
          </label>
        </div>

        <p className="helper-line">
          Auto-submit only clicks strongly detected final submit controls after
          a fill attempt. It will not click generic next-step buttons.
        </p>
        <p className="helper-line">
          AI assist uses your saved OpenAI API key from options, suggests values
          based on the selected AI control scope, and keeps AI-assisted submits
          review-first by default.
        </p>
        <p className="helper-line">
          {aiPreferGeneratedValues
            ? "AI suggestions currently take priority when both AI and the saved profile have a value."
            : "Saved profile values currently take priority when both AI and the model have a value."}
        </p>
        <p className="helper-line">
          Fully auto disables that AI review safeguard. When both auto-submit
          and AI assist are on, AI-filled pages may go straight to the final
          submit control.
        </p>
        {!aiAssistConfigured && aiAssistEnabled ? (
          <p className="helper-line">
            AI assist is turned on, but there is no API key saved yet. Add one
            in the options page.
          </p>
        ) : null}
        {fullyAutoEnabled ? (
          <p className="helper-line">
            Fully auto is enabled. Review-before-submit safeguards for AI-filled
            fields are currently off.
          </p>
        ) : null}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Active profile</h2>
          <span className="inline-note">
            {activeProfile ? activeProfile.label : "No profile loaded"}
          </span>
        </div>

        {profileSummary ? (
          <>
            <div className="form-grid">
              <label className="field field-span-2">
                <span className="field-label">Choose saved profile</span>
                <select
                  className="field-control"
                  disabled={busy || profileOptions.length === 0}
                  value={activeProfile?.id ?? ""}
                  onChange={(event) => void switchActiveProfile(event.target.value)}
                >
                  {profileOptions.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </select>
                <span className="field-helper">
                  Switching profiles clears the last scan preview so you can rescan
                  with the right saved answers.
                </span>
              </label>
            </div>

            <div className="button-row entry-actions">
              <button
                className="button button-ghost"
                disabled={busy || !activeProfile}
                onClick={() => void duplicateActiveProfile()}
              >
                {busy ? "Working..." : "Duplicate active profile"}
              </button>
              <button
                className="button button-ghost"
                disabled={busy}
                onClick={() => chrome.runtime.openOptionsPage()}
              >
                Rename or edit in options
              </button>
            </div>

            <div className="stat-grid">
              <article className="stat-card">
                <span className="stat-label">Core fields</span>
                <strong>
                  {profileSummary.filledCoreFields}/{profileSummary.totalCoreFields}
                </strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Experience</span>
                <strong>{profileSummary.experienceEntries}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Templates</span>
                <strong>{profileSummary.templateCount}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Saved profiles</span>
                <strong>{profileOptions.length}</strong>
              </article>
            </div>

            <div className="pill-list">
              <span className="pill">{activeProfile?.contact.email}</span>
              <span className="pill">{activeProfile?.links.linkedin}</span>
              <span className="pill">
                {activeProfile?.documents.resume?.fileName ?? "No saved resume"}
              </span>
            </div>
          </>
        ) : (
          <p className="muted">The popup is still loading the stored profile.</p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Application flow</h2>
          <span className="inline-note">
            {lastScan?.workflow.isMultiStepLikely
              ? "Multi-step flow detected"
              : "Single-step or no stepper detected"}
          </span>
        </div>

        {lastScan ? (
          <>
            <div className="stat-grid">
              <article className="stat-card">
                <span className="stat-label">Current step</span>
                <strong>{lastScan.workflow.currentStep || "Unknown"}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Detected steps</span>
                <strong>{lastScan.workflow.detectedSteps.length}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Next actions</span>
                <strong>{lastScan.workflow.nextActions.length}</strong>
              </article>
            </div>

            {lastScan.workflow.detectedSteps.length > 0 ? (
              <div className="pill-list">
                {lastScan.workflow.detectedSteps.map((step) => (
                  <span key={step} className="pill">
                    {step}
                  </span>
                ))}
              </div>
            ) : null}

            {lastScan.workflow.nextActions.length > 0 ? (
              <div className="pill-list">
                {lastScan.workflow.nextActions.map((action) => (
                  <span key={action} className="badge">
                    {action}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">
            Scan a job application page to detect the current step and likely
            next actions.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Ready to fill</h2>
          <span className="inline-note">
            {lastScan
              ? `${fillableMatches.length} saved ${getFillModeLabel(fillMode).toLowerCase()} matches`
              : "No scan yet"}
          </span>
        </div>

        {fillableMatches.length > 0 ? (
          <div className="match-list">
            {fillableMatches.map((match) => (
              <MatchCard
                key={match.fieldId}
                title={match.label || match.name || match.selectorHint}
                badge={match.confidence}
                copy={`${match.matchedLabel}${match.matchedKey ? ` -> ${match.matchedKey}` : ""}`}
                helper={`Preview: ${match.matchedValuePreview}`}
              />
            ))}
          </div>
        ) : (
          <p className="muted">
            Scan a job application page to see which fields are currently
            fillable under the active fill mode.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Template suggestions</h2>
          <span className="inline-note">
            {lastScan
              ? `${templateMatches.length} reusable answer opportunities`
              : "No scan yet"}
          </span>
        </div>

        {templateMatches.length > 0 ? (
          <div className="match-list">
            {templateMatches.map((match) => (
              <MatchCard
                key={match.fieldId}
                title={match.label || match.name || match.selectorHint}
                badge={match.confidence}
                copy={match.matchedLabel || "Template match"}
                helper={`Suggested answer: ${match.matchedValuePreview}`}
              />
            ))}
          </div>
        ) : (
          <p className="muted">
            Template-backed questions such as motivation, salary, relocation, or
            sponsorship will show up here after a scan.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>AI suggestions</h2>
          <span className="inline-note">
            {lastScan
              ? `${aiSuggestions.length} AI-backed suggestion${aiSuggestions.length === 1 ? "" : "s"}`
              : "No scan yet"}
          </span>
        </div>

        {aiSuggestions.length > 0 ? (
          <div className="match-list">
            {aiSuggestions.map((suggestion) => (
              <MatchCard
                key={suggestion.fieldId}
                title={suggestion.label || suggestion.selectorHint}
                badge={suggestion.confidence}
                copy={
                  suggestion.suggestedProfileLabel
                    ? `${suggestion.suggestedProfileLabel}${suggestion.suggestedProfileKey ? ` -> ${suggestion.suggestedProfileKey}` : ""}`
                    : "Generated answer"
                }
                helper={`${suggestion.valuePreview} | ${suggestion.reason}`}
              />
            ))}
          </div>
        ) : (
          <p className="muted">
            When AI assist is enabled and a scan finds ambiguous blank fields,
            suggestions will show up here before fill.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Needs review</h2>
          <span className="inline-note">
            {lastScan
              ? `${scanStatus.reviewNeeded} ambiguous or missing-value fields`
              : "Awaiting scan"}
          </span>
        </div>

        {reviewMatches.length > 0 ? (
          <div className="match-list">
            {reviewMatches.map((match) => (
              <MatchCard
                key={match.fieldId}
                title={match.label || match.name || match.selectorHint}
                badge={match.confidence}
                copy={match.matchedLabel || "No strong mapping yet"}
                helper={
                  match.hasValue
                    ? `Review before filling: ${match.matchedValuePreview}`
                    : "Mapped field is missing a saved value in the active profile"
                }
              />
            ))}
          </div>
        ) : (
          <p className="muted">
            When the classifier finds medium-confidence fields or missing saved
            values, they will show up here for manual review.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Last fill attempt</h2>
          <span className="inline-note">
            {lastFill ? new Date(lastFill.filledAt).toLocaleTimeString() : "No fill yet"}
          </span>
        </div>

        {lastFill ? (
          <>
            <div className="mini-grid">
              <div>
                <span className="mini-label">Filled</span>
                <strong>{lastFill.filled}</strong>
              </div>
              <div>
                <span className="mini-label">Skipped</span>
                <strong>{lastFill.skipped}</strong>
              </div>
              <div>
                <span className="mini-label">Unsupported</span>
                <strong>{lastFill.unsupported}</strong>
              </div>
              <div>
                <span className="mini-label">AI-filled</span>
                <strong>{lastFill.aiFilled}</strong>
              </div>
            </div>

            <p className="helper-line">
              Strategy: {getFillModeLabel(lastFill.strategy)}.{" "}
              {lastFill.autoSubmitMessage}
            </p>

            <div className="match-list">
              {latestFillResults.map((result) => (
                <FillResultCard key={result.fieldId} result={result} />
              ))}
            </div>
          </>
        ) : (
          <p className="muted">
            Use the autofill button or keyboard shortcut to apply the current
            profile, fill-mode rules, resume upload, and yes-no policy to the
            active job application page.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>What The Popup Does</h2>
          <span className="inline-note">Current scan, fill, and review controls</span>
        </div>
        <ul className="roadmap-list">
          {popupHighlights.map((item) => (
            <li key={item} className="roadmap-active">
              {item}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function MatchCard({
  title,
  badge,
  copy,
  helper
}: {
  title: string;
  badge: string;
  copy: string;
  helper: string;
}) {
  return (
    <article className="match-row">
      <div className="match-main">
        <div className="match-title-row">
          <strong className="match-title">{title}</strong>
          <span className={`confidence-pill confidence-${badge}`}>{badge}</span>
        </div>
        <p className="match-copy">{copy}</p>
        <p className="helper-line">{helper}</p>
      </div>
    </article>
  );
}

function FillResultCard({ result }: { result: FilledFieldResult }) {
  return (
    <article className="match-row">
      <div className="match-main">
        <div className="match-title-row">
          <strong className="match-title">{result.label}</strong>
          <span className={`confidence-pill confidence-${result.confidence}`}>
            {result.action}
          </span>
        </div>
        <p className="match-copy">
          {result.matchedKey ?? "No profile key"}
          {result.fillSource === "ai" ? " -> AI assist" : ""}
        </p>
        <p className="helper-line">{result.message}</p>
      </div>
    </article>
  );
}

function getScanStatus(
  scan: ScanSummary | null,
  readyToFill: number,
  reviewNeeded: number,
  aiSuggestions: number
) {
  if (!scan) {
    return {
      platform: "Not scanned",
      readyToFill: "0",
      reviewNeeded: "0",
      aiSuggestions: "0"
    };
  }

  return {
    platform: scan.platform,
    readyToFill: String(readyToFill),
    reviewNeeded: String(reviewNeeded),
    aiSuggestions: String(aiSuggestions)
  };
}

function getFillableMatches(
  scan: ScanSummary | null,
  fillMode: FillMode
): DetectedFieldMatch[] {
  if (!scan) {
    return [];
  }

  return sortMatches(scan.fieldMatches)
    .filter((match) => shouldFillConfidence(match.confidence, fillMode))
    .filter((match) => match.hasValue)
    .slice(0, 6);
}

function getReviewMatches(
  scan: ScanSummary | null,
  fillMode: FillMode
): DetectedFieldMatch[] {
  if (!scan) {
    return [];
  }

  return sortMatches(scan.fieldMatches)
    .filter((match) => match.confidence !== "unmatched")
    .filter(
      (match) => !shouldFillConfidence(match.confidence, fillMode) || !match.hasValue
    )
    .slice(0, 6);
}

function getTemplateMatches(scan: ScanSummary | null): DetectedFieldMatch[] {
  if (!scan) {
    return [];
  }

  return sortMatches(scan.fieldMatches)
    .filter((match) => match.matchedKey?.startsWith("templates."))
    .filter((match) => match.hasValue)
    .slice(0, 4);
}

function sortMatches(matches: DetectedFieldMatch[]): DetectedFieldMatch[] {
  return [...matches].sort((left, right) => {
    const confidenceDelta =
      confidenceRank(right.confidence) - confidenceRank(left.confidence);

    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    return right.score - left.score;
  });
}

function confidenceRank(confidence: DetectedFieldMatch["confidence"]): number {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

createRoot(document.getElementById("root")!).render(<PopupApp />);
