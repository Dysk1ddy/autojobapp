import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { CheckboxField, SelectField, TextAreaField, TextField } from "./form-fields";
import {
  AnswerTemplate,
  ApplicantProfile,
  CertificationEntry,
  DetectedFieldMatch,
  DocumentReference,
  EducationEntry,
  ExtensionSettings,
  ExperienceEntry,
  FillMode,
  ProjectEntry,
  RelocationPreference,
  STORAGE_KEY,
  StoredState,
  TemplateCategory,
  YesNoUnknown,
  createDefaultState,
  createDefaultSettings,
  getFillModeDescription,
  getFillModeLabel,
  getActiveProfile,
  parseApplicantProfileJson,
  readState,
  resetStoredState,
  saveActiveProfileAndSettingsInStorage,
  serializeApplicantProfile,
  shouldFillConfidence,
  summarizeApplicantProfile,
  toErrorMessage,
  updateStoredState,
  writeState
} from "../shared/core";
import { importResumeTextIntoProfile } from "../shared/resume";

const TEMPLATE_CATEGORIES: Array<{ label: string; value: TemplateCategory }> = [
  { label: "Cover note", value: "cover-note" },
  { label: "Motivation", value: "motivation" },
  { label: "Salary", value: "salary" },
  { label: "Relocation", value: "relocation" },
  { label: "Sponsorship", value: "sponsorship" },
  { label: "Work authorization", value: "work-authorization" },
  { label: "General", value: "general" }
];

const YES_NO_UNKNOWN_OPTIONS: Array<{ label: string; value: YesNoUnknown }> = [
  { label: "Unknown", value: "unknown" },
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" }
];

const RELOCATION_OPTIONS: Array<{
  label: string;
  value: RelocationPreference;
}> = [
  { label: "Case-by-case", value: "case-by-case" },
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" }
];

