import {
  AiFieldSuggestion,
  ApplicantProfile,
  ContentRequest,
  ContentResponse,
  DetectedFieldMatch,
  ExtensionSettings,
  FillMode,
  FillSummary,
  FilledFieldResult,
  FieldElementTag,
  MatchConfidence,
  ProfileFieldKey,
  ScanSummary,
  DEFAULT_AI_ASSIST_MODEL,
  createDefaultAiAssistSummary,
  createDefaultSettings,
  shouldFillConfidence,
  detectPlatformFromHostname
} from "../shared/core";
import {
  AdapterFormControl,
  PlatformAdapter,
  resolvePlatformAdapter
} from "./adapters";
import { detectApplicationWorkflow } from "./workflow";
import {
  FieldScanCandidate,
  ResolvedProfileValue,
  classifyFieldCandidates,
  isRepeatableProfileFieldKey,
  resolveProfileFieldValue,
  summarizeFieldMatches
} from "../shared/matching";

type CustomFormControl = HTMLElement & {
  __autoJobAppCustomControl: true;
};

type FormControl =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement
  | CustomFormControl;

type ChoiceControl = HTMLInputElement | CustomFormControl;

interface CandidateGroup {
  candidate: FieldScanCandidate;
  elements: FormControl[];
}

interface PageContext {
  href: string;
  hostname: string;
  title: string;
}

interface RepeatableSectionConfig {
  prefix: "education." | "experience." | "projects.";
  primaryKey: ProfileFieldKey;
  addButtonLabels: string[];
  getDesiredCount: (profile: ApplicantProfile) => number;
}

interface FillControlAttempt {
  changed: boolean;
  verified: boolean;
  failureMessage: string;
}

const FILL_HIGHLIGHT_STYLE_ID = "autojobapp-fill-style";
const FILL_HIGHLIGHT_CLASS = "autojobapp-fill-flash";
const FILL_SETTLE_DELAY_MS = 180;
const FILL_VERIFICATION_MAX_ATTEMPTS = 2;
const REPEATABLE_SECTION_CONFIGS: RepeatableSectionConfig[] = [
  {
    prefix: "experience.",
    primaryKey: "experience.company",
    addButtonLabels: [
      "add experience",
      "add another experience",
      "add work experience",
      "add another position"
    ],
    getDesiredCount: (profile) => profile.experience.length
  },
  {
    prefix: "education.",
    primaryKey: "education.school",
    addButtonLabels: [
      "add education",
      "add another education",
      "add school",
      "add another school"
    ],
    getDesiredCount: (profile) => profile.education.length
  },
  {
    prefix: "projects.",
    primaryKey: "projects.name",
    addButtonLabels: ["add project", "add another project"],
    getDesiredCount: (profile) => profile.projects.length
  }
];

declare global {
  interface Window {
    __AUTO_JOB_APP_CONTENT_BOOTED__?: boolean;
    __AUTO_JOB_APP_ENABLE_TEST_API__?: boolean;
    __AUTO_JOB_APP_TEST_API__?: {
      scanPage: typeof scanPage;
      fillPage: typeof fillPage;
    };
  }
}

if (
  typeof window !== "undefined" &&
  typeof chrome !== "undefined" &&
  chrome.runtime?.onMessage &&
  !window.__AUTO_JOB_APP_CONTENT_BOOTED__
) {
  window.__AUTO_JOB_APP_CONTENT_BOOTED__ = true;

  chrome.runtime.onMessage.addListener(
    (request: ContentRequest, _sender, sendResponse) => {
      if (request.type === "JOB_APP_SCAN_PAGE") {
        sendResponse({
          ok: true,
          scan: scanPage(request.profile, {
            settings: request.settings
          })
        } satisfies ContentResponse);

        return true;
      }

      if (request.type === "JOB_APP_FILL_PAGE") {
        void fillPage(request.profile, {
          settings: request.settings,
          aiSuggestions: request.aiSuggestions
        })
          .then((result) => {
            sendResponse({
              ok: true,
              ...result
            } satisfies ContentResponse);
          })
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            } satisfies ContentResponse);
          });

        return true;
      }

      return false;
    }
  );
}

attachTestApiIfEnabled();

export function scanPage(
  profile: ApplicantProfile,
  options?: {
    href?: string;
    hostname?: string;
    title?: string;
    settings?: ExtensionSettings;
  }
): ScanSummary {
  const pageContext = resolvePageContext(options);
  const adapter = resolvePlatformAdapter(pageContext.hostname);
  const rawFields = getPageFields();
  const groups = collectFieldGroups(
    rawFields.filter(isScannableFieldElement),
    adapter
  );
  const fieldMatches = classifyFieldCandidates(
    groups.map((group) => group.candidate),
    profile
  );

  return buildScanSummary(
    rawFields,
    groups,
    fieldMatches,
    adapter,
    pageContext,
    options?.settings ?? createDefaultSettings()
  );
}

export async function fillPage(
  profile: ApplicantProfile,
  options?: {
    href?: string;
    hostname?: string;
    title?: string;
    settings?: ExtensionSettings;
    aiSuggestions?: AiFieldSuggestion[];
  }
) : Promise<{
  scan: ScanSummary;
  fill: FillSummary;
}> {
  const settings = options?.settings ?? createDefaultSettings();
  const aiSuggestionByFieldId = new Map(
    (options?.aiSuggestions ?? []).map((suggestion) => [suggestion.fieldId, suggestion])
  );
  const pageContext = resolvePageContext(options);
  const adapter = resolvePlatformAdapter(pageContext.hostname);
  let rawFields = getPageFields();
  let groups = collectFieldGroups(
    rawFields.filter(isScannableFieldElement),
    adapter
  );
  let fieldMatches = classifyFieldCandidates(
    groups.map((group) => group.candidate),
    profile
  );
  const expandedSections = await expandRepeatableSections(profile, fieldMatches);

  if (expandedSections > 0) {
    rawFields = getPageFields();
    groups = collectFieldGroups(rawFields.filter(isScannableFieldElement), adapter);
    fieldMatches = classifyFieldCandidates(
      groups.map((group) => group.candidate),
      profile
    );
  }

  const groupByFieldId = new Map(
    groups.map((group) => [group.candidate.fieldId, group])
  );
  const repeatEntryIndexByFieldId = buildRepeatEntryIndexMap(fieldMatches);

  ensureFillHighlightStyle();

  const results: FilledFieldResult[] = [];

  for (const match of fieldMatches) {
    results.push(
      await fillMatchedGroup(
        match,
        groupByFieldId.get(match.fieldId),
        profile,
        repeatEntryIndexByFieldId.get(match.fieldId) ?? 0,
        settings,
        aiSuggestionByFieldId.get(match.fieldId)
      )
    );
  }

  const scan = buildScanSummary(
    rawFields,
    groups,
    fieldMatches,
    adapter,
    pageContext,
    settings
  );
  const autoSubmitResult = settings.autoSubmit
    ? attemptAutoSubmit(scan, results, settings)
    : {
        autoSubmitted: false,
        message: "Auto-submit is disabled."
      };

  return {
    scan,
    fill: buildFillSummary(results, settings, autoSubmitResult)
  };
}

function attachTestApiIfEnabled(): void {
  if (typeof window === "undefined" || !window.__AUTO_JOB_APP_ENABLE_TEST_API__) {
    return;
  }

  window.__AUTO_JOB_APP_TEST_API__ = {
    scanPage,
    fillPage
  };
}

function buildRepeatEntryIndexMap(
  matches: DetectedFieldMatch[]
): Map<string, number> {
  const entryCounterByKey = new Map<ProfileFieldKey, number>();
  const entryIndexByFieldId = new Map<string, number>();

  matches.forEach((match) => {
    if (!match.matchedKey || !isRepeatableProfileFieldKey(match.matchedKey)) {
      return;
    }

    const entryIndex = entryCounterByKey.get(match.matchedKey) ?? 0;
    entryIndexByFieldId.set(match.fieldId, entryIndex);
    entryCounterByKey.set(match.matchedKey, entryIndex + 1);
  });

  return entryIndexByFieldId;
}

