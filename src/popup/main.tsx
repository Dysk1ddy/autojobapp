import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import {
  DetectedFieldMatch,
  FillMode,
  FilledFieldResult,
  RuntimeResponse,
  ScanSummary,
  StoredState,
  getActiveProfile,
  getFillModeDescription,
  getFillModeLabel,
  sendRuntimeMessage,
  shouldFillConfidence,
  summarizeApplicantProfile
} from "../shared/core";

const roadmap = [
  "Step 1: extension foundation",
  "Step 2: applicant profile schema",
  "Step 3: field detection and matching",
  "Step 4: autofill engine",
  "Step 5: profile editor and fill preview",
  "Step 6: ATS adapters",
  "Step 7: resume import, templates, and workflows",
  "Step 8: tests and hardening",
  "Step 9: file import, repeated fill, and browser QA",
  "Step 10: multi-profile popup flow, lazy parsers, and ATS browser QA",
  "Step 11: fill modes, auto-submit, and saved resume upload"
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
  const scanStatus = useMemo(
    () => getScanStatus(lastScan, fillableMatches.length, reviewMatches.length),
    [lastScan, fillableMatches.length, reviewMatches.length]
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
      }...`
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
            Step 11 adds live fill-mode controls, an optional auto-submit
            toggle, and clearer saved-resume visibility, so you can tune how
            aggressive the extension should be on each application flow.
          </p>
        </div>
        <div className="badge-row">
          <span className="badge badge-accent">
            Fill mode: {getFillModeLabel(fillMode)}
          </span>
          <span className="badge badge-warm">
            {autoSubmitEnabled ? "Auto-submit on" : "Manual submit"}
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
        </div>

        <p className="helper-line">
          Auto-submit only clicks strongly detected final submit controls after
          a fill attempt. It will not click generic next-step buttons.
        </p>
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
            Use the autofill button to apply only high-confidence values with
            saved answers to the current job application page.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Roadmap</h2>
          <span className="inline-note">Current milestone: Step 11</span>
        </div>
        <ul className="roadmap-list">
          {roadmap.map((item, index) => (
            <li key={item} className={index <= 10 ? "roadmap-active" : ""}>
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
        <p className="match-copy">{result.matchedKey ?? "No profile key"}</p>
        <p className="helper-line">{result.message}</p>
      </div>
    </article>
  );
}

function getScanStatus(
  scan: ScanSummary | null,
  readyToFill: number,
  reviewNeeded: number
) {
  if (!scan) {
    return {
      platform: "Not scanned",
      readyToFill: "0",
      reviewNeeded: "0"
    };
  }

  return {
    platform: scan.platform,
    readyToFill: String(readyToFill),
    reviewNeeded: String(reviewNeeded)
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