function OptionsApp() {
  const [state, setState] = useState<StoredState>(() => createDefaultState());
  const [draftProfile, setDraftProfile] = useState<ApplicantProfile | null>(
    null
  );
  const [draftSettings, setDraftSettings] = useState<ExtensionSettings>(
    () => createDefaultSettings()
  );
  const [resumeImportText, setResumeImportText] = useState("");
  const [resumeImportFile, setResumeImportFile] = useState<File | null>(null);
  const [resumeImportFileInputKey, setResumeImportFileInputKey] = useState(0);
  const [profileImportFile, setProfileImportFile] = useState<File | null>(null);
  const [profileImportFileInputKey, setProfileImportFileInputKey] = useState(0);
  const [status, setStatus] = useState("Loading settings...");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  const activeProfile = useMemo(() => getActiveProfile(state), [state]);
  const savedProfileSummary = useMemo(
    () => summarizeApplicantProfile(activeProfile),
    [activeProfile]
  );
  const draftSummary = useMemo(
    () =>
      summarizeApplicantProfile(draftProfile ? draftProfile : activeProfile),
    [draftProfile, activeProfile]
  );
  const fieldMatches = useMemo(
    () => getSortedMatches(state.lastScan?.fieldMatches ?? []),
    [state.lastScan]
  );
  const fillPreviewMatches = useMemo(
    () => getFillPreviewMatches(fieldMatches, draftSettings.fillMode),
    [fieldMatches, draftSettings.fillMode]
  );
  const isDirty = useMemo(
    () =>
      draftProfile
        ? JSON.stringify(draftProfile) !== JSON.stringify(activeProfile) ||
          JSON.stringify(draftSettings) !== JSON.stringify(state.settings)
        : false,
    [draftProfile, activeProfile, draftSettings, state.settings]
  );

  async function refresh() {
    const nextState = await readState();
    setState(nextState);
    setDraftProfile(cloneProfile(getActiveProfile(nextState)));
    setDraftSettings({ ...nextState.settings });
    setStatus("Settings loaded from extension storage.");
  }

  async function handleSaveProfile() {
    if (!draftProfile) {
      return;
    }

    setBusy(true);
    setStatus("Saving profile changes...");

    try {
      const nextState = await saveActiveProfileAndSettingsInStorage(
        cloneProfile(draftProfile),
        { ...draftSettings }
      );
      const nextProfile = cloneProfile(getActiveProfile(nextState));

      setState(nextState);
      setDraftProfile(nextProfile);
      setDraftSettings({ ...nextState.settings });
      setStatus("Profile and extension settings saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetStorage() {
    setBusy(true);
    setStatus("Resetting stored profile...");

    try {
      const nextState = await resetStoredState();
      const nextProfile = cloneProfile(getActiveProfile(nextState));

      setState(nextState);
      setDraftProfile(nextProfile);
      setDraftSettings({ ...nextState.settings });
      setStatus("Stored applicant schema reset to the latest default profile.");
    } finally {
      setBusy(false);
    }
  }

  function handleResetDraft() {
    setDraftProfile(cloneProfile(activeProfile));
    setDraftSettings({ ...state.settings });
    setStatus("Draft profile and settings reset to the last saved state.");
  }

  async function toggleDebugMode() {
    setBusy(true);

    try {
      const nextState = await writeState({
        ...state,
        debugMode: !state.debugMode,
        lastUpdatedAt: new Date().toISOString()
      });

      setState(nextState);
      setDraftProfile((current) =>
        current ? current : cloneProfile(getActiveProfile(nextState))
      );
      setStatus(
        nextState.debugMode ? "Debug mode enabled." : "Debug mode disabled."
      );
    } finally {
      setBusy(false);
    }
  }

  function updateDraftProfile(
    updater: (profile: ApplicantProfile) => ApplicantProfile
  ) {
    setDraftProfile((current) => (current ? updater(current) : current));
  }

  function updateDraftSettings(
    updater: (settings: ExtensionSettings) => ExtensionSettings
  ) {
    setDraftSettings((current) => updater(current));
  }

  function updatePersonalField(
    key: keyof ApplicantProfile["personal"],
    value: string
  ) {
    updateDraftProfile((profile) => ({
      ...profile,
      personal: { ...profile.personal, [key]: value }
    }));
  }

  function updateContactField(
    key: keyof ApplicantProfile["contact"],
    value: string
  ) {
    updateDraftProfile((profile) => ({
      ...profile,
      contact: { ...profile.contact, [key]: value }
    }));
  }

  function updateLinkField(key: keyof ApplicantProfile["links"], value: string) {
    updateDraftProfile((profile) => ({
      ...profile,
      links: { ...profile.links, [key]: value }
    }));
  }

  function updateWorkAuthorizationField(
    key: keyof ApplicantProfile["workAuthorization"],
    value: string | string[]
  ) {
    updateDraftProfile((profile) => ({
      ...profile,
      workAuthorization: {
        ...profile.workAuthorization,
        [key]: value
      }
    }));
  }

  function updateSkills(value: string) {
    updateDraftProfile((profile) => ({
      ...profile,
      skills: parseCommaSeparated(value)
    }));
  }

  function updateFillMode(value: FillMode) {
    updateDraftSettings((settings) => ({
      ...settings,
      fillMode: value
    }));
  }

  function updateAutoSubmit(value: boolean) {
    updateDraftSettings((settings) => ({
      ...settings,
      autoSubmit: value
    }));
  }

  function updateFullyAutoEnabled(value: boolean) {
    updateDraftSettings((settings) => ({
      ...settings,
      fullyAutoEnabled: value
    }));
  }

  function updateAiAssistEnabled(value: boolean) {
    updateDraftSettings((settings) => ({
      ...settings,
      aiAssistEnabled: value
    }));
  }

  function updateOpenAiApiKey(value: string) {
    updateDraftSettings((settings) => ({
      ...settings,
      openAiApiKey: value
    }));
  }

  function handleProfileImportSelection(event: ChangeEvent<HTMLInputElement>) {
    setProfileImportFile(event.target.files?.[0] ?? null);
  }

  async function handleProfileJsonImport() {
    if (!draftProfile || !profileImportFile) {
      return;
    }

    setBusy(true);
    setStatus(`Importing ${profileImportFile.name} into the draft profile...`);

    try {
      const importedJson = await profileImportFile.text();
      const importedProfile = parseApplicantProfileJson(
        importedJson,
        draftProfile
      );

      setDraftProfile(cloneProfile(importedProfile));
      setProfileImportFile(null);
      setProfileImportFileInputKey((current) => current + 1);
      setStatus(
        `${profileImportFile.name} was loaded into the draft profile. Save changes to keep it.`
      );
    } catch (error) {
      setStatus(`Profile import failed: ${toErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function clearProfileImportFile() {
    setProfileImportFile(null);
    setProfileImportFileInputKey((current) => current + 1);
    setStatus("Cleared the selected profile JSON backup.");
  }

  function handleProfileJsonExport() {
    const profileToExport = cloneProfile(draftProfile ?? activeProfile);
    const json = serializeApplicantProfile(profileToExport);
    const fileName = createProfileBackupFileName(profileToExport.label);

    downloadTextFile(fileName, json, "application/json");
    setStatus(
      `Exported ${profileToExport.label} as ${fileName}. Keep that file somewhere safe as your profile backup.`
    );
  }

  async function handleResumeImport() {
    if (!draftProfile) {
      return;
    }

    setBusy(true);
    setStatus("Parsing pasted resume text...");

    try {
      const result = importResumeTextIntoProfile(draftProfile, resumeImportText);
      const nextState = await updateStoredState((current) => ({
        ...current,
        lastResumeImport: result.summary
      }));

      setDraftProfile(result.profile);
      setState(nextState);
      setStatus(
        result.summary.importedFields.length > 0
          ? `Resume import updated ${result.summary.importedFields.length} profile areas.`
          : "Resume import finished with warnings."
      );
    } finally {
      setBusy(false);
    }
  }

  function handleResumeFileSelection(event: ChangeEvent<HTMLInputElement>) {
    setResumeImportFile(event.target.files?.[0] ?? null);
  }

  async function handleResumeFileImport() {
    if (!draftProfile || !resumeImportFile) {
      return;
    }

    setBusy(true);
    setStatus(`Loading the local parser for ${resumeImportFile.name}...`);

    try {
      const { extractTextFromResumeFile } = await import("../shared/resume-files");
      setStatus(`Parsing ${resumeImportFile.name} locally...`);
      const extracted = await extractTextFromResumeFile(resumeImportFile);
      const result = importResumeTextIntoProfile(draftProfile, extracted.text, {
        sourceKind: "local-file",
        sourceName: extracted.fileName,
        sourceMimeType: extracted.mimeType,
        parserLabel: extracted.parserLabel,
        warnings: extracted.warnings,
        documentReference: {
          name: extracted.fileName,
          fileName: extracted.fileName,
          mimeType: extracted.mimeType,
          source: "local"
        }
      });
      const nextState = await updateStoredState((current) => ({
        ...current,
        lastResumeImport: result.summary
      }));

      setDraftProfile(result.profile);
      setState(nextState);
      setResumeImportText(extracted.text);
      setResumeImportFile(null);
      setResumeImportFileInputKey((current) => current + 1);
      setStatus(
        result.summary.importedFields.length > 0
          ? `Imported ${resumeImportFile.name} into ${result.summary.importedFields.length} profile areas.`
          : `Parsed ${resumeImportFile.name}, but review the warnings before saving.`
      );
    } catch (error) {
      setStatus(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function clearResumeImportText() {
    setResumeImportText("");
    setStatus("Cleared the resume text draft.");
  }

  function clearResumeImportFile() {
    setResumeImportFile(null);
    setResumeImportFileInputKey((current) => current + 1);
    setStatus("Cleared the selected resume file.");
  }

  function linkSelectedResumeFile() {
    if (!draftProfile || !resumeImportFile) {
      return;
    }

    updateDraftProfile((profile) => ({
      ...profile,
      documents: {
        ...profile.documents,
        resume: createDocumentReferenceFromFile(resumeImportFile, "local")
      }
    }));
    setStatus(
      `${resumeImportFile.name} is linked as the saved resume for this profile. Save changes to keep it.`
    );
  }

  function removeLinkedResume() {
    if (!draftProfile) {
      return;
    }

    updateDraftProfile((profile) => ({
      ...profile,
      documents: {
        ...profile.documents,
        resume: null
      }
    }));
    setStatus("Removed the linked resume from the draft profile.");
  }

  function updateEducationEntry(
    index: number,
    updater: (entry: EducationEntry) => EducationEntry
  ) {
    updateDraftProfile((profile) => ({
      ...profile,
      education: profile.education.map((entry, entryIndex) =>
        entryIndex === index ? updater(entry) : entry
      )
    }));
  }

  function updateExperienceEntry(
    index: number,
    updater: (entry: ExperienceEntry) => ExperienceEntry
  ) {
    updateDraftProfile((profile) => ({
      ...profile,
      experience: profile.experience.map((entry, entryIndex) =>
        entryIndex === index ? updater(entry) : entry
      )
    }));
  }

  function updateProjectEntry(
    index: number,
    updater: (entry: ProjectEntry) => ProjectEntry
  ) {
    updateDraftProfile((profile) => ({
      ...profile,
      projects: profile.projects.map((entry, entryIndex) =>
        entryIndex === index ? updater(entry) : entry
      )
    }));
  }

  function updateCertificationEntry(
    index: number,
    updater: (entry: CertificationEntry) => CertificationEntry
  ) {
    updateDraftProfile((profile) => ({
      ...profile,
      certifications: profile.certifications.map((entry, entryIndex) =>
        entryIndex === index ? updater(entry) : entry
      )
    }));
  }

  function updateTemplateEntry(
    index: number,
    updater: (entry: AnswerTemplate) => AnswerTemplate
  ) {
    updateDraftProfile((profile) => ({
      ...profile,
      templates: profile.templates.map((entry, entryIndex) =>
        entryIndex === index ? updater(entry) : entry
      )
    }));
  }

  function addEducationEntry() {
    updateDraftProfile((profile) => ({
      ...profile,
      education: [...profile.education, createEducationEntry()]
    }));
  }

  function addExperienceEntry() {
    updateDraftProfile((profile) => ({
      ...profile,
      experience: [...profile.experience, createExperienceEntry()]
    }));
  }

  function addProjectEntry() {
    updateDraftProfile((profile) => ({
      ...profile,
      projects: [...profile.projects, createProjectEntry()]
    }));
  }

  function addCertificationEntry() {
    updateDraftProfile((profile) => ({
      ...profile,
      certifications: [...profile.certifications, createCertificationEntry()]
    }));
  }

  function addTemplateEntry() {
    updateDraftProfile((profile) => ({
      ...profile,
      templates: [...profile.templates, createTemplateEntry()]
    }));
  }

  function removeEducationEntry(index: number) {
    updateDraftProfile((profile) => ({
      ...profile,
      education: removeAt(profile.education, index)
    }));
  }

  function removeExperienceEntry(index: number) {
    updateDraftProfile((profile) => ({
      ...profile,
      experience: removeAt(profile.experience, index)
    }));
  }

  function removeProjectEntry(index: number) {
    updateDraftProfile((profile) => ({
      ...profile,
      projects: removeAt(profile.projects, index)
    }));
  }

  function removeCertificationEntry(index: number) {
    updateDraftProfile((profile) => ({
      ...profile,
      certifications: removeAt(profile.certifications, index)
    }));
  }

  function removeTemplateEntry(index: number) {
    updateDraftProfile((profile) => ({
      ...profile,
      templates: removeAt(profile.templates, index)
    }));
  }

  return (
    <main className="page-shell options-shell">
      <section className="surface hero-card wide-hero">
        <div className="hero-copy">
          <span className="eyebrow">Step 14 AI assist, fully auto, and workflow control</span>
          <h1>Edit what gets filled before you ever touch submit.</h1>
          <p>
            The options page now works like a real drafting workspace instead of
            a raw JSON viewer. You can update the active applicant profile,
            change how aggressive autofill should be, opt into final-step
            auto-submit, enable AI-assisted autofill with your own OpenAI API
            key, decide whether AI-assisted fills must stay review-first or can
            run fully auto, upload a saved resume reference, import resume files
            or pasted text into the draft profile with on-demand parsers, and
            inspect both ATS adapter behavior and multi-step application flow.
          </p>
        </div>
        <div className="badge-row">
          <span className="badge badge-accent">Storage key: {STORAGE_KEY}</span>
          <span className="badge badge-warm">
            Schema v{state.schemaVersion}
          </span>
          <span className={`status-pill ${isDirty ? "status-dirty" : "status-saved"}`}>
            {isDirty ? "Unsaved draft" : "Saved"}
          </span>
        </div>
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Workspace controls</h2>
          <span className="inline-note">{status}</span>
        </div>

        <div className="button-row">
          <button className="button" disabled={busy} onClick={refresh}>
            {busy ? "Working..." : "Refresh state"}
          </button>
          <button
            className="button button-secondary"
            disabled={busy || !draftProfile || !isDirty}
            onClick={handleSaveProfile}
          >
            {busy ? "Working..." : "Save profile changes"}
          </button>
          <button
            className="button button-ghost"
            disabled={busy || !draftProfile || !isDirty}
            onClick={handleResetDraft}
          >
            Reset draft
          </button>
          <button
            className="button button-ghost"
            disabled={busy}
            onClick={toggleDebugMode}
          >
            {state.debugMode ? "Disable debug mode" : "Enable debug mode"}
          </button>
          <button
            className="button button-ghost"
            disabled={busy}
            onClick={handleResetStorage}
          >
            Reset stored profile
          </button>
        </div>
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Profile backup</h2>
          <span className="inline-note">
            Import or export the active applicant profile as JSON
          </span>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="profile-json-input">Profile JSON backup</label>
            <input
              id="profile-json-input"
              key={profileImportFileInputKey}
              type="file"
              accept=".json,application/json"
              onChange={handleProfileImportSelection}
            />
            <p className="helper-line">
              Import accepts either a raw applicant profile export or a full
              extension-state JSON backup.
            </p>
          </div>
        </div>

        <div className="button-row">
          <button
            className="button"
            disabled={busy}
            onClick={handleProfileJsonExport}
          >
            Export current draft JSON
          </button>
          <button
            className="button button-secondary"
            disabled={busy || !draftProfile || !profileImportFile}
            onClick={handleProfileJsonImport}
          >
            {busy ? "Working..." : "Import selected JSON"}
          </button>
          <button
            className="button button-ghost"
            disabled={busy || !profileImportFile}
            onClick={clearProfileImportFile}
          >
            Clear selected JSON
          </button>
        </div>

        <div className="mini-grid">
          <div>
            <span className="mini-label">Selected backup</span>
            <strong>{profileImportFile ? profileImportFile.name : "None"}</strong>
          </div>
          <div>
            <span className="mini-label">Export source</span>
            <strong>{draftProfile?.label ?? activeProfile.label}</strong>
          </div>
          <div>
            <span className="mini-label">Restore behavior</span>
            <strong>Draft only until saved</strong>
          </div>
        </div>

        <p className="muted">
          Import does not overwrite storage immediately. It replaces the current
          draft profile, then waits for you to click <strong>Save profile changes</strong>.
        </p>
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Profile readiness</h2>
          <span className="inline-note">
            Active profile: {draftProfile?.label ?? activeProfile.label}
          </span>
        </div>

        <div className="stat-grid">
          <article className="stat-card">
            <span className="stat-label">Core fields ready</span>
            <strong>
              {draftSummary.filledCoreFields}/{draftSummary.totalCoreFields}
            </strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Experience entries</span>
            <strong>{draftSummary.experienceEntries}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Fill preview matches</span>
            <strong>{fillPreviewMatches.length}</strong>
          </article>
        </div>

        <div className="mini-grid">
          <div>
            <span className="mini-label">Skills</span>
            <strong>{draftSummary.skillCount}</strong>
          </div>
          <div>
            <span className="mini-label">Templates</span>
            <strong>{draftSummary.templateCount}</strong>
          </div>
          <div>
            <span className="mini-label">Last saved</span>
            <strong>{formatShortDate(activeProfile.updatedAt)}</strong>
          </div>
        </div>
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Autofill settings</h2>
          <span className="inline-note">
            {getFillModeDescription(draftSettings.fillMode)}
          </span>
        </div>

        <div className="form-grid">
          <SelectField
            label="Fill mode"
            value={draftSettings.fillMode}
            options={[
              { label: "Conservative", value: "conservative" },
              { label: "Neutral", value: "neutral" },
              { label: "Liberal", value: "liberal" }
            ]}
            helper="Conservative fills only high-confidence matches. Neutral also fills medium-confidence matches. Liberal adds low-confidence matches too."
            onChange={(value) => updateFillMode(value as FillMode)}
          />

          <CheckboxField
            label="Enable auto-submit after fill"
            checked={draftSettings.autoSubmit}
            onChange={updateAutoSubmit}
          />

          <CheckboxField
            label="Fully auto AI autofill"
            checked={draftSettings.fullyAutoEnabled}
            helper="Turns off the default AI review safeguard. If auto-submit and AI assist are both enabled, AI-filled pages may go straight to the final submit control."
            onChange={updateFullyAutoEnabled}
          />

          <CheckboxField
            label="Enable AI-assisted autofill"
            checked={draftSettings.aiAssistEnabled}
            onChange={updateAiAssistEnabled}
          />

          <TextField
            className="field-span-2"
            label="OpenAI API key"
            value={draftSettings.openAiApiKey}
            type="password"
            helper="Saved in local extension storage so the background worker can request AI suggestions. This is convenient for local use, but still less secure than routing requests through your own backend."
            onChange={updateOpenAiApiKey}
          />
        </div>

        <div className="mini-grid">
          <div>
            <span className="mini-label">Current mode</span>
            <strong>{getFillModeLabel(draftSettings.fillMode)}</strong>
          </div>
          <div>
            <span className="mini-label">Auto-submit</span>
            <strong>{draftSettings.autoSubmit ? "Enabled" : "Disabled"}</strong>
          </div>
          <div>
            <span className="mini-label">AI assist</span>
            <strong>{draftSettings.aiAssistEnabled ? "Enabled" : "Disabled"}</strong>
          </div>
          <div>
            <span className="mini-label">Fully auto</span>
            <strong>{draftSettings.fullyAutoEnabled ? "Enabled" : "Disabled"}</strong>
          </div>
          <div>
            <span className="mini-label">API key</span>
            <strong>{draftSettings.openAiApiKey.trim() ? "Saved locally" : "Not saved"}</strong>
          </div>
          <div>
            <span className="mini-label">AI model</span>
            <strong>{draftSettings.aiAssistModel}</strong>
          </div>
          <div>
            <span className="mini-label">Safety note</span>
            <strong>
              {draftSettings.fullyAutoEnabled
                ? "AI review guard off"
                : draftSettings.autoSubmit
                  ? "Final submit only"
                  : "Manual review first"}
            </strong>
          </div>
        </div>

        <p className="helper-line">
          Auto-submit only attempts a strongly detected final submit control
          after a fill run. It does not click generic continue or next-step
          buttons.
        </p>
        <p className="helper-line">
          AI assist only runs when you trigger a scan or fill. It sends reduced
          field context plus your saved profile data to OpenAI to suggest values
          for ambiguous blanks, and it blocks auto-submit if any AI suggestion
          was used to fill the page unless fully auto is enabled.
        </p>
        {draftSettings.fullyAutoEnabled ? (
          <p className="helper-line">
            Fully auto is enabled. AI-assisted fills can now bypass the normal
            review-before-submit safeguard.
          </p>
        ) : null}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Resume import</h2>
          <span className="inline-note">
            Upload a saved resume or parse one locally into the draft profile
          </span>
        </div>

        <div className="form-grid">
          <div className="field field-span-2">
            <label className="field-label" htmlFor="resume-file-import">
              Upload resume file
            </label>
            <input
              key={resumeImportFileInputKey}
              id="resume-file-import"
              className="field-control file-input"
              type="file"
              accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleResumeFileSelection}
            />
            <p className="helper-line">
              Select a `.txt`, `.pdf`, or `.docx` resume to either link it as
              the saved resume for this profile or parse it locally into the
              draft fields below.
            </p>
            {resumeImportFile ? (
              <p className="helper-line">
                Selected file: {resumeImportFile.name}
              </p>
            ) : null}
          </div>

          <TextAreaField
            className="field-span-2"
            label="Paste resume text"
            helper="Paste plain text from a resume, LinkedIn export, or notes document. File imports also copy their extracted text here for debugging."
            rows={8}
            value={resumeImportText}
            onChange={setResumeImportText}
          />
        </div>

        <div className="button-row entry-actions">
          <button
            className="button"
            disabled={busy || !draftProfile || !resumeImportFile}
            onClick={linkSelectedResumeFile}
          >
            {busy ? "Working..." : "Link selected file as saved resume"}
          </button>
          <button
            className="button button-secondary"
            disabled={busy || !draftProfile || !resumeImportFile}
            onClick={handleResumeFileImport}
          >
            {busy ? "Working..." : "Parse and import selected file"}
          </button>
          <button
            className="button button-secondary"
            disabled={busy || !draftProfile || !resumeImportText.trim()}
            onClick={handleResumeImport}
          >
            {busy ? "Working..." : "Import pasted text"}
          </button>
          <button
            className="button button-ghost"
            disabled={busy || !resumeImportFile}
            onClick={clearResumeImportFile}
          >
            Clear selected file
          </button>
          <button
            className="button button-ghost"
            disabled={busy || !resumeImportText}
            onClick={clearResumeImportText}
          >
            Clear pasted text
          </button>
        </div>

        {state.lastResumeImport ? (
          <>
            <div className="stat-grid">
              <article className="stat-card">
                <span className="stat-label">Imported fields</span>
                <strong>{state.lastResumeImport.importedFields.length}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Source</span>
                <strong>{state.lastResumeImport.sourceName}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Imported at</span>
                <strong>
                  {new Date(state.lastResumeImport.importedAt).toLocaleTimeString()}
                </strong>
              </article>
            </div>

            <div className="pill-list">
              <span className="pill">{state.lastResumeImport.sourceKind}</span>
              <span className="pill">{state.lastResumeImport.parserLabel}</span>
              <span className="pill">{state.lastResumeImport.sourceMimeType}</span>
              <span className="pill">
                {state.lastResumeImport.warnings.length} warning
                {state.lastResumeImport.warnings.length === 1 ? "" : "s"}
              </span>
            </div>

            {state.lastResumeImport.importedFields.length > 0 ? (
              <div className="pill-list">
                {state.lastResumeImport.importedFields.map((field) => (
                  <span key={field} className="pill">
                    {field}
                  </span>
                ))}
              </div>
            ) : null}

            {state.lastResumeImport.warnings.length > 0 ? (
              <div className="match-list">
                {state.lastResumeImport.warnings.map((warning) => (
                  <article key={warning} className="match-row">
                    <div className="match-main">
                      <div className="match-title-row">
                        <strong className="match-title">Import warning</strong>
                        <span className="confidence-pill confidence-medium">
                          review
                        </span>
                      </div>
                      <p className="helper-line">{warning}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </>
        ) : (
            <p className="muted">
              No resume import run yet. Imported values stay in the draft until
              you save the profile, and the original upload never leaves the
              browser.
            </p>
          )}
        </section>

      {draftProfile ? (
        <>
          <section className="surface">
            <div className="section-head">
              <h2>Identity</h2>
              <span className="inline-note">
                Saved profile: {savedProfileSummary.label}
              </span>
            </div>

            <div className="form-grid">
              <TextField
                label="Profile label"
                value={draftProfile.label}
                onChange={(value) =>
                  updateDraftProfile((profile) => ({
                    ...profile,
                    label: value
                  }))
                }
              />
              <TextField
                label="Full name"
                value={draftProfile.personal.fullName}
                onChange={(value) => updatePersonalField("fullName", value)}
              />
              <TextField
                label="First name"
                value={draftProfile.personal.firstName}
                onChange={(value) => updatePersonalField("firstName", value)}
              />
              <TextField
                label="Last name"
                value={draftProfile.personal.lastName}
                onChange={(value) => updatePersonalField("lastName", value)}
              />
              <TextField
                label="Preferred name"
                value={draftProfile.personal.preferredName}
                onChange={(value) =>
                  updatePersonalField("preferredName", value)
                }
              />
              <TextField
                label="Pronouns"
                value={draftProfile.personal.pronouns}
                onChange={(value) => updatePersonalField("pronouns", value)}
              />
              <TextField
                className="field-span-2"
                label="Headline"
                value={draftProfile.personal.headline}
                onChange={(value) => updatePersonalField("headline", value)}
              />
              <TextAreaField
                className="field-span-2"
                label="Professional summary"
                rows={5}
                value={draftProfile.personal.summary}
                onChange={(value) => updatePersonalField("summary", value)}
              />
            </div>
          </section>

          <section className="surface">
            <div className="section-head">
              <h2>Contact and links</h2>
              <span className="inline-note">
                Keep the common autofill fields current here
              </span>
            </div>

            <div className="form-grid">
              <TextField
                label="Email"
                type="email"
                value={draftProfile.contact.email}
                onChange={(value) => updateContactField("email", value)}
              />
              <TextField
                label="Phone"
                type="tel"
                value={draftProfile.contact.phone}
                onChange={(value) => updateContactField("phone", value)}
              />
              <TextField
                className="field-span-2"
                label="Address line 1"
                value={draftProfile.contact.addressLine1}
                onChange={(value) => updateContactField("addressLine1", value)}
              />
              <TextField
                className="field-span-2"
                label="Address line 2"
                value={draftProfile.contact.addressLine2}
                onChange={(value) => updateContactField("addressLine2", value)}
              />
              <TextField
                label="City"
                value={draftProfile.contact.city}
                onChange={(value) => updateContactField("city", value)}
              />
              <TextField
                label="State / province"
                value={draftProfile.contact.state}
                onChange={(value) => updateContactField("state", value)}
              />
              <TextField
                label="Postal code"
                value={draftProfile.contact.postalCode}
                onChange={(value) => updateContactField("postalCode", value)}
              />
              <TextField
                label="Country"
                value={draftProfile.contact.country}
                onChange={(value) => updateContactField("country", value)}
              />
              <TextField
                className="field-span-2"
                label="LinkedIn URL"
                value={draftProfile.links.linkedin}
                onChange={(value) => updateLinkField("linkedin", value)}
              />
              <TextField
                className="field-span-2"
                label="GitHub URL"
                value={draftProfile.links.github}
                onChange={(value) => updateLinkField("github", value)}
              />
              <TextField
                className="field-span-2"
                label="Portfolio URL"
                value={draftProfile.links.portfolio}
                onChange={(value) => updateLinkField("portfolio", value)}
              />
              <TextField
                className="field-span-2"
                label="Website URL"
                value={draftProfile.links.website}
                onChange={(value) => updateLinkField("website", value)}
              />
            </div>
          </section>

          <section className="surface">
            <div className="section-head">
              <h2>Work authorization</h2>
              <span className="inline-note">
                Reuse the common eligibility answers across portals
              </span>
            </div>

            <div className="form-grid">
              <TextField
                className="field-span-2"
                label="Authorized countries"
                helper="Comma-separated. Example: United States, Canada"
                value={draftProfile.workAuthorization.authorizedCountries.join(
                  ", "
                )}
                onChange={(value) =>
                  updateWorkAuthorizationField(
                    "authorizedCountries",
                    parseCommaSeparated(value)
                  )
                }
              />
              <SelectField
                label="Requires sponsorship"
                value={draftProfile.workAuthorization.requiresSponsorship}
                options={YES_NO_UNKNOWN_OPTIONS}
                onChange={(value) =>
                  updateWorkAuthorizationField("requiresSponsorship", value)
                }
              />
              <SelectField
                label="Requires future sponsorship"
                value={draftProfile.workAuthorization.requiresFutureSponsorship}
                options={YES_NO_UNKNOWN_OPTIONS}
                onChange={(value) =>
                  updateWorkAuthorizationField(
                    "requiresFutureSponsorship",
                    value
                  )
                }
              />
              <SelectField
                label="Willing to relocate"
                value={draftProfile.workAuthorization.willingToRelocate}
                options={RELOCATION_OPTIONS}
                onChange={(value) =>
                  updateWorkAuthorizationField("willingToRelocate", value)
                }
              />
              <TextField
                label="Remote work preference"
                value={draftProfile.workAuthorization.remoteWorkPreference}
                onChange={(value) =>
                  updateWorkAuthorizationField("remoteWorkPreference", value)
                }
              />
              <TextField
                label="Veteran status"
                value={draftProfile.workAuthorization.veteranStatus}
                onChange={(value) =>
                  updateWorkAuthorizationField("veteranStatus", value)
                }
              />
              <TextField
                label="Disability status"
                value={draftProfile.workAuthorization.disabilityStatus}
                onChange={(value) =>
                  updateWorkAuthorizationField("disabilityStatus", value)
                }
              />
              <TextField
                label="Gender"
                value={draftProfile.workAuthorization.gender}
                onChange={(value) =>
                  updateWorkAuthorizationField("gender", value)
                }
              />
              <TextField
                label="Ethnicity"
                value={draftProfile.workAuthorization.ethnicity}
                onChange={(value) =>
                  updateWorkAuthorizationField("ethnicity", value)
                }
              />
              <TextField
                label="Clearance status"
                value={draftProfile.workAuthorization.clearanceStatus}
                onChange={(value) =>
                  updateWorkAuthorizationField("clearanceStatus", value)
                }
              />
            </div>
          </section>

          <section className="surface">
            <div className="section-head">
              <h2>Skills</h2>
              <span className="inline-note">
                Skills help populate text fields and keyword sections
              </span>
            </div>

            <div className="form-grid">
              <TextAreaField
                className="field-span-2"
                label="Skills"
                helper="Comma-separated values are easiest to edit."
                rows={4}
                value={draftProfile.skills.join(", ")}
                onChange={updateSkills}
              />
            </div>
          </section>

          <section className="surface">
            <div className="section-head">
              <h2>Answer templates</h2>
              <span className="inline-note">
                Reusable responses for common application questions
              </span>
            </div>

            <div className="button-row entry-actions">
              <button className="button button-ghost" onClick={addTemplateEntry}>
                Add template
              </button>
            </div>

            {draftProfile.templates.length > 0 ? (
              <div className="entry-stack">
                {draftProfile.templates.map((template, index) => (
                  <article key={template.id} className="entry-card">
                    <div className="entry-card-head">
                      <div>
                        <strong>
                          {template.title || `Template ${index + 1}`}
                        </strong>
                        <p className="helper-line">
                          Match repeated questions without retyping.
                        </p>
                      </div>
                      <button
                        className="mini-button"
                        onClick={() => removeTemplateEntry(index)}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="form-grid">
                      <TextField
                        label="Template title"
                        value={template.title}
                        onChange={(value) =>
                          updateTemplateEntry(index, (entry) => ({
                            ...entry,
                            title: value
                          }))
                        }
                      />
                      <SelectField
                        label="Category"
                        value={template.category}
                        options={TEMPLATE_CATEGORIES}
                        onChange={(value) =>
                          updateTemplateEntry(index, (entry) => ({
                            ...entry,
                            category: value as TemplateCategory
                          }))
                        }
                      />
                      <TextAreaField
                        className="field-span-2"
                        label="Prompt hints"
                        helper="One hint per line."
                        rows={3}
                        value={template.promptHints.join("\n")}
                        onChange={(value) =>
                          updateTemplateEntry(index, (entry) => ({
                            ...entry,
                            promptHints: parseLineSeparated(value)
                          }))
                        }
                      />
                      <TextAreaField
                        className="field-span-2"
                        label="Answer"
                        rows={5}
                        value={template.answer}
                        onChange={(value) =>
                          updateTemplateEntry(index, (entry) => ({
                            ...entry,
                            answer: value
                          }))
                        }
                      />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">
                No templates yet. Add reusable answers for questions like
                sponsorship, relocation, or motivation.
              </p>
            )}
          </section>

          <section className="surface">
            <div className="section-head">
              <h2>Experience</h2>
              <span className="inline-note">
                Repeated sections stay editable in-place now
              </span>
            </div>

            <div className="button-row entry-actions">
              <button className="button button-ghost" onClick={addExperienceEntry}>
                Add experience
              </button>
            </div>

            {draftProfile.experience.length > 0 ? (
              <div className="entry-stack">
                {draftProfile.experience.map((entry, index) => (
                  <article key={entry.id} className="entry-card">
                    <div className="entry-card-head">
                      <div>
                        <strong>
                          {entry.title || "Untitled role"}
                          {entry.company ? ` at ${entry.company}` : ""}
                        </strong>
                        <p className="helper-line">
                          This maps into repeated ATS experience blocks later.
                        </p>
                      </div>
                      <button
                        className="mini-button"
                        onClick={() => removeExperienceEntry(index)}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="form-grid">
                      <TextField
                        label="Company"
                        value={entry.company}
                        onChange={(value) =>
                          updateExperienceEntry(index, (current) => ({
                            ...current,
                            company: value
                          }))
                        }
                      />
                      <TextField
                        label="Title"
                        value={entry.title}
                        onChange={(value) =>
                          updateExperienceEntry(index, (current) => ({
                            ...current,
                            title: value
                          }))
                        }
                      />
                      <TextField
                        label="Location"
                        value={entry.location}
                        onChange={(value) =>
                          updateExperienceEntry(index, (current) => ({
                            ...current,
                            location: value
                          }))
                        }
                      />
                      <TextField
                        label="Employment type"
                        value={entry.employmentType}
                        onChange={(value) =>
                          updateExperienceEntry(index, (current) => ({
                            ...current,
                            employmentType: value
                          }))
                        }
                      />
                      <TextField
                        label="Start date"
                        helper="Use YYYY-MM when possible."
                        value={entry.startDate}
                        onChange={(value) =>
                          updateExperienceEntry(index, (current) => ({
                            ...current,
                            startDate: value
                          }))
                        }
                      />
                      <TextField
                        label="End date"
                        helper="Leave blank if current."
                        value={entry.endDate}
                        onChange={(value) =>
                          updateExperienceEntry(index, (current) => ({
                            ...current,
                            endDate: value
                          }))
                        }
                      />
                      <CheckboxField
                        className="field-span-2"
                        label="This is a current role"
                        checked={entry.current}
                        onChange={(value) =>
                          updateExperienceEntry(index, (current) => ({
                            ...current,
                            current: value
                          }))
                        }
                      />
                      <TextAreaField
                        className="field-span-2"
                        label="Role description"
                        rows={4}
                        value={entry.description}
                        onChange={(value) =>
                          updateExperienceEntry(index, (current) => ({
                            ...current,
                            description: value
                          }))
                        }
                      />
                      <TextAreaField
                        className="field-span-2"
                        label="Achievements"
                        helper="One achievement per line."
                        rows={4}
                        value={entry.achievements.join("\n")}
                        onChange={(value) =>
                          updateExperienceEntry(index, (current) => ({
                            ...current,
                            achievements: parseLineSeparated(value)
                          }))
                        }
                      />
                      <TextAreaField
                        className="field-span-2"
                        label="Technologies"
                        helper="Comma-separated values."
                        rows={3}
                        value={entry.technologies.join(", ")}
                        onChange={(value) =>
                          updateExperienceEntry(index, (current) => ({
                            ...current,
                            technologies: parseCommaSeparated(value)
                          }))
                        }
                      />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">
                Add at least one experience entry to prepare for repeated
                section filling later on.
              </p>
            )}
          </section>

          <section className="surface">
            <div className="section-head">
              <h2>Education</h2>
              <span className="inline-note">
                Schools, degrees, and date ranges
              </span>
            </div>

            <div className="button-row entry-actions">
              <button className="button button-ghost" onClick={addEducationEntry}>
                Add education
              </button>
            </div>

            {draftProfile.education.length > 0 ? (
              <div className="entry-stack">
                {draftProfile.education.map((entry, index) => (
                  <article key={entry.id} className="entry-card">
                    <div className="entry-card-head">
                      <div>
                        <strong>
                          {entry.school || `Education ${index + 1}`}
                        </strong>
                        <p className="helper-line">
                          Degrees and majors often appear as grouped ATS fields.
                        </p>
                      </div>
                      <button
                        className="mini-button"
                        onClick={() => removeEducationEntry(index)}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="form-grid">
                      <TextField
                        label="School"
                        value={entry.school}
                        onChange={(value) =>
                          updateEducationEntry(index, (current) => ({
                            ...current,
                            school: value
                          }))
                        }
                      />
                      <TextField
                        label="Degree"
                        value={entry.degree}
                        onChange={(value) =>
                          updateEducationEntry(index, (current) => ({
                            ...current,
                            degree: value
                          }))
                        }
                      />
                      <TextField
                        label="Major"
                        value={entry.major}
                        onChange={(value) =>
                          updateEducationEntry(index, (current) => ({
                            ...current,
                            major: value
                          }))
                        }
                      />
                      <TextField
                        label="Minor"
                        value={entry.minor}
                        onChange={(value) =>
                          updateEducationEntry(index, (current) => ({
                            ...current,
                            minor: value
                          }))
                        }
                      />
                      <TextField
                        label="GPA"
                        value={entry.gpa}
                        onChange={(value) =>
                          updateEducationEntry(index, (current) => ({
                            ...current,
                            gpa: value
                          }))
                        }
                      />
                      <TextField
                        label="Location"
                        value={entry.location}
                        onChange={(value) =>
                          updateEducationEntry(index, (current) => ({
                            ...current,
                            location: value
                          }))
                        }
                      />
                      <TextField
                        label="Start date"
                        helper="Use YYYY-MM when possible."
                        value={entry.startDate}
                        onChange={(value) =>
                          updateEducationEntry(index, (current) => ({
                            ...current,
                            startDate: value
                          }))
                        }
                      />
                      <TextField
                        label="End date"
                        helper="Leave blank if current."
                        value={entry.endDate}
                        onChange={(value) =>
                          updateEducationEntry(index, (current) => ({
                            ...current,
                            endDate: value
                          }))
                        }
                      />
                      <CheckboxField
                        className="field-span-2"
                        label="Currently enrolled"
                        checked={entry.currentlyEnrolled}
                        onChange={(value) =>
                          updateEducationEntry(index, (current) => ({
                            ...current,
                            currentlyEnrolled: value
                          }))
                        }
                      />
                      <TextAreaField
                        className="field-span-2"
                        label="Highlights"
                        helper="One highlight per line."
                        rows={4}
                        value={entry.highlights.join("\n")}
                        onChange={(value) =>
                          updateEducationEntry(index, (current) => ({
                            ...current,
                            highlights: parseLineSeparated(value)
                          }))
                        }
                      />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">
                Add education history if the roles you target commonly request
                it.
              </p>
            )}
          </section>

          <section className="surface">
            <div className="section-head">
              <h2>Projects</h2>
              <span className="inline-note">
                Useful for internships and portfolio-heavy applications
              </span>
            </div>

            <div className="button-row entry-actions">
              <button className="button button-ghost" onClick={addProjectEntry}>
                Add project
              </button>
            </div>

            {draftProfile.projects.length > 0 ? (
              <div className="entry-stack">
                {draftProfile.projects.map((entry, index) => (
                  <article key={entry.id} className="entry-card">
                    <div className="entry-card-head">
                      <div>
                        <strong>{entry.name || `Project ${index + 1}`}</strong>
                        <p className="helper-line">
                          Projects can map to supporting sections or free-form
                          answers.
                        </p>
                      </div>
                      <button
                        className="mini-button"
                        onClick={() => removeProjectEntry(index)}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="form-grid">
                      <TextField
                        label="Project name"
                        value={entry.name}
                        onChange={(value) =>
                          updateProjectEntry(index, (current) => ({
                            ...current,
                            name: value
                          }))
                        }
                      />
                      <TextField
                        label="Role"
                        value={entry.role}
                        onChange={(value) =>
                          updateProjectEntry(index, (current) => ({
                            ...current,
                            role: value
                          }))
                        }
                      />
                      <TextField
                        className="field-span-2"
                        label="Project link"
                        value={entry.link}
                        onChange={(value) =>
                          updateProjectEntry(index, (current) => ({
                            ...current,
                            link: value
                          }))
                        }
                      />
                      <TextField
                        label="Start date"
                        value={entry.startDate}
                        onChange={(value) =>
                          updateProjectEntry(index, (current) => ({
                            ...current,
                            startDate: value
                          }))
                        }
                      />
                      <TextField
                        label="End date"
                        value={entry.endDate}
                        onChange={(value) =>
                          updateProjectEntry(index, (current) => ({
                            ...current,
                            endDate: value
                          }))
                        }
                      />
                      <TextAreaField
                        className="field-span-2"
                        label="Description"
                        rows={4}
                        value={entry.description}
                        onChange={(value) =>
                          updateProjectEntry(index, (current) => ({
                            ...current,
                            description: value
                          }))
                        }
                      />
                      <TextAreaField
                        className="field-span-2"
                        label="Technologies"
                        helper="Comma-separated values."
                        rows={3}
                        value={entry.technologies.join(", ")}
                        onChange={(value) =>
                          updateProjectEntry(index, (current) => ({
                            ...current,
                            technologies: parseCommaSeparated(value)
                          }))
                        }
                      />
                      <TextAreaField
                        className="field-span-2"
                        label="Highlights"
                        helper="One highlight per line."
                        rows={4}
                        value={entry.highlights.join("\n")}
                        onChange={(value) =>
                          updateProjectEntry(index, (current) => ({
                            ...current,
                            highlights: parseLineSeparated(value)
                          }))
                        }
                      />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">
                Add projects if you want the extension ready for portfolio-heavy
                applications.
              </p>
            )}
          </section>

          <section className="surface">
            <div className="section-head">
              <h2>Certifications</h2>
              <span className="inline-note">
                Optional, but useful for credential-focused roles
              </span>
            </div>

            <div className="button-row entry-actions">
              <button
                className="button button-ghost"
                onClick={addCertificationEntry}
              >
                Add certification
              </button>
            </div>

            {draftProfile.certifications.length > 0 ? (
              <div className="entry-stack">
                {draftProfile.certifications.map((entry, index) => (
                  <article key={entry.id} className="entry-card">
                    <div className="entry-card-head">
                      <div>
                        <strong>
                          {entry.name || `Certification ${index + 1}`}
                        </strong>
                        <p className="helper-line">
                          Stored locally for portals that ask for credentials.
                        </p>
                      </div>
                      <button
                        className="mini-button"
                        onClick={() => removeCertificationEntry(index)}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="form-grid">
                      <TextField
                        label="Name"
                        value={entry.name}
                        onChange={(value) =>
                          updateCertificationEntry(index, (current) => ({
                            ...current,
                            name: value
                          }))
                        }
                      />
                      <TextField
                        label="Issuer"
                        value={entry.issuer}
                        onChange={(value) =>
                          updateCertificationEntry(index, (current) => ({
                            ...current,
                            issuer: value
                          }))
                        }
                      />
                      <TextField
                        label="Issue date"
                        value={entry.issueDate}
                        onChange={(value) =>
                          updateCertificationEntry(index, (current) => ({
                            ...current,
                            issueDate: value
                          }))
                        }
                      />
                      <TextField
                        label="Expiration date"
                        value={entry.expirationDate}
                        onChange={(value) =>
                          updateCertificationEntry(index, (current) => ({
                            ...current,
                            expirationDate: value
                          }))
                        }
                      />
                      <TextField
                        label="Credential ID"
                        value={entry.credentialId}
                        onChange={(value) =>
                          updateCertificationEntry(index, (current) => ({
                            ...current,
                            credentialId: value
                          }))
                        }
                      />
                      <TextField
                        label="Credential URL"
                        value={entry.credentialUrl}
                        onChange={(value) =>
                          updateCertificationEntry(index, (current) => ({
                            ...current,
                            credentialUrl: value
                          }))
                        }
                      />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">
                Leave this empty if certifications are not part of your current
                search.
              </p>
            )}
          </section>

          <section className="surface">
            <div className="section-head">
              <h2>Documents snapshot</h2>
              <span className="inline-note">Saved document references</span>
            </div>

            <div className="button-row entry-actions">
              <button
                className="button button-ghost"
                disabled={busy || !draftProfile.documents.resume}
                onClick={removeLinkedResume}
              >
                Remove linked resume
              </button>
            </div>

            <div className="stat-grid">
              <article className="stat-card">
                <span className="stat-label">Resume</span>
                <strong>
                  {draftProfile.documents.resume
                    ? draftProfile.documents.resume.fileName
                    : "Not linked"}
                </strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Cover letter</span>
                <strong>
                  {draftProfile.documents.coverLetter
                    ? draftProfile.documents.coverLetter.fileName
                    : "Not linked"}
                </strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Additional docs</span>
                <strong>{draftProfile.documents.additional.length}</strong>
              </article>
            </div>

            <p className="muted">
              Saved resume uploads are kept as local profile references for
              matching and debugging. Live job-site file inputs still require
              manual interaction because browser security blocks scripted file
              uploads.
            </p>
          </section>
        </>
        ) : (
          <section className="surface">
            <p className="muted">
              Loading the active profile from local extension storage...
            </p>
          </section>
        )}

      <section className="surface">
        <div className="section-head">
          <h2>Application flow</h2>
          <span className="inline-note">
            {state.lastScan?.workflow.isMultiStepLikely
              ? "Multi-step flow detected"
              : "No multi-step flow detected yet"}
          </span>
        </div>

        {state.lastScan ? (
          <>
            <div className="stat-grid">
              <article className="stat-card">
                <span className="stat-label">Current step</span>
                <strong>{state.lastScan.workflow.currentStep || "Unknown"}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Detected steps</span>
                <strong>{state.lastScan.workflow.detectedSteps.length}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Next actions</span>
                <strong>{state.lastScan.workflow.nextActions.length}</strong>
              </article>
            </div>

            {state.lastScan.workflow.detectedSteps.length > 0 ? (
              <div className="pill-list">
                {state.lastScan.workflow.detectedSteps.map((step) => (
                  <span key={step} className="pill">
                    {step}
                  </span>
                ))}
              </div>
            ) : null}

            {state.lastScan.workflow.nextActions.length > 0 ? (
              <div className="pill-list">
                {state.lastScan.workflow.nextActions.map((action) => (
                  <span key={action} className="badge">
                    {action}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">
            Run a scan on a job application page to detect steps such as
            contact, resume, experience, review, and submit.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Latest fill summary</h2>
          <span className="inline-note">
            {state.lastFill
              ? new Date(state.lastFill.filledAt).toLocaleTimeString()
              : "No fill yet"}
          </span>
        </div>

        {state.lastFill ? (
          <>
            <div className="stat-grid">
              <article className="stat-card">
                <span className="stat-label">Filled</span>
                <strong>{state.lastFill.filled}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Skipped</span>
                <strong>{state.lastFill.skipped}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Unsupported or errors</span>
                <strong>
                  {state.lastFill.unsupported + state.lastFill.errors}
                </strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">AI-filled</span>
                <strong>{state.lastFill.aiFilled}</strong>
              </article>
            </div>

            <div className="match-list">
              {state.lastFill.results.slice(0, 12).map((result) => (
                <article key={result.fieldId} className="match-row">
                  <div className="match-main">
                    <div className="match-title-row">
                      <strong className="match-title">{result.label}</strong>
                      <span
                        className={`confidence-pill confidence-${result.confidence}`}
                      >
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
              ))}
            </div>
          </>
        ) : (
          <p className="muted">
            Use the popup autofill button on a real job application page to
            inspect fill results here.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Latest match summary</h2>
          <span className="inline-note">
            {state.lastScan
              ? `${state.lastScan.adapterLabel} on ${state.lastScan.hostname}`
              : "No pages scanned yet"}
          </span>
        </div>

        {state.lastScan ? (
          <>
            <div className="stat-grid">
              <article className="stat-card">
                <span className="stat-label">High confidence</span>
                <strong>{state.lastScan.matchBreakdown.high}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Adapter</span>
                <strong>{state.lastScan.adapterLabel}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Review needed</span>
                <strong>
                  {state.lastScan.matchBreakdown.medium +
                    state.lastScan.matchBreakdown.low +
                    state.lastScan.matchBreakdown.unmatched}
                </strong>
              </article>
            </div>

            {state.lastScan.adapterNotes.length > 0 ? (
              <div className="match-list">
                {state.lastScan.adapterNotes.map((note) => (
                  <article key={note} className="match-row">
                    <div className="match-main">
                      <div className="match-title-row">
                        <strong className="match-title">Adapter note</strong>
                        <span className="confidence-pill confidence-high">
                          active
                        </span>
                      </div>
                      <p className="helper-line">{note}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            <div className="match-list">
              {fieldMatches.slice(0, 12).map((match) => (
                <article key={match.fieldId} className="match-row">
                  <div className="match-main">
                    <div className="match-title-row">
                      <strong className="match-title">
                        {match.label || match.name || match.selectorHint}
                      </strong>
                      <span
                        className={`confidence-pill confidence-${match.confidence}`}
                      >
                        {match.confidence}
                      </span>
                    </div>
                    <p className="match-copy">
                      {match.matchedLabel || "No strong mapping yet"}
                      {match.matchedKey ? ` -> ${match.matchedKey}` : ""}
                    </p>
                    <p className="helper-line">
                      {match.hasValue
                        ? `Preview: ${match.matchedValuePreview}`
                        : "No saved value for this mapping yet"}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">
            Run a scan from the popup on a job application page to inspect
            classifier output here.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Latest AI assist</h2>
          <span className="inline-note">
            {state.lastScan
              ? state.lastScan.aiAssist.message
              : "No pages scanned yet"}
          </span>
        </div>

        {state.lastScan ? (
          <>
            <div className="stat-grid">
              <article className="stat-card">
                <span className="stat-label">AI status</span>
                <strong>{state.lastScan.aiAssist.status}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Suggestions</span>
                <strong>{state.lastScan.aiAssist.suggestions.length}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Model</span>
                <strong>{state.lastScan.aiAssist.model}</strong>
              </article>
            </div>

            {state.lastScan.aiAssist.suggestions.length > 0 ? (
              <div className="match-list">
                {state.lastScan.aiAssist.suggestions.slice(0, 12).map((suggestion) => (
                  <article key={suggestion.fieldId} className="match-row">
                    <div className="match-main">
                      <div className="match-title-row">
                        <strong className="match-title">
                          {suggestion.label || suggestion.selectorHint}
                        </strong>
                        <span
                          className={`confidence-pill confidence-${suggestion.confidence}`}
                        >
                          {suggestion.confidence}
                        </span>
                      </div>
                      <p className="match-copy">
                        {suggestion.suggestedProfileLabel || "Generated answer"}
                        {suggestion.suggestedProfileKey
                          ? ` -> ${suggestion.suggestedProfileKey}`
                          : ""}
                      </p>
                      <p className="helper-line">
                        {suggestion.valuePreview} | {suggestion.reason}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">
                When AI assist is enabled and the scan finds ambiguous blank
                fields, suggestions will show up here for review.
              </p>
            )}
          </>
        ) : (
          <p className="muted">
            Run a scan from the popup to inspect the last AI assistance pass.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>What exists today</h2>
          <span className="inline-note">Settings, uploads, workflows, and autofill</span>
        </div>
        <ul className="roadmap-list">
          <li className="roadmap-active">
            The options page now edits the active applicant profile directly
          </li>
          <li className="roadmap-active">
            Fill mode, auto-submit, and the fully auto override are now saved extension settings
          </li>
          <li className="roadmap-active">
            AI-assisted autofill can now be enabled with a saved OpenAI API key
          </li>
          <li className="roadmap-active">
            A resume file can now be linked as the saved resume for the active
            profile
          </li>
          <li className="roadmap-active">
            Resume text can be imported locally into the draft profile for
            review before saving
          </li>
          <li className="roadmap-active">
            Greenhouse, Lever, and Workday adapters now enrich label and
            section detection during scans
          </li>
          <li className="roadmap-active">
            Multi-step workflow hints now show current step and next actions
          </li>
          <li>Live file inputs on job sites still require manual interaction</li>
        </ul>
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Active profile JSON</h2>
          <span className="inline-note">
            Useful when you need exact shape debugging
          </span>
        </div>
        <pre className="code-block">
          {JSON.stringify(draftProfile ?? activeProfile, null, 2)}
        </pre>
      </section>

      <section className="surface">
        <div className="section-head">
          <h2>Last scan snapshot</h2>
          <span className="inline-note">
            {state.lastScan ? state.lastScan.hostname : "No pages scanned yet"}
          </span>
        </div>
        <pre className="code-block">
          {JSON.stringify(state.lastScan, null, 2) ?? "null"}
        </pre>
      </section>
    </main>
  );
}

function getSortedMatches(matches: DetectedFieldMatch[]): DetectedFieldMatch[] {
  return [...matches].sort((left, right) => {
    const confidenceDelta =
      confidenceRank(right.confidence) - confidenceRank(left.confidence);

    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    return right.score - left.score;
  });
}

function getFillPreviewMatches(
  matches: DetectedFieldMatch[],
  fillMode: FillMode
): DetectedFieldMatch[] {
  return matches
    .filter((match) => shouldFillConfidence(match.confidence, fillMode))
    .filter((match) => match.hasValue)
    .slice(0, 10);
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

function cloneProfile(profile: ApplicantProfile): ApplicantProfile {
  return JSON.parse(JSON.stringify(profile)) as ApplicantProfile;
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLineSeparated(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function createEducationEntry(): EducationEntry {
  return {
    id: createId("edu"),
    school: "",
    degree: "",
    major: "",
    minor: "",
    gpa: "",
    startDate: "",
    endDate: "",
    location: "",
    currentlyEnrolled: false,
    highlights: []
  };
}

function createExperienceEntry(): ExperienceEntry {
  return {
    id: createId("exp"),
    company: "",
    title: "",
    location: "",
    employmentType: "",
    startDate: "",
    endDate: "",
    current: false,
    description: "",
    achievements: [],
    technologies: []
  };
}

function createProjectEntry(): ProjectEntry {
  return {
    id: createId("proj"),
    name: "",
    role: "",
    description: "",
    technologies: [],
    link: "",
    startDate: "",
    endDate: "",
    highlights: []
  };
}

function createCertificationEntry(): CertificationEntry {
  return {
    id: createId("cert"),
    name: "",
    issuer: "",
    issueDate: "",
    expirationDate: "",
    credentialId: "",
    credentialUrl: ""
  };
}

function createTemplateEntry(): AnswerTemplate {
  return {
    id: createId("tmpl"),
    title: "",
    category: "general",
    promptHints: [],
    answer: ""
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function formatShortDate(value: string): string {
  if (!value) {
    return "Unknown";
  }

  return new Date(value).toLocaleDateString();
}

function createDocumentReferenceFromFile(
  file: File,
  source: DocumentReference["source"]
): DocumentReference {
  return {
    id: createId("resume"),
    name: file.name,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    source,
    lastUpdatedAt: new Date().toISOString()
  };
}

function createProfileBackupFileName(label: string): string {
  const safeLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "autojobapp-profile";
  const dateStamp = new Date().toISOString().slice(0, 10);

  return `${safeLabel}-${dateStamp}.profile.json`;
}

function downloadTextFile(
  fileName: string,
  text: string,
  mimeType: string
) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

createRoot(document.getElementById("root")!).render(<OptionsApp />);