async function expandRepeatableSections(
  profile: ApplicantProfile,
  matches: DetectedFieldMatch[]
): Promise<number> {
  let expanded = 0;

  for (const config of REPEATABLE_SECTION_CONFIGS) {
    const desiredCount = config.getDesiredCount(profile);

    if (desiredCount <= 1) {
      continue;
    }

    const relevantMatches = matches.filter(
      (match) => match.matchedKey?.startsWith(config.prefix)
    );

    if (relevantMatches.length === 0) {
      continue;
    }

    let currentCount = Math.max(
      relevantMatches.filter((match) => match.matchedKey === config.primaryKey).length,
      1
    );

    while (currentCount < desiredCount) {
      const addButton = findVisibleAddButton(config.addButtonLabels);

      if (!addButton) {
        break;
      }

      addButton.focus();
      addButton.click();
      expanded += 1;
      currentCount += 1;
      await waitForDomUpdate();
    }
  }

  return expanded;
}

function findVisibleAddButton(labels: string[]): HTMLElement | null {
  const normalizedLabels = labels.map(normalizeText);
  const controls = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, [role='button'], input[type='button'], input[type='submit']"
    )
  );

  return (
    controls.find((control) => {
      if (!isVisibleActionControl(control)) {
        return false;
      }

      const text = normalizeText(
        cleanText(
          control.textContent ||
            control.getAttribute("value") ||
            control.getAttribute("aria-label") ||
            control.getAttribute("title")
        )
      );

      return normalizedLabels.some(
        (label) => text === label || text.includes(label)
      );
    }) ?? null
  );
}

function findVisibleSubmitControl(
  workflow: ScanSummary["workflow"]
): HTMLElement | null {
  const controls = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, [role='button'], input[type='submit'], input[type='button']"
    )
  );
  const workflowContext = normalizeText(
    [workflow.currentStep, ...workflow.detectedSteps].join(" ")
  );
  const isReviewStage =
    workflowContext.includes("review") || workflowContext.includes("submit");

  return (
    controls.find((control) => {
      if (!isVisibleActionControl(control)) {
        return false;
      }

      const text = normalizeText(
        cleanText(
          control.textContent ||
            control.getAttribute("value") ||
            control.getAttribute("aria-label") ||
            control.getAttribute("title")
        )
      );

      if (!text) {
        return false;
      }

      if (
        text.includes("submit application") ||
        text === "submit" ||
        text.includes("finish application") ||
        text.includes("complete application") ||
        text.includes("send application")
      ) {
        return true;
      }

      return (
        isReviewStage &&
        (text === "apply" ||
          text.includes("apply now") ||
          text.includes("final apply"))
      );
    }) ?? null
  );
}

function isVisibleActionControl(control: HTMLElement): boolean {
  if (
    control.hasAttribute("disabled") ||
    control.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }

  const style = window.getComputedStyle(control);
  const rect = control.getBoundingClientRect();

  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    control.closest("[hidden], [aria-hidden='true']")
  ) {
    return false;
  }

  return rect.width > 0 || rect.height > 0 || control.isConnected;
}

function waitForDomUpdate(delayMs = 140): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function buildScanSummary(
  rawFields: FormControl[],
  groups: CandidateGroup[],
  fieldMatches: DetectedFieldMatch[],
  adapter: PlatformAdapter,
  pageContext: PageContext,
  settings: ExtensionSettings
): ScanSummary {
  const candidates = groups.map((group) => group.candidate);
  const buttons = document.querySelectorAll(
    "button, input[type='submit'], input[type='button']"
  ).length;
  const pageText = (document.body?.innerText ?? document.body?.textContent ?? "")
    .toLowerCase();
  const workflow = detectApplicationWorkflow(adapter);

  return {
    title: pageContext.title,
    url: pageContext.href,
    hostname: pageContext.hostname,
    platform: adapter.platform || detectPlatformFromHostname(pageContext.hostname),
    adapterLabel: adapter.label,
    adapterNotes: adapter.notes,
    workflow,
    totalFields: rawFields.length,
    visibleFields: candidates.length,
    textInputs: candidates.filter(isTextLikeCandidate).length,
    selects: candidates.filter((field) => field.elementTag === "select").length,
    textareas: candidates.filter((field) => field.elementTag === "textarea").length,
    buttons,
    labels: candidates
      .map((field) => field.label || field.sectionHeading || field.name)
      .filter(Boolean)
      .filter(uniqueValue)
      .slice(0, 10),
    jobSignals: [
      "resume",
      "cover letter",
      "work authorization",
      "linkedin",
      "github",
      "portfolio",
      "salary",
      "sponsorship"
    ]
      .filter((signal) => pageText.includes(signal))
      .concat(adapter.getJobSignals(pageText))
      .filter(uniqueValue),
    fieldMatches,
    matchBreakdown: summarizeFieldMatches(fieldMatches),
    aiAssist: createPendingAiAssistSummary(settings),
    scannedAt: new Date().toISOString()
  };
}

function createPendingAiAssistSummary(
  settings: ExtensionSettings
): ScanSummary["aiAssist"] {
  const normalizedSettings = {
    ...createDefaultSettings(),
    ...settings
  };
  const configured = Boolean(normalizedSettings.openAiApiKey.trim());
  const model =
    normalizedSettings.aiAssistModel.trim() || DEFAULT_AI_ASSIST_MODEL;

  if (!normalizedSettings.aiAssistEnabled) {
    return createDefaultAiAssistSummary({
      configured,
      model
    });
  }

  if (!configured) {
    return createDefaultAiAssistSummary({
      enabled: true,
      configured: false,
      model,
      status: "missing_api_key",
      message: "AI assist is enabled, but no OpenAI API key is saved yet."
    });
  }

  return createDefaultAiAssistSummary({
    enabled: true,
    configured: true,
    model,
    status: "no_candidates",
    message: "AI suggestions are generated by the background service worker after scan."
  });
}

function resolvePageContext(options?: {
  href?: string;
  hostname?: string;
  title?: string;
}): PageContext {
  const href = options?.href ?? window.location.href;
  const hostname =
    options?.hostname ??
    (() => {
      try {
        return new URL(href).hostname;
      } catch {
        return window.location.hostname;
      }
    })();

  return {
    href,
    hostname,
    title: options?.title ?? document.title
  };
}

function collectFieldGroups(
  fields: FormControl[],
  adapter: PlatformAdapter
): CandidateGroup[] {
  const groupedFields = new Map<string, CandidateGroup>();

  fields.forEach((field, index) => {
    const candidate = buildCandidate(field, index, adapter);
    const groupingKey = getGroupingKey(field, candidate, index, adapter);
    const existing = groupedFields.get(groupingKey);

    if (!existing) {
      groupedFields.set(groupingKey, {
        candidate,
        elements: [field]
      });
      return;
    }

    groupedFields.set(groupingKey, {
      candidate: {
        ...existing.candidate,
        label: existing.candidate.label || candidate.label,
        sectionHeading:
          existing.candidate.sectionHeading || candidate.sectionHeading,
        nearbyText:
          existing.candidate.nearbyText.length >= candidate.nearbyText.length
            ? existing.candidate.nearbyText
            : candidate.nearbyText,
        optionLabels: dedupeStrings([
          ...existing.candidate.optionLabels,
          ...candidate.optionLabels
        ]),
        adapterSignals: dedupeStrings([
          ...existing.candidate.adapterSignals,
          ...candidate.adapterSignals
        ])
      },
      elements: [...existing.elements, field]
    });
  });

  return Array.from(groupedFields.values());
}

function buildCandidate(
  field: FormControl,
  index: number,
  adapter: PlatformAdapter
): FieldScanCandidate {
  const elementTag = getFieldElementTag(field);

  return {
    fieldId: buildFieldId(field, index),
    selectorHint: buildSelectorHint(field, index),
    label: adapter.getLabel(field) || extractFieldLabel(field),
    elementTag,
    inputType: detectFieldInputType(field),
    name: field.getAttribute("name")?.trim() ?? "",
    elementId: field.id.trim(),
    placeholder: getFieldPlaceholder(field),
    ariaLabel: field.getAttribute("aria-label")?.trim() ?? "",
    autocomplete: field.getAttribute("autocomplete")?.trim() ?? "",
    sectionHeading: adapter.getSectionHeading(field) || extractSectionHeading(field),
    nearbyText: adapter.getNearbyText(field) || extractNearbyText(field),
    optionLabels: dedupeStrings([
      ...adapter.getOptionLabels(field),
      ...extractOptionLabels(field)
    ]),
    adapterSignals: adapter.getSignals(field),
    required: isRequiredField(field)
  };
}

async function fillMatchedGroup(
  match: DetectedFieldMatch,
  group: CandidateGroup | undefined,
  profile: ApplicantProfile,
  repeatEntryIndex: number,
  settings: ExtensionSettings,
  aiSuggestion?: AiFieldSuggestion
): Promise<FilledFieldResult> {
  if (!group) {
    return buildResult(
      match,
      "error",
      "",
      "Field group was not found during fill."
    );
  }

  if (group.elements.some(isFileInput)) {
    return fillFileUploadGroup(match, group, profile);
  }

  const profileSuggestionAllowed = shouldFillConfidence(
    match.confidence,
    settings.fillMode
  );
  const aiSuggestionAllowed = aiSuggestion
    ? shouldFillConfidence(aiSuggestion.confidence, settings.fillMode)
    : false;
  const profileResolvedValue =
    match.matchedKey
      ? resolveProfileFieldValue(profile, match.matchedKey, repeatEntryIndex)
      : null;
  const aiResolvedValue = aiSuggestion
    ? createAiResolvedValue(aiSuggestion)
    : null;
  const profileTarget =
    profileSuggestionAllowed &&
    match.matchedKey &&
    profileResolvedValue?.hasValue &&
    profileResolvedValue.raw !== null
      ? {
          source: "profile" as const,
          matchedKey: match.matchedKey,
          confidence: match.confidence,
          resolvedValue: profileResolvedValue
        }
      : null;
  const aiTarget =
    aiSuggestionAllowed &&
    aiSuggestion &&
    aiResolvedValue?.hasValue &&
    aiResolvedValue.raw !== null
      ? {
          source: "ai" as const,
          matchedKey: aiSuggestion.suggestedProfileKey,
          confidence: aiSuggestion.confidence,
          resolvedValue: aiResolvedValue
        }
      : null;
  const fillTarget = settings.aiPreferGeneratedValues
    ? aiTarget ?? profileTarget
    : profileTarget ?? aiTarget;

  if (!fillTarget) {
    if (!profileSuggestionAllowed && !aiSuggestionAllowed) {
      return buildResult(
        match,
        "skipped",
        aiSuggestion?.valuePreview || match.matchedValuePreview,
        getFillSkipMessage(settings.fillMode)
      );
    }

    if (!match.matchedKey && !aiSuggestionAllowed) {
      return buildResult(
        match,
        "skipped",
        "",
        "No strong profile mapping or usable AI suggestion was available."
      );
    }

    if (profileSuggestionAllowed && profileResolvedValue) {
      return buildResult(
        match,
        "skipped",
        aiSuggestion?.valuePreview || profileResolvedValue.preview,
        repeatEntryIndex > 0
          ? `The active profile does not have a saved value for entry ${repeatEntryIndex + 1} of this repeated section.`
          : "The active profile does not have a saved value for this field."
      );
    }

    return buildResult(
      match,
      "skipped",
      aiSuggestion?.valuePreview || "",
      "AI assist did not return a usable value for this field."
    );
  }

  if (isAlreadyFilled(group, fillTarget.resolvedValue)) {
    return buildResult(
      match,
      "skipped",
      fillTarget.resolvedValue.preview,
      "Skipped to avoid overwriting an existing page value.",
      {
        matchedKey: fillTarget.matchedKey,
        confidence: fillTarget.confidence,
        fillSource: fillTarget.source
      }
    );
  }

  try {
    if (isChoiceGroup(group)) {
      const attempt = await fillChoiceGroup(group, fillTarget.resolvedValue);

      return buildResult(
        match,
        attempt.verified ? "filled" : "skipped",
        fillTarget.resolvedValue.preview,
        attempt.verified
          ? fillTarget.source === "ai"
            ? "Filled a radio or checkbox choice using an AI suggestion."
            : "Filled a radio or checkbox choice."
          : attempt.failureMessage,
        {
          matchedKey: fillTarget.matchedKey,
          confidence: fillTarget.confidence,
          fillSource: fillTarget.source
        }
      );
    }

    const primaryElement = resolvePrimaryElement(group);

    if (!primaryElement) {
      return buildResult(
        match,
        "error",
        fillTarget.resolvedValue.preview,
        "No DOM element was available for this field.",
        {
          matchedKey: fillTarget.matchedKey,
          confidence: fillTarget.confidence,
          fillSource: fillTarget.source
        }
      );
    }

    if (primaryElement instanceof HTMLSelectElement) {
      const attempt = await fillSelectControl(group, fillTarget.resolvedValue);

      return buildResult(
        match,
        attempt.verified ? "filled" : "skipped",
        fillTarget.resolvedValue.preview,
        attempt.verified
          ? fillTarget.source === "ai"
            ? "Filled a select control using an AI suggestion."
            : "Filled a select control."
          : attempt.failureMessage,
        {
          matchedKey: fillTarget.matchedKey,
          confidence: fillTarget.confidence,
          fillSource: fillTarget.source
        }
      );
    }

    if (isCustomSelectionControl(primaryElement)) {
      const attempt = await fillCustomSelectionControl(
        group,
        fillTarget.resolvedValue
      );

      return buildResult(
        match,
        attempt.verified ? "filled" : "skipped",
        fillTarget.resolvedValue.preview,
        attempt.verified
          ? fillTarget.source === "ai"
            ? "Filled a custom combobox or listbox using an AI suggestion."
            : "Filled a custom combobox or listbox."
          : attempt.failureMessage,
        {
          matchedKey: fillTarget.matchedKey,
          confidence: fillTarget.confidence,
          fillSource: fillTarget.source
        }
      );
    }

    const attempt = await fillTextControl(group, fillTarget.resolvedValue);

    return buildResult(
      match,
      attempt.verified ? "filled" : "skipped",
      fillTarget.resolvedValue.preview,
      attempt.verified
        ? fillTarget.source === "ai"
          ? "Filled a text-based control using an AI suggestion."
          : "Filled a text-based control."
        : attempt.failureMessage,
      {
        matchedKey: fillTarget.matchedKey,
        confidence: fillTarget.confidence,
        fillSource: fillTarget.source
      }
    );
  } catch (error) {
    return buildResult(
      match,
      "error",
      fillTarget.resolvedValue.preview,
      error instanceof Error ? error.message : String(error),
      {
        matchedKey: fillTarget.matchedKey,
        confidence: fillTarget.confidence,
        fillSource: fillTarget.source
      }
    );
  }
}

function fillFileUploadGroup(
  match: DetectedFieldMatch,
  group: CandidateGroup,
  profile: ApplicantProfile
): FilledFieldResult {
  const primaryElement = group.elements.find(isFileInput);

  if (!primaryElement) {
    return buildResult(
      match,
      "error",
      "",
      "A file upload field was detected, but no file input element was available."
    );
  }

  if (!looksLikeResumeUpload(group.candidate)) {
    return buildResult(
      match,
      "skipped",
      "",
      "Detected a file input, but it did not look like a resume upload field."
    );
  }

  if ((primaryElement.files?.length ?? 0) > 0) {
    return buildResult(
      match,
      "skipped",
      fileNamesPreview(primaryElement.files),
      "Skipped to avoid overwriting an existing uploaded file."
    );
  }

  const resumeDocument = profile.documents.resume;

  if (!resumeDocument) {
    return buildResult(
      match,
      "skipped",
      "",
      "No saved resume is linked to the active profile."
    );
  }

  if (!resumeDocument.dataBase64) {
    return buildResult(
      match,
      "unsupported",
      resumeDocument.fileName || resumeDocument.name,
      "A saved resume is linked, but no uploadable file data is stored yet. Re-link the resume file in options."
    );
  }

  try {
    const resumeFile = createStoredDocumentFile(resumeDocument);
    const changed = fillFileInputControl(primaryElement, [resumeFile]);

    return buildResult(
      match,
      changed ? "filled" : "error",
      resumeDocument.fileName || resumeDocument.name,
      changed
        ? "Uploaded the saved resume file."
        : "The saved resume file could not be attached to this upload control.",
      {
        matchedKey: "documents.resume" as ProfileFieldKey,
        confidence: "high",
        fillSource: "profile"
      }
    );
  } catch (error) {
    return buildResult(
      match,
      "error",
      resumeDocument.fileName || resumeDocument.name,
      error instanceof Error ? error.message : String(error),
      {
        matchedKey: "documents.resume" as ProfileFieldKey,
        confidence: "high",
        fillSource: "profile"
      }
    );
  }
}

function buildFillSummary(
  results: FilledFieldResult[],
  settings: ExtensionSettings,
  autoSubmitResult: {
    autoSubmitted: boolean;
    message: string;
  }
): FillSummary {
  return {
    attempted: results.length,
    filled: results.filter((result) => result.action === "filled").length,
    skipped: results.filter((result) => result.action === "skipped").length,
    unsupported: results.filter((result) => result.action === "unsupported").length,
    errors: results.filter((result) => result.action === "error").length,
    aiFilled: results.filter(
      (result) => result.action === "filled" && result.fillSource === "ai"
    ).length,
    strategy: settings.fillMode,
    autoSubmitEnabled: settings.autoSubmit,
    autoSubmitted: autoSubmitResult.autoSubmitted,
    autoSubmitMessage: autoSubmitResult.message,
    results,
    filledAt: new Date().toISOString()
  };
}

function getFillSkipMessage(fillMode: FillMode): string {
  switch (fillMode) {
    case "neutral":
      return "Neutral mode only autofills high and medium-confidence matches.";
    case "liberal":
      return "Liberal mode skips only unmatched fields.";
    default:
      return "Conservative mode only autofills high-confidence matches.";
  }
}

function attemptAutoSubmit(
  scan: ScanSummary,
  results: FilledFieldResult[],
  settings: ExtensionSettings
): {
  autoSubmitted: boolean;
  message: string;
} {
  if (results.some((result) => result.action === "error")) {
    return {
      autoSubmitted: false,
      message: "Auto-submit was skipped because at least one field errored during fill."
    };
  }

  if (
    !settings.fullyAutoEnabled &&
    results.some(
      (result) => result.action === "filled" && result.fillSource === "ai"
    )
  ) {
    return {
      autoSubmitted: false,
      message:
        "Auto-submit was skipped because AI-assisted fills require manual review unless fully auto is enabled."
    };
  }

  const submitControl = findVisibleSubmitControl(scan.workflow);

  if (!submitControl) {
    return {
      autoSubmitted: false,
      message: "Auto-submit is enabled, but no final submit control was detected on this step."
    };
  }

  const label = cleanText(
    submitControl.textContent ||
      submitControl.getAttribute("value") ||
      submitControl.getAttribute("aria-label") ||
      submitControl.getAttribute("title")
  );

  submitControl.focus();
  submitControl.click();

  return {
    autoSubmitted: true,
    message: label
      ? `Clicked the detected submit control: ${label}.`
      : "Clicked the detected submit control."
  };
}

function buildResult(
  match: DetectedFieldMatch,
  action: FilledFieldResult["action"],
  valuePreview: string,
  message: string,
  overrides?: Partial<
    Pick<FilledFieldResult, "matchedKey" | "confidence" | "fillSource">
  >
): FilledFieldResult {
  return {
    fieldId: match.fieldId,
    selectorHint: match.selectorHint,
    label: match.label || match.name || match.selectorHint,
    matchedKey: overrides?.matchedKey ?? match.matchedKey,
    confidence: overrides?.confidence ?? match.confidence,
    action,
    fillSource: overrides?.fillSource ?? "none",
    valuePreview,
    message
  };
}

function createAiResolvedValue(suggestion: AiFieldSuggestion): ResolvedProfileValue {
  const value = suggestion.suggestedValue.trim();

  return {
    raw: value || null,
    preview: suggestion.valuePreview || value,
    hasValue: Boolean(value)
  };
}

function isAlreadyFilled(
  group: CandidateGroup,
  resolvedValue: ResolvedProfileValue
): boolean {
  if (isChoiceGroup(group)) {
    return doesChoiceGroupMatchValue(group, resolvedValue);
  }

  const primaryElement = resolvePrimaryElement(group);

  if (!primaryElement) {
    return false;
  }

  if (primaryElement instanceof HTMLSelectElement) {
    return doesSelectMatchValue(primaryElement, resolvedValue);
  }

  if (isCustomSelectionControl(primaryElement)) {
    return doesCustomSelectionMatchValue(primaryElement, resolvedValue);
  }

  if (isTextFillControl(primaryElement)) {
    return doesTextControlMatchValue(primaryElement, resolvedValue);
  }

  return false;
}

async function fillTextControl(
  group: CandidateGroup,
  resolvedValue: ResolvedProfileValue
): Promise<FillControlAttempt> {
  const targetValue = stringifyResolvedValue(resolvedValue);

  if (!targetValue) {
    return {
      changed: false,
      verified: false,
      failureMessage: "The active profile does not contain a usable value for this text field."
    };
  }

  return performVerifiedFill(
    group,
    () => {
      const element = resolvePrimaryElement(group);

      if (!element || !isTextFillControl(element)) {
        return false;
      }

      if (doesTextControlMatchValue(element, resolvedValue)) {
        return true;
      }

      element.focus();
      setTextControlValue(element, targetValue);
      dispatchEvents(element, ["input", "change", "blur"]);
      highlightFilledElement(element);
      return true;
    },
    () => {
      const element = resolvePrimaryElement(group);
      return Boolean(
        element && isTextFillControl(element) && doesTextControlMatchValue(element, resolvedValue)
      );
    },
    {
      noMatchMessage: "The text control could not be updated.",
      verificationFailureMessage:
        "The page reset the text control after autofill, even after retrying."
    }
  );
}

async function fillSelectControl(
  group: CandidateGroup,
  resolvedValue: ResolvedProfileValue
): Promise<FillControlAttempt> {
  return performVerifiedFill(
    group,
    () => {
      const element = resolvePrimaryElement(group);

      if (!(element instanceof HTMLSelectElement)) {
        return false;
      }

      const option = findMatchingOption(element.options, normalizedNeedles(resolvedValue));

      if (!option) {
        return false;
      }

      if (element.value === option.value) {
        return true;
      }

      element.focus();
      setNativeSelectValue(element, option.value);
      dispatchEvents(element, ["input", "change", "blur"]);
      highlightFilledElement(element);
      return true;
    },
    () => {
      const element = resolvePrimaryElement(group);
      return element instanceof HTMLSelectElement
        ? doesSelectMatchValue(element, resolvedValue)
        : false;
    },
    {
      noMatchMessage: "No compatible select option was found.",
      verificationFailureMessage:
        "The select control reset after autofill, even after retrying."
    }
  );
}

async function fillChoiceGroup(
  group: CandidateGroup,
  resolvedValue: ResolvedProfileValue
): Promise<FillControlAttempt> {
  return performVerifiedFill(
    group,
    () => {
      const options = getChoiceElements(group);
      const normalizedValues = normalizedNeedles(resolvedValue);

      if (options.length === 0 || normalizedValues.length === 0) {
        return false;
      }

      if (options.length === 1 && isBooleanChoiceValue(normalizedValues)) {
        const desiredChecked = shouldBooleanChoiceBeChecked(normalizedValues);
        return setChoiceControlChecked(options[0], desiredChecked);
      }

      const matches = options.filter((element) =>
        doesChoiceElementMatchNeedles(element, normalizedValues)
      );

      if (matches.length === 0) {
        return false;
      }

      let changed = false;
      const radioLike = getChoiceKind(options[0]) === "radio";

      matches.forEach((element, index) => {
        if (radioLike && index > 0) {
          return;
        }

        changed = setChoiceControlChecked(element, true) || changed;
      });

      return changed || matches.some(isChoiceControlChecked);
    },
    () => doesChoiceGroupMatchValue(group, resolvedValue),
    {
      noMatchMessage: "A matching option was not found for this choice field.",
      verificationFailureMessage:
        "The selected choice did not persist after autofill, even after retrying."
    }
  );
}

async function fillCustomSelectionControl(
  group: CandidateGroup,
  resolvedValue: ResolvedProfileValue
): Promise<FillControlAttempt> {
  const targetValue = stringifyResolvedValue(resolvedValue);

  return performVerifiedFill(
    group,
    () => {
      const element = resolvePrimaryElement(group);

      if (!element || !isCustomSelectionControl(element)) {
        return false;
      }

      if (doesCustomSelectionMatchValue(element, resolvedValue)) {
        return true;
      }

      const normalizedValues = normalizedNeedles(resolvedValue);

      if (normalizedValues.length === 0) {
        return false;
      }

      openCustomSelectionControl(element);

      const option = findMatchingCustomOption(element, normalizedValues);

      if (option) {
        option.focus();
        option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        option.click();
        dispatchEvents(option, ["input", "change", "blur"]);
        highlightFilledElement(element);
        highlightFilledElement(option);
        return true;
      }

      if (!targetValue || !isTextFillControl(element)) {
        return false;
      }

      element.focus();
      setTextControlValue(element, targetValue);
      dispatchEvents(element, ["input", "change"]);
      dispatchKeyboardEvent(element, "ArrowDown");
      dispatchKeyboardEvent(element, "Enter");
      dispatchEvents(element, ["blur"]);
      highlightFilledElement(element);
      return true;
    },
    () => {
      const element = resolvePrimaryElement(group);
      return element && isCustomSelectionControl(element)
        ? doesCustomSelectionMatchValue(element, resolvedValue)
        : false;
    },
    {
      noMatchMessage: "A matching option was not found for this combobox or listbox.",
      verificationFailureMessage:
        "The combobox or listbox selection did not persist after autofill, even after retrying."
    }
  );
}

function isNativeChoiceControl(element: FormControl): element is HTMLInputElement {
  return (
    element instanceof HTMLInputElement &&
    (element.type === "radio" || element.type === "checkbox")
  );
}

function getChoiceKind(element: ChoiceControl): "radio" | "checkbox" {
  if (element instanceof HTMLInputElement) {
    return element.type === "radio" ? "radio" : "checkbox";
  }

  return getNormalizedRole(element) === "radio" ? "radio" : "checkbox";
}

function isChoiceControlChecked(element: ChoiceControl): boolean {
  if (element instanceof HTMLInputElement) {
    return element.checked;
  }

  return (
    element.getAttribute("aria-checked") === "true" ||
    element.getAttribute("data-selected") === "true"
  );
}

function setChoiceControlChecked(
  element: ChoiceControl,
  checked: boolean
): boolean {
  if (element instanceof HTMLInputElement) {
    if (element.checked === checked) {
      return false;
    }

    element.focus();
    setNativeChecked(element, checked);
    dispatchEvents(element, ["input", "change", "blur"]);
    highlightFilledElement(element);
    return true;
  }

  if (isChoiceControlChecked(element) === checked) {
    return false;
  }

  element.focus();
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  element.click();

  if (isChoiceControlChecked(element) !== checked) {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  if (isChoiceControlChecked(element) !== checked) {
    dispatchKeyboardEvent(element, "Space");
  }

  dispatchEvents(element, ["input", "change", "blur"]);
  highlightFilledElement(element);

  if (element.hasAttribute("aria-checked") && isChoiceControlChecked(element) !== checked) {
    if (getChoiceKind(element) === "radio" && checked) {
      getChoiceGroupElements(element)
        .filter(isCustomChoiceControl)
        .forEach((candidate) => {
          candidate.setAttribute("aria-checked", candidate === element ? "true" : "false");
        });
    } else {
      element.setAttribute("aria-checked", checked ? "true" : "false");
    }
  }

  return true;
}

function isBooleanChoiceValue(normalizedValues: string[]): boolean {
  return normalizedValues.some((value) =>
    ["yes", "true", "no", "false"].includes(value)
  );
}

function shouldBooleanChoiceBeChecked(normalizedValues: string[]): boolean {
  return normalizedValues.some((value) => value === "yes" || value === "true");
}

function getChoiceControlTokens(element: ChoiceControl): string[] {
  const label = getChoiceControlLabel(element);
  const explicitValue =
    element instanceof HTMLInputElement
      ? element.value
      : element.getAttribute("data-value") || element.getAttribute("value") || "";

  return [
    label,
    explicitValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("aria-valuetext") ?? "",
    element.textContent ?? ""
  ]
    .map((value) => normalizeText(cleanText(value)))
    .filter(Boolean);
}

function getChoiceControlLabel(element: ChoiceControl): string {
  if (element instanceof HTMLInputElement) {
    return cleanText(
      element.labels?.[0]?.textContent || element.closest("label")?.textContent
    );
  }

  return cleanText(
    element.getAttribute("aria-label") ||
      resolveAriaReferenceText(element, "aria-labelledby") ||
      element.closest("label")?.textContent ||
      element.textContent
  );
}

function getCustomChoiceGroupingKey(field: CustomFormControl): string | null {
  const role = getNormalizedRole(field);
  const name = field.getAttribute("name")?.trim();

  if (name) {
    return `${role}:${name}`;
  }

  const container = resolveChoiceGroupContainer(field);
  const stableValue = cleanText(
    container?.getAttribute("aria-labelledby") ||
      container?.id ||
      container?.getAttribute("data-question-id") ||
      container?.getAttribute("data-automation-id") ||
      container?.querySelector("legend, [role='heading'], label")?.textContent
  );

  return stableValue ? `${role}:${normalizeText(stableValue)}` : null;
}

function extractChoiceGroupLabel(field: FormControl): string {
  if (!isNativeChoiceControl(field) && !isCustomChoiceControl(field)) {
    return "";
  }

  const container = resolveChoiceGroupContainer(field);

  return cleanText(
    resolveAriaReferenceText(container ?? field, "aria-labelledby") ||
      container?.querySelector("legend, [role='heading'], label")?.textContent ||
      container?.getAttribute("aria-label") ||
      ""
  );
}

function resolveChoiceGroupContainer(field: FormControl): HTMLElement | null {
  return (
    field.closest(
      "[role='radiogroup'], [role='group'], fieldset, [data-question-id], [data-automation-id='formField'], .application-question, .field, .question"
    ) ?? null
  );
}

function getChoiceGroupElements(field: ChoiceControl): ChoiceControl[] {
  const role = getChoiceKind(field);

  if (field instanceof HTMLInputElement && field.name) {
    return dedupeElements(
      Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${field.name}"]`)).filter(
        (input) => input.type === field.type
      )
    );
  }

  const customGroupingKey =
    field instanceof HTMLElement && isCustomChoiceControl(field)
      ? getCustomChoiceGroupingKey(field)
      : null;

  if (customGroupingKey) {
    return dedupeElements(
      Array.from(
        document.querySelectorAll<HTMLElement>(`[role="${role}"]`)
      ).filter(
        (element): element is ChoiceControl =>
          isCustomChoiceControl(element) &&
          getCustomChoiceGroupingKey(element) === customGroupingKey
      )
    );
  }

  const container = resolveChoiceGroupContainer(field);

  if (!container) {
    return [field];
  }

  return dedupeElements(
    Array.from(
      container.querySelectorAll<HTMLElement>(
        role === "radio"
          ? 'input[type="radio"], [role="radio"]'
          : 'input[type="checkbox"], [role="checkbox"]'
      )
    ).filter(
      (element): element is ChoiceControl =>
        isNativeChoiceControl(element as FormControl) ||
        isCustomChoiceControl(element as FormControl)
    )
  );
}

async function performVerifiedFill(
  group: CandidateGroup,
  apply: () => boolean,
  verify: () => boolean,
  messages: {
    noMatchMessage: string;
    verificationFailureMessage: string;
  }
): Promise<FillControlAttempt> {
  if (verify()) {
    return {
      changed: false,
      verified: true,
      failureMessage: ""
    };
  }

  let changed = false;

  for (let attempt = 0; attempt < FILL_VERIFICATION_MAX_ATTEMPTS; attempt += 1) {
    const applied = apply();
    changed = changed || applied;

    if (!applied && !verify()) {
      return {
        changed,
        verified: false,
        failureMessage: messages.noMatchMessage
      };
    }

    const primaryElement = resolvePrimaryElement(group);

    if (primaryElement) {
      await waitForFieldSettle(primaryElement);
    } else {
      await waitForDomUpdate(FILL_SETTLE_DELAY_MS);
    }

    if (verify()) {
      return {
        changed,
        verified: true,
        failureMessage: ""
      };
    }
  }

  return {
    changed,
    verified: false,
    failureMessage: changed
      ? messages.verificationFailureMessage
      : messages.noMatchMessage
  };
}

function getChoiceElements(group: CandidateGroup): ChoiceControl[] {
  return resolveCurrentGroupElements(group).filter(
    (element): element is ChoiceControl =>
      isNativeChoiceControl(element) || isCustomChoiceControl(element)
  );
}

function doesChoiceGroupMatchValue(
  group: CandidateGroup,
  resolvedValue: ResolvedProfileValue
): boolean {
  const normalizedValues = normalizedNeedles(resolvedValue);
  const options = getChoiceElements(group);

  if (normalizedValues.length === 0 || options.length === 0) {
    return false;
  }

  if (options.length === 1 && isBooleanChoiceValue(normalizedValues)) {
    return isChoiceControlChecked(options[0]) === shouldBooleanChoiceBeChecked(normalizedValues);
  }

  const checkedOptions = options.filter(isChoiceControlChecked);

  if (checkedOptions.length === 0) {
    return false;
  }

  const radioLike = getChoiceKind(options[0]) === "radio";

  if (radioLike) {
    return checkedOptions.some((element) =>
      doesChoiceElementMatchNeedles(element, normalizedValues)
    );
  }

  return normalizedValues.every((needle) =>
    checkedOptions.some((element) => doesChoiceElementMatchNeedles(element, [needle]))
  );
}

function doesChoiceElementMatchNeedles(
  element: ChoiceControl,
  normalizedValues: string[]
): boolean {
  const tokens = getChoiceControlTokens(element);

  return normalizedValues.some((needle) =>
    tokens.some((token) => token === needle || token.includes(needle) || needle.includes(token))
  );
}

function doesSelectMatchValue(
  element: HTMLSelectElement,
  resolvedValue: ResolvedProfileValue
): boolean {
  const current = cleanText(
    element.selectedOptions[0]?.textContent || element.value
  );
  const target = normalizedNeedles(resolvedValue);
  const normalizedCurrent = normalizeText(current);

  return Boolean(normalizedCurrent) && target.some((needle) => normalizedCurrent === needle);
}

function doesTextControlMatchValue(
  element: FormControl,
  resolvedValue: ResolvedProfileValue
): boolean {
  if (!isTextFillControl(element)) {
    return false;
  }

  const currentValue = cleanText(readTextControlValue(element));
  const targetValue = stringifyResolvedValue(resolvedValue);

  return Boolean(currentValue) && normalizeText(currentValue) === normalizeText(targetValue);
}

function doesCustomSelectionMatchValue(
  element: CustomFormControl,
  resolvedValue: ResolvedProfileValue
): boolean {
  const normalizedValues = normalizedNeedles(resolvedValue);

  if (normalizedValues.length === 0) {
    return false;
  }

  const selectedOptionText = getAssociatedOptionElements(element)
    .filter((option) =>
      option.getAttribute("aria-selected") === "true" ||
      option.getAttribute("aria-checked") === "true" ||
      option.getAttribute("data-selected") === "true"
    )
    .map((option) => cleanText(option.textContent || option.getAttribute("aria-label")));
  const activeDescendantText = cleanText(
    resolveAriaReferenceElement(element, "aria-activedescendant")?.textContent
  );
  const currentTokens = [
    element.getAttribute("aria-valuetext"),
    element.getAttribute("data-value"),
    activeDescendantText,
    ...selectedOptionText,
    readTextControlValue(element)
  ]
    .map((value) => normalizeText(value ?? ""))
    .filter(Boolean);

  return normalizedValues.some((needle) =>
    currentTokens.some((token) => token === needle || token.includes(needle))
  );
}

function setTextControlValue(
  element: FormControl,
  value: string
): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setNativeValue(element, value);
    return;
  }

  if (element.isContentEditable) {
    element.textContent = value;
    return;
  }

  element.textContent = value;
  element.setAttribute("data-value", value);
}

function readTextControlValue(element: FormControl): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }

  return cleanText(
    element.getAttribute("aria-valuetext") ||
      element.getAttribute("data-value") ||
      element.textContent
  );
}

function openCustomSelectionControl(element: HTMLElement): void {
  element.focus();
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  element.click();
  dispatchKeyboardEvent(element, "ArrowDown");
}

function findMatchingCustomOption(
  element: HTMLElement,
  normalizedValues: string[]
): HTMLElement | null {
  return (
    getAssociatedOptionElements(element).find((option) => {
      const tokens = [
        option.textContent,
        option.getAttribute("aria-label"),
        option.getAttribute("data-value")
      ]
        .map((value) => normalizeText(cleanText(value)))
        .filter(Boolean);

      return normalizedValues.some((needle) =>
        tokens.some((token) => token === needle || token.includes(needle) || needle.includes(token))
      );
    }) ?? null
  );
}

function fillFileInputControl(
  element: HTMLInputElement,
  files: File[]
): boolean {
  const nextFiles = createSyntheticFileList(files);

  if (!nextFiles || files.length === 0) {
    return false;
  }

  element.focus();

  try {
    element.files = nextFiles;
  } catch {
    try {
      Object.defineProperty(element, "files", {
        configurable: true,
        writable: true,
        value: nextFiles
      });
    } catch {
      return false;
    }
  }

  dispatchEvents(element, ["input", "change", "blur"]);
  highlightFilledElement(element);
  return (element.files?.length ?? 0) > 0;
}

function createSyntheticFileList(files: File[]): FileList | null {
  if (typeof DataTransfer !== "undefined") {
    const transfer = new DataTransfer();

    files.forEach((file) => transfer.items.add(file));
    return transfer.files;
  }

  if (files.length === 0) {
    return null;
  }

  const fileList = {
    length: files.length,
    item: (index: number) => files[index] ?? null
  } as Record<number | "length" | "item", File | number | ((index: number) => File | null)>;

  files.forEach((file, index) => {
    fileList[index] = file;
  });

  return fileList as unknown as FileList;
}

function createStoredDocumentFile(
  documentReference: NonNullable<ApplicantProfile["documents"]["resume"]>
): File {
  if (!documentReference.dataBase64) {
    throw new Error("No stored file data was available for the saved resume.");
  }

  const binary = atob(documentReference.dataBase64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], documentReference.fileName || documentReference.name, {
    type: documentReference.mimeType || "application/octet-stream",
    lastModified: Date.parse(documentReference.lastUpdatedAt) || Date.now()
  });
}

function looksLikeResumeUpload(candidate: FieldScanCandidate): boolean {
  const searchable = normalizeText(
    [
      candidate.label,
      candidate.name,
      candidate.elementId,
      candidate.placeholder,
      candidate.ariaLabel,
      candidate.sectionHeading,
      candidate.nearbyText,
      candidate.selectorHint
    ].join(" ")
  );

  if (!searchable) {
    return false;
  }

  const hasResumeSignal =
    searchable.includes("resume") ||
    searchable.includes("curriculum vitae") ||
    /\bcv\b/.test(searchable);
  const hasCoverLetterSignal = searchable.includes("cover letter");

  return hasResumeSignal && !hasCoverLetterSignal;
}

function fileNamesPreview(files: FileList | null): string {
  if (!files || files.length === 0) {
    return "";
  }

  return Array.from(files)
    .map((file) => file.name)
    .filter(Boolean)
    .join(", ");
}

function findMatchingOption(
  options: HTMLOptionsCollection,
  normalizedValues: string[]
): HTMLOptionElement | null {
  const optionList = Array.from(options);

  for (const needle of normalizedValues) {
    const exact = optionList.find((option) => {
      const normalizedOption = normalizeText(option.value || option.textContent || "");
      return normalizedOption === needle;
    });

    if (exact) {
      return exact;
    }
  }

  for (const needle of normalizedValues) {
    const partial = optionList.find((option) => {
      const normalizedOption = normalizeText(option.value || option.textContent || "");
      return normalizedOption.includes(needle) || needle.includes(normalizedOption);
    });

    if (partial) {
      return partial;
    }
  }

  return null;
}

function stringifyResolvedValue(resolvedValue: ResolvedProfileValue): string {
  if (Array.isArray(resolvedValue.raw)) {
    return resolvedValue.raw.join(", ");
  }

  return resolvedValue.raw ?? "";
}

function normalizedNeedles(resolvedValue: ResolvedProfileValue): string[] {
  if (Array.isArray(resolvedValue.raw)) {
    return resolvedValue.raw.map(normalizeText).filter(Boolean);
  }

  const rawValue = resolvedValue.raw ?? "";
  const needles = [normalizeText(rawValue)].filter(Boolean);

  if (needles[0] === "no") {
    needles.push("false");
  } else if (needles[0] === "yes") {
    needles.push("true");
  }

  return needles;
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  descriptor?.set?.call(element, value);

  if (!descriptor?.set) {
    element.value = value;
  }
}

function setNativeSelectValue(element: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value"
  );

  descriptor?.set?.call(element, value);

  if (!descriptor?.set) {
    element.value = value;
  }
}

function setNativeChecked(element: HTMLInputElement, checked: boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "checked"
  );

  descriptor?.set?.call(element, checked);

  if (!descriptor?.set) {
    element.checked = checked;
  }
}

function dispatchEvents(element: HTMLElement, eventNames: string[]): void {
  eventNames.forEach((eventName) => {
    if (eventName === "input" && typeof InputEvent !== "undefined") {
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: null,
          inputType: "insertText"
        })
      );
      return;
    }

    if (eventName === "blur" && typeof FocusEvent !== "undefined") {
      element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      return;
    }

    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
}

function ensureFillHighlightStyle(): void {
  if (document.getElementById(FILL_HIGHLIGHT_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = FILL_HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${FILL_HIGHLIGHT_CLASS} {
      outline: 2px solid rgba(15, 118, 110, 0.75) !important;
      outline-offset: 2px !important;
      background: rgba(15, 118, 110, 0.06) !important;
      transition: outline-color 320ms ease, background-color 320ms ease;
    }
  `;

  document.head.appendChild(style);
}

function highlightFilledElement(element: HTMLElement): void {
  element.classList.add(FILL_HIGHLIGHT_CLASS);

  window.setTimeout(() => {
    element.classList.remove(FILL_HIGHLIGHT_CLASS);
  }, 2200);
}

function getPageFields(): FormControl[] {
  const fields = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "input",
        "textarea",
        "select",
        "[role='textbox']",
        "[role='combobox']",
        "[role='listbox']",
        "[role='radio']",
        "[role='checkbox']",
        "[contenteditable='true']",
        "[contenteditable='plaintext-only']"
      ].join(", ")
    )
  );

  return dedupeElements(fields.filter(isFormControlElement));
}

function isChoiceGroup(group: CandidateGroup): boolean {
  return getChoiceElements(group).length > 0;
}

function isFileInput(element: FormControl): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type === "file";
}

function isScannableFieldElement(field: FormControl): boolean {
  if (isDisabledField(field)) {
    return false;
  }

  if (isFileInput(field)) {
    return true;
  }

  if (!isVisibleField(field)) {
    return false;
  }

  if (field instanceof HTMLInputElement) {
    const ignoredTypes = new Set(["hidden", "submit", "button", "reset"]);

    if (ignoredTypes.has(field.type)) {
      return false;
    }
  }

  return true;
}

function isVisibleField(field: FormControl): boolean {
  if (field instanceof HTMLInputElement && field.type === "hidden") {
    return false;
  }

  if (field.getAttribute("aria-hidden") === "true") {
    return false;
  }

  const style = window.getComputedStyle(field);
  const rect = field.getBoundingClientRect();
  const hiddenByContainer = Boolean(
    field.closest("[hidden], [aria-hidden='true']")
  );

  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    hiddenByContainer
  ) {
    return false;
  }

  if (rect.width > 0 && rect.height > 0) {
    return true;
  }

  return !isDisabledField(field);
}

function isTextLikeCandidate(candidate: FieldScanCandidate): boolean {
  if (candidate.elementTag === "textarea") {
    return true;
  }

  if (candidate.elementTag === "select") {
    return false;
  }

  const ignoredTypes = new Set([
    "checkbox",
    "radio",
    "file",
    "range",
    "color",
    "combobox",
    "listbox"
  ]);

  return !ignoredTypes.has(candidate.inputType);
}

function getGroupingKey(
  field: FormControl,
  candidate: FieldScanCandidate,
  index: number,
  adapter: PlatformAdapter
): string {
  const adapterGroupingKey = adapter.getGroupingKey(field);

  if (adapterGroupingKey) {
    return adapterGroupingKey;
  }

  if (
    field instanceof HTMLInputElement &&
    (field.type === "radio" || field.type === "checkbox") &&
    field.name
  ) {
    return `${field.type}:${field.name}`;
  }

  if (isCustomChoiceControl(field)) {
    return getCustomChoiceGroupingKey(field) ?? candidate.fieldId ?? `field:${index}`;
  }

  return candidate.fieldId || `field:${index}`;
}

function buildFieldId(field: FormControl, index: number): string {
  const stableId =
    field.id ||
    field.getAttribute("name") ||
    field.getAttribute("data-qa") ||
    field.getAttribute("data-testid");

  return stableId?.trim()
    ? `${field.tagName.toLowerCase()}:${stableId.trim()}`
    : `${field.tagName.toLowerCase()}:${index}`;
}

function buildSelectorHint(field: FormControl, index: number): string {
  if (field.id) {
    return `#${field.id}`;
  }

  const name = field.getAttribute("name");

  if (name) {
    return `${field.tagName.toLowerCase()}[name="${name}"]`;
  }

  const dataQa = field.getAttribute("data-qa")?.trim();

  if (dataQa) {
    return `${field.tagName.toLowerCase()}[data-qa="${dataQa}"]`;
  }

  const role = field.getAttribute("role")?.trim();

  if (role) {
    return `${field.tagName.toLowerCase()}[role="${role}"]`;
  }

  return `${field.tagName.toLowerCase()}:index(${index})`;
}

function extractFieldLabel(field: FormControl): string {
  const candidates = [
    extractChoiceGroupLabel(field),
    resolveAriaReferenceText(field, "aria-labelledby"),
    field.id ? document.querySelector(`label[for="${field.id}"]`)?.textContent : "",
    getElementLabelText(field),
    field.closest("label")?.textContent,
    field.getAttribute("aria-label"),
    field.getAttribute("title"),
    field.getAttribute("placeholder"),
    field.getAttribute("name"),
    field.getAttribute("id")
  ];

  const label = candidates.map(cleanText).find((value) => Boolean(value));

  return label ?? "";
}

function getElementLabelText(field: FormControl): string {
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
  ) {
    return cleanText(field.labels?.[0]?.textContent);
  }

  return "";
}

function extractSectionHeading(field: FormControl): string {
  const fieldsetLegend = cleanText(
    field.closest("fieldset")?.querySelector("legend")?.textContent
  );

  if (fieldsetLegend) {
    return fieldsetLegend;
  }

  let current: Element | null = field.parentElement;
  let depth = 0;

  while (current && depth < 5) {
    const heading = cleanText(
      current.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']")?.textContent
    );

    if (heading) {
      return heading;
    }

    current = current.parentElement;
    depth += 1;
  }

  return "";
}

function extractNearbyText(field: FormControl): string {
  const container =
    field.closest("fieldset, section, article, li, div, label") ??
    field.parentElement;
  const text = cleanText(container?.textContent);

  if (!text) {
    return "";
  }

  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function extractOptionLabels(field: FormControl): string[] {
  if (field instanceof HTMLSelectElement) {
    return Array.from(field.options)
      .map((option) => cleanText(option.textContent))
      .filter(Boolean)
      .slice(0, 8);
  }

  if (isCustomChoiceControl(field)) {
    return getChoiceGroupElements(field)
      .map((element) => cleanText(getChoiceControlLabel(element)))
      .filter(Boolean)
      .slice(0, 8);
  }

  if (isCustomSelectionControl(field)) {
    return getAssociatedOptionElements(field)
      .map((option) => cleanText(option.textContent || option.getAttribute("aria-label")))
      .filter(Boolean)
      .slice(0, 8);
  }

  if (isNativeChoiceControl(field) && field.name) {
    return Array.from(document.querySelectorAll<HTMLInputElement>("input"))
      .filter(
        (input) =>
          input.type === field.type &&
          input.name === field.name &&
          isVisibleField(input)
      )
      .map((input) =>
        cleanText(
          input.labels?.[0]?.textContent || input.closest("label")?.textContent
        )
      )
      .filter(Boolean)
      .slice(0, 8);
  }

  return [];
}

function getFieldElementTag(field: FormControl): FieldElementTag {
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
  ) {
    return field.tagName.toLowerCase() as FieldElementTag;
  }

  return "custom";
}

function detectFieldInputType(field: FormControl): string {
  if (field instanceof HTMLInputElement) {
    return field.type.toLowerCase() || "text";
  }

  if (field instanceof HTMLTextAreaElement) {
    return "textarea";
  }

  if (field instanceof HTMLSelectElement) {
    return "select";
  }

  const role = getNormalizedRole(field);

  if (role) {
    return role;
  }

  if (field.isContentEditable) {
    return "contenteditable";
  }

  return "custom";
}

function getFieldPlaceholder(field: FormControl): string {
  return (
    field.getAttribute("placeholder")?.trim() ??
    field.getAttribute("data-placeholder")?.trim() ??
    ""
  );
}

function isRequiredField(field: FormControl): boolean {
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
  ) {
    return field.required || field.getAttribute("aria-required")?.trim() === "true";
  }

  return field.getAttribute("aria-required")?.trim() === "true";
}

function isFormControlElement(field: HTMLElement): field is FormControl {
  return (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement ||
    isCustomFieldElement(field)
  );
}

function isCustomFieldElement(field: HTMLElement): field is CustomFormControl {
  const role = getNormalizedRole(field);

  return (
    field.isContentEditable ||
    role === "textbox" ||
    role === "combobox" ||
    role === "listbox" ||
    role === "radio" ||
    role === "checkbox"
  );
}

function isTextFillControl(field: FormControl): boolean {
  return (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    isCustomTextControl(field)
  );
}

function isCustomTextControl(field: HTMLElement): field is CustomFormControl {
  return (
    field instanceof HTMLElement &&
    !(field instanceof HTMLInputElement) &&
    !(field instanceof HTMLTextAreaElement) &&
    !(field instanceof HTMLSelectElement) &&
    (field.isContentEditable || getNormalizedRole(field) === "textbox")
  );
}

function isCustomSelectionControl(field: HTMLElement): field is CustomFormControl {
  return (
    field instanceof HTMLElement &&
    !(field instanceof HTMLInputElement) &&
    !(field instanceof HTMLTextAreaElement) &&
    !(field instanceof HTMLSelectElement) &&
    (getNormalizedRole(field) === "combobox" || getNormalizedRole(field) === "listbox")
  );
}

function isCustomChoiceControl(field: HTMLElement): field is CustomFormControl {
  return (
    field instanceof HTMLElement &&
    !(field instanceof HTMLInputElement) &&
    !(field instanceof HTMLTextAreaElement) &&
    !(field instanceof HTMLSelectElement) &&
    (getNormalizedRole(field) === "radio" || getNormalizedRole(field) === "checkbox")
  );
}

function isDisabledField(field: FormControl): boolean {
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
  ) {
    return field.disabled || field.getAttribute("aria-disabled") === "true";
  }

  return field.getAttribute("aria-disabled") === "true";
}

function getNormalizedRole(field: HTMLElement): string {
  return field.getAttribute("role")?.trim().toLowerCase() ?? "";
}

function resolveCurrentGroupElements(group: CandidateGroup): FormControl[] {
  const resolved = [
    ...queryElementsFromSelectorHint(group.candidate.selectorHint),
    ...queryElementsById(group.candidate.elementId),
    ...queryElementsByName(group.candidate.name),
    ...group.elements.filter((element) => element.isConnected)
  ];

  return dedupeElements(resolved.filter(isFormControlElement));
}

function resolvePrimaryElement(group: CandidateGroup): FormControl | null {
  return resolveCurrentGroupElements(group)[0] ?? null;
}

function queryElementsFromSelectorHint(selectorHint: string): HTMLElement[] {
  if (!selectorHint || selectorHint.includes(":index(")) {
    return [];
  }

  try {
    return Array.from(document.querySelectorAll<HTMLElement>(selectorHint));
  } catch {
    return [];
  }
}

function queryElementsById(elementId: string): HTMLElement[] {
  if (!elementId) {
    return [];
  }

  const element = document.getElementById(elementId);
  return element ? [element] : [];
}

function queryElementsByName(name: string): HTMLElement[] {
  if (!name) {
    return [];
  }

  return Array.from(document.querySelectorAll<HTMLElement>(`[name="${name}"]`));
}

function waitForFieldSettle(field: HTMLElement, delayMs = FILL_SETTLE_DELAY_MS): Promise<void> {
  const root =
    field.closest("form, fieldset, section, article, [role='group']") ??
    document.body;

  return new Promise((resolve) => {
    let timeoutId = window.setTimeout(finish, delayMs);
    const observer = new MutationObserver(() => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(finish, delayMs);
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    function finish() {
      observer.disconnect();
      window.clearTimeout(timeoutId);
      resolve();
    }
  });
}

function getAssociatedOptionElements(field: HTMLElement): HTMLElement[] {
  const containers: HTMLElement[] = [];
  const associatedByReference = [
    ...resolveAriaReferenceElements(field, "aria-controls"),
    ...resolveAriaReferenceElements(field, "aria-owns")
  ].filter((element): element is HTMLElement => element instanceof HTMLElement);

  if (getNormalizedRole(field) === "listbox") {
    containers.push(field);
  }

  const nearbyListbox = field.closest(
    "[role='combobox'], [role='listbox'], fieldset, section, article, form, div"
  )?.querySelector<HTMLElement>("[role='listbox']");

  if (nearbyListbox) {
    containers.push(nearbyListbox);
  }

  containers.push(...associatedByReference);

  return dedupeElements(
    containers
      .flatMap((container) =>
        Array.from(
          container.querySelectorAll<HTMLElement>("[role='option'], [role='radio']")
        )
      )
      .filter((option) => option.isConnected && !option.closest("[hidden], [aria-hidden='true']"))
  );
}

function resolveAriaReferenceText(
  field: HTMLElement,
  attributeName: string
): string {
  return cleanText(
    resolveAriaReferenceElements(field, attributeName)
      .map((element) => element.textContent ?? "")
      .join(" ")
  );
}

function resolveAriaReferenceElement(
  field: HTMLElement,
  attributeName: string
): HTMLElement | null {
  return resolveAriaReferenceElements(field, attributeName)[0] ?? null;
}

function resolveAriaReferenceElements(
  field: HTMLElement,
  attributeName: string
): HTMLElement[] {
  const ids = field.getAttribute(attributeName)?.trim();

  if (!ids) {
    return [];
  }

  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
}

function dispatchKeyboardEvent(element: HTMLElement, key: string): void {
  element.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: key,
      bubbles: true
    })
  );
  element.dispatchEvent(
    new KeyboardEvent("keyup", {
      key,
      code: key,
      bubbles: true
    })
  );
}

function dedupeElements<T extends Element>(elements: T[]): T[] {
  return elements.filter((element, index) => elements.indexOf(element) === index);
}

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function dedupeStrings(values: string[]): string[] {
  return values.filter(
    (value, index) => Boolean(value) && values.indexOf(value) === index
  );
}

function normalizeText(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-/.]+/g, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueValue(
  value: string,
  index: number,
  values: string[]
): boolean {
  return values.indexOf(value) === index;
}
