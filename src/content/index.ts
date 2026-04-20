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
import { toggleHandshakeMode } from "./handshake-mode";
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
type SearchRoot = Document | ShadowRoot;

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
const CUSTOM_SELECTION_OPTION_POLL_ATTEMPTS = 6;
const CUSTOM_SELECTION_OPTION_POLL_DELAY_MS = 90;
const BUTTON_CHOICE_SELECTOR = [
  "button[aria-pressed]",
  "[role='button'][aria-pressed]",
  "button[aria-checked]",
  "[role='button'][aria-checked]",
  "button[aria-selected]",
  "[role='button'][aria-selected]",
  "button[data-state]",
  "[role='button'][data-state]"
].join(", ");
const AGREEMENT_POPUP_CONTAINER_SELECTOR = [
  "[role='dialog']",
  "[aria-modal='true']",
  ".modal",
  ".dialog",
  ".popup",
  ".overlay",
  "[data-testid*='modal']",
  "[data-testid*='dialog']",
  "[data-testid*='popup']",
  "[class*='modal']",
  "[class*='dialog']",
  "[class*='popup']",
  "[class*='overlay']"
].join(", ");
const AGREEMENT_POPUP_BUTTON_SELECTOR = [
  "button",
  "[role='button']",
  "input[type='button']",
  "input[type='submit']"
].join(", ");
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

      if (request.type === "JOB_APP_TOGGLE_HANDSHAKE_MODE") {
        void toggleHandshakeMode(request.profile, request.settings)
          .then((handshakeMode) => {
            sendResponse({
              ok: true,
              handshakeMode
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
  await clickAgreementPopupButtons();

  for (const match of fieldMatches) {
    const result = await fillMatchedGroup(
      match,
      groupByFieldId.get(match.fieldId),
      profile,
      repeatEntryIndexByFieldId.get(match.fieldId) ?? 0,
      settings,
      aiSuggestionByFieldId.get(match.fieldId)
    );
    results.push(result);

    if (isResumeUploadFillResult(result)) {
      await clickAgreementPopupButtons({ waitForAsyncPopup: true });
    }
  }

  await clickAgreementPopupButtons();

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
  const controls = queryAllDocuments<HTMLElement>(
    "button, [role='button'], input[type='button'], input[type='submit']"
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
  const controls = queryAllDocuments<HTMLElement>(
    "button, [role='button'], input[type='submit'], input[type='button']"
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
    name: getFieldSemanticName(field),
    elementId: getFieldSemanticId(field),
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

  const disabilitySignatureResult = await fillDisabilitySignatureNameField(
    match,
    group,
    profile
  );

  if (disabilitySignatureResult) {
    return disabilitySignatureResult;
  }

  const termsAgreementResult = await fillTermsAgreementPolicyField(match, group);

  if (termsAgreementResult) {
    return termsAgreementResult;
  }

  const randomReferralResult = await fillRandomReferralSourceDropdown(match, group);

  if (randomReferralResult) {
    return randomReferralResult;
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
  const profileFillResolvedValue =
    match.matchedKey && profileResolvedValue
      ? normalizeProfileResolvedValueForFill(
          profile,
          match.matchedKey,
          profileResolvedValue
        )
      : profileResolvedValue;
  const aiResolvedValue = aiSuggestion
    ? createAiResolvedValue(aiSuggestion)
    : null;
  const profileTarget =
    profileSuggestionAllowed &&
    match.matchedKey &&
    profileFillResolvedValue?.hasValue &&
    profileFillResolvedValue.raw !== null
      ? {
          source: "profile" as const,
          matchedKey: match.matchedKey,
          confidence: match.confidence,
          resolvedValue: profileFillResolvedValue
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
  const policyTarget = createBinaryChoicePolicyTarget(match, group);
  const fillTarget = policyTarget ?? (settings.aiPreferGeneratedValues
    ? aiTarget ?? profileTarget
    : profileTarget ?? aiTarget);

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

    if (profileSuggestionAllowed && profileFillResolvedValue) {
      return buildResult(
        match,
        "skipped",
        aiSuggestion?.valuePreview || profileFillResolvedValue.preview,
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
            : fillTarget.source === "none"
              ? "Filled a radio or checkbox choice using the default yes/no policy."
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
            : fillTarget.source === "none"
              ? "Filled a select control using the default yes/no policy."
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
  const primaryElement = findResumeUploadInput(group);

  if (!primaryElement) {
    return buildResult(
      match,
      "error",
      "",
      "A file upload field was detected, but no file input element was available."
    );
  }

  const uploadCandidate = buildFileUploadCandidate(primaryElement, group.candidate);
  const fallbackAllowed =
    queryAllDocuments<HTMLInputElement>("input[type='file']").length === 1 &&
    shouldUseSingleResumeFileInputFallback([primaryElement], group.candidate);

  if (
    !fallbackAllowed &&
    !isLikelyResumeUploadInput(primaryElement, group.candidate) &&
    !looksLikeResumeUpload(uploadCandidate)
  ) {
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

function isResumeUploadFillResult(result: FilledFieldResult): boolean {
  return (
    result.action === "filled" &&
    result.matchedKey === "documents.resume" &&
    result.fillSource === "profile"
  );
}

function createAiResolvedValue(suggestion: AiFieldSuggestion): ResolvedProfileValue {
  const value = suggestion.suggestedValue.trim();

  return {
    raw: value || null,
    preview: suggestion.valuePreview || value,
    hasValue: Boolean(value)
  };
}

function normalizeProfileResolvedValueForFill(
  profile: ApplicantProfile,
  matchedKey: ProfileFieldKey,
  resolvedValue: ResolvedProfileValue
): ResolvedProfileValue {
  if (matchedKey === "workAuthorization.disabilityStatus") {
    return normalizeDisabilityResolvedValueForFill(resolvedValue);
  }

  if (matchedKey !== "contact.phone") {
    return resolvedValue;
  }

  return normalizePhoneResolvedValueForFill(profile, resolvedValue);
}

function normalizePhoneResolvedValueForFill(
  profile: ApplicantProfile,
  resolvedValue: ResolvedProfileValue
): ResolvedProfileValue {
  const rawValue = stringifyResolvedValue(resolvedValue).trim();

  if (!rawValue) {
    return resolvedValue;
  }

  const digits = rawValue.replace(/\D/g, "");
  const country = normalizeText(profile.contact.country || "");
  const hasUsCountry =
    country === "us" ||
    country === "usa" ||
    country === "united states" ||
    country === "united states of america";
  const hasUsDialingPrefix = /^\s*\+1\b/.test(rawValue);
  const shouldUseNationalUsNumber = hasUsCountry || hasUsDialingPrefix;

  if (!shouldUseNationalUsNumber || digits.length < 7) {
    return resolvedValue;
  }

  const nationalDigits =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (nationalDigits.length < 7 || nationalDigits.length > 10) {
    return resolvedValue;
  }

  return {
    raw: nationalDigits,
    preview: nationalDigits,
    hasValue: true
  };
}

function normalizeDisabilityResolvedValueForFill(
  resolvedValue: ResolvedProfileValue
): ResolvedProfileValue {
  const originalValue = stringifyResolvedValue(resolvedValue).trim();
  const normalized = normalizeText(originalValue);

  if (!normalized) {
    return resolvedValue;
  }

  const aliases = [originalValue];

  if (looksLikeDisclosureDeclineValue(normalized)) {
    aliases.push(
      "I do not want to answer",
      "I do not wish to answer",
      "Do not want to answer",
      "Decline to answer",
      "Prefer not to answer",
      "Prefer not to say"
    );
  } else if (looksLikeNoDisabilityValue(normalized)) {
    aliases.push(
      "No, I do not have a disability and have not had one in the past",
      "No, I do not have a disability",
      "I do not have a disability",
      "I don't have a disability",
      "No"
    );
  } else if (looksLikeYesDisabilityValue(normalized)) {
    aliases.push(
      "Yes, I have a disability, or have had one in the past",
      "Yes, I have a disability",
      "I have a disability",
      "Yes"
    );
  }

  const raw = dedupeStrings(aliases.filter(Boolean));

  return {
    raw,
    preview: resolvedValue.preview || originalValue || raw[0] || "",
    hasValue: raw.length > 0
  };
}

function looksLikeDisclosureDeclineValue(normalized: string): boolean {
  return [
    "prefer not to self identify",
    "prefer not to say",
    "prefer not to answer",
    "declined to state",
    "decline to state",
    "decline to answer",
    "i do not want to answer",
    "i dont want to answer",
    "i do not wish to answer",
    "i dont wish to answer",
    "do not want to answer",
    "do not wish to answer"
  ].includes(normalized);
}

function looksLikeNoDisabilityValue(normalized: string): boolean {
  return (
    normalized === "no" ||
    normalized === "no disability" ||
    normalized === "not disabled" ||
    normalized.includes("do not have a disability") ||
    normalized.includes("dont have a disability") ||
    normalized.includes("do not identify as having a disability") ||
    normalized.includes("dont identify as having a disability")
  );
}

function looksLikeYesDisabilityValue(normalized: string): boolean {
  return (
    normalized === "yes" ||
    normalized === "disabled" ||
    normalized === "has disability" ||
    normalized.includes("have a disability") ||
    normalized.includes("had a disability") ||
    normalized.includes("identify as having a disability")
  );
}

function createBinaryChoicePolicyTarget(
  match: DetectedFieldMatch,
  group: CandidateGroup
):
  | {
      source: "none";
      matchedKey: ProfileFieldKey | null;
      confidence: MatchConfidence;
      resolvedValue: ResolvedProfileValue;
    }
  | null {
  if (!isBinaryYesNoPolicyField(match, group)) {
    return null;
  }

  const answer = shouldDefaultYesForBinaryQuestion(match, group) ? "Yes" : "No";

  return {
    source: "none",
    matchedKey: match.matchedKey,
    confidence: match.confidence,
    resolvedValue: {
      raw: answer,
      preview: answer,
      hasValue: true
    }
  };
}

async function fillDisabilitySignatureNameField(
  match: DetectedFieldMatch,
  group: CandidateGroup,
  profile: ApplicantProfile
): Promise<FilledFieldResult | null> {
  if (!isDisabilitySignatureNameField(match, group)) {
    return null;
  }

  const fullName = resolveProfileLegalFullName(profile);

  if (!fullName) {
    return buildResult(
      match,
      "skipped",
      "",
      "The active profile does not contain a legal/full name for this disability signature field.",
      {
        matchedKey: "personal.fullName",
        confidence: "high",
        fillSource: "profile"
      }
    );
  }

  const resolvedValue: ResolvedProfileValue = {
    raw: fullName,
    preview: fullName,
    hasValue: true
  };

  if (isAlreadyFilled(group, resolvedValue)) {
    return buildResult(
      match,
      "skipped",
      fullName,
      "Skipped to avoid overwriting an existing disability signature name.",
      {
        matchedKey: "personal.fullName",
        confidence: "high",
        fillSource: "profile"
      }
    );
  }

  const attempt = await fillTextControl(group, resolvedValue);

  return buildResult(
    match,
    attempt.verified ? "filled" : "skipped",
    fullName,
    attempt.verified
      ? "Filled the disability self-identification signature name."
      : attempt.failureMessage,
    {
      matchedKey: "personal.fullName",
      confidence: "high",
      fillSource: "profile"
    }
  );
}

function isDisabilitySignatureNameField(
  match: DetectedFieldMatch,
  group: CandidateGroup
): boolean {
  const primaryElement = resolvePrimaryElement(group);

  if (
    !primaryElement ||
    primaryElement instanceof HTMLSelectElement ||
    isChoiceGroup(group) ||
    !isTextFillControl(primaryElement) ||
    !isTextLikeCandidate(group.candidate)
  ) {
    return false;
  }

  const fieldIdentity = normalizeText(
    [
      match.label,
      match.name,
      match.placeholder,
      match.ariaLabel,
      group.candidate.label,
      group.candidate.name,
      group.candidate.elementId,
      group.candidate.placeholder,
      group.candidate.ariaLabel
    ].join(" ")
  );
  const sectionText = normalizeText(
    [
      match.sectionHeading,
      match.nearbyText,
      match.matchedLabel,
      group.candidate.sectionHeading,
      group.candidate.nearbyText,
      extractBroaderFieldContext(primaryElement)
    ].join(" ")
  );
  const searchable = normalizeText([fieldIdentity, sectionText].join(" "));

  return (
    looksLikeDisabilitySelfIdentificationSection(searchable) &&
    looksLikeSignatureNameIdentity(fieldIdentity)
  );
}

function looksLikeSignatureNameIdentity(searchable: string): boolean {
  if (!searchable) {
    return false;
  }

  return (
    /\bname\b/.test(searchable) ||
    searchable.includes("signature") ||
    searchable.includes("signed by") ||
    searchable.includes("type your name") ||
    searchable.includes("typed name")
  );
}

function resolveProfileLegalFullName(profile: ApplicantProfile): string {
  const explicitFullName = cleanText(profile.personal.fullName);

  if (explicitFullName) {
    return explicitFullName;
  }

  return cleanText(
    [profile.personal.firstName, profile.personal.lastName]
      .map((value) => cleanText(value))
      .filter(Boolean)
      .join(" ")
  );
}

async function fillTermsAgreementPolicyField(
  match: DetectedFieldMatch,
  group: CandidateGroup
): Promise<FilledFieldResult | null> {
  if (!isTermsAgreementField(match, group)) {
    return null;
  }

  const primaryElement = resolvePrimaryElement(group);
  const resolvedValue = createTermsAgreementResolvedValue(
    Boolean(
      primaryElement &&
        !isChoiceGroup(group) &&
        !(primaryElement instanceof HTMLSelectElement) &&
        !isCustomSelectionControl(primaryElement) &&
        isTextFillControl(primaryElement)
    )
  );

  if (isAlreadyFilled(group, resolvedValue)) {
    return buildTermsAgreementResult(
      match,
      "skipped",
      resolvedValue.preview,
      "Skipped because this terms/conditions field already has an affirmative value."
    );
  }

  let attempt: FillControlAttempt | null = null;

  if (isChoiceGroup(group)) {
    attempt = await fillChoiceGroup(group, resolvedValue);
  } else if (primaryElement instanceof HTMLSelectElement) {
    attempt = await fillSelectControl(group, resolvedValue);
  } else if (primaryElement && isCustomSelectionControl(primaryElement)) {
    attempt = await fillCustomSelectionControl(group, resolvedValue);
  } else if (primaryElement && isTextFillControl(primaryElement)) {
    attempt = await fillTextControl(group, resolvedValue);
  }

  if (!attempt) {
    return null;
  }

  return buildTermsAgreementResult(
    match,
    attempt.verified ? "filled" : "skipped",
    resolvedValue.preview,
    attempt.verified
      ? "Accepted the detected terms/conditions acknowledgement."
      : attempt.failureMessage
  );
}

function buildTermsAgreementResult(
  match: DetectedFieldMatch,
  action: FilledFieldResult["action"],
  valuePreview: string,
  message: string
): FilledFieldResult {
  return buildResult(match, action, valuePreview, message, {
    matchedKey: null,
    confidence: "high",
    fillSource: "none"
  });
}

function createTermsAgreementResolvedValue(forTextField: boolean): ResolvedProfileValue {
  if (forTextField) {
    return {
      raw: "I agree",
      preview: "I agree",
      hasValue: true
    };
  }

  return {
    raw: [
      "I agree",
      "I accept",
      "I acknowledge",
      "I consent",
      "Yes",
      "Agree",
      "Accept",
      "Acknowledge",
      "Consent",
      "Confirm",
      "Confirmed",
      "True"
    ],
    preview: "I agree",
    hasValue: true
  };
}

function isTermsAgreementField(
  match: DetectedFieldMatch,
  group: CandidateGroup
): boolean {
  const primaryElement = resolvePrimaryElement(group);

  if (
    !isChoiceGroup(group) &&
    !(primaryElement instanceof HTMLSelectElement) &&
    !(primaryElement && isCustomSelectionControl(primaryElement)) &&
    !(primaryElement && isTextFillControl(primaryElement))
  ) {
    return false;
  }

  return looksLikeTermsAgreementQuestion(buildTermsAgreementSearchText(match, group));
}

function buildTermsAgreementSearchText(
  match: DetectedFieldMatch,
  group: CandidateGroup
): string {
  return normalizeText(
    [
      match.label,
      match.name,
      match.placeholder,
      match.ariaLabel,
      match.sectionHeading,
      match.nearbyText,
      match.matchedLabel,
      group.candidate.label,
      group.candidate.name,
      group.candidate.elementId,
      group.candidate.placeholder,
      group.candidate.ariaLabel,
      group.candidate.sectionHeading,
      group.candidate.nearbyText,
      ...group.candidate.optionLabels
    ].join(" ")
  );
}

function looksLikeTermsAgreementQuestion(searchable: string): boolean {
  if (!searchable) {
    return false;
  }

  if (looksLikeNonTermsComplianceQuestion(searchable)) {
    return false;
  }

  return (
    searchable.includes("terms and conditions") ||
    searchable.includes("terms of service") ||
    searchable.includes("terms of use") ||
    searchable.includes("terms conditions") ||
    searchable.includes("accept terms") ||
    searchable.includes("agree to terms") ||
    searchable.includes("privacy policy") ||
    searchable.includes("privacy notice") ||
    searchable.includes("candidate privacy") ||
    searchable.includes("data privacy") ||
    searchable.includes("policy acknowledgement") ||
    searchable.includes("policy acknowledgment") ||
    searchable.includes("acknowledge policy") ||
    searchable.includes("acknowledge receipt") ||
    searchable.includes("i acknowledge") ||
    searchable.includes("i agree") ||
    searchable.includes("i accept") ||
    searchable.includes("certify that") ||
    searchable.includes("i certify") ||
    searchable.includes("certification statement") ||
    searchable.includes("consent and release") ||
    searchable.includes("consent to the terms") ||
    searchable.includes("background check consent") ||
    searchable.includes("background check disclosure") ||
    searchable.includes("electronic signature consent") ||
    searchable.includes("agreement accepted") ||
    searchable.includes("agreement acknowledgement") ||
    searchable.includes("agreement acknowledgment")
  );
}

function looksLikeNonTermsComplianceQuestion(searchable: string): boolean {
  return (
    looksLikeDisabilitySelfIdentificationSection(searchable) ||
    searchable.includes("work authorization") ||
    searchable.includes("legal right to work") ||
    searchable.includes("require sponsorship") ||
    searchable.includes("need sponsorship") ||
    searchable.includes("veteran status") ||
    searchable.includes("ethnicity") ||
    searchable.includes("gender identity")
  );
}

async function clickAgreementPopupButtons(options?: {
  waitForAsyncPopup?: boolean;
}): Promise<number> {
  const immediateClicks = clickVisibleAgreementPopupButtons();

  if (immediateClicks > 0 || !options?.waitForAsyncPopup) {
    return immediateClicks;
  }

  await waitForDomUpdate(120);
  return clickVisibleAgreementPopupButtons();
}

function clickVisibleAgreementPopupButtons(): number {
  const clickedButtons = new Set<HTMLElement>();
  let clickedCount = 0;

  getVisibleAgreementPopupContainers().forEach((container) => {
    if (!looksLikeAgreementPopupContainer(container)) {
      return;
    }

    const target = Array.from(
      container.querySelectorAll<HTMLElement>(AGREEMENT_POPUP_BUTTON_SELECTOR)
    ).find(
      (control) =>
        !clickedButtons.has(control) &&
        isVisibleActionControl(control) &&
        looksLikeAgreementPopupButtonLabel(getActionControlLabel(control))
    );

    if (!target) {
      return;
    }

    clickedButtons.add(target);
    activateChoiceTarget(target, "Enter");
    highlightFilledElement(target);
    clickedCount += 1;
  });

  return clickedCount;
}

function getVisibleAgreementPopupContainers(): HTMLElement[] {
  return queryAllDocuments<HTMLElement>(AGREEMENT_POPUP_CONTAINER_SELECTOR).filter(
    (container) => isVisibleElement(container)
  );
}

function looksLikeAgreementPopupContainer(container: HTMLElement): boolean {
  const searchable = normalizeText(getElementDescriptorText(container));

  if (looksLikeTermsAgreementQuestion(searchable)) {
    return true;
  }

  return Array.from(
    container.querySelectorAll<HTMLElement>(AGREEMENT_POPUP_BUTTON_SELECTOR)
  ).some((control) =>
    looksLikeAgreementPopupButtonLabel(getActionControlLabel(control))
  );
}

function getActionControlLabel(control: HTMLElement): string {
  if (control instanceof HTMLInputElement) {
    return cleanText(
      control.value ||
        control.getAttribute("aria-label") ||
        control.getAttribute("title")
    );
  }

  return cleanText(
    [
      control.textContent,
      control.getAttribute("aria-label"),
      control.getAttribute("title"),
      control.getAttribute("value")
    ].join(" ")
  );
}

function looksLikeAgreementPopupButtonLabel(label: string): boolean {
  const normalized = normalizeText(label);

  if (!normalized || looksLikeNegativeAgreementLabel(normalized)) {
    return false;
  }

  return (
    normalized === "i agree" ||
    normalized === "agree" ||
    normalized === "i accept" ||
    normalized === "accept" ||
    normalized === "i acknowledge" ||
    normalized === "acknowledge" ||
    normalized === "yes" ||
    normalized === "confirm" ||
    normalized.includes("agree and continue") ||
    normalized.includes("accept and continue") ||
    normalized.includes("acknowledge and continue") ||
    normalized.includes("i agree to") ||
    normalized.includes("i accept") ||
    normalized.includes("i acknowledge")
  );
}

function looksLikeNegativeAgreementLabel(normalized: string): boolean {
  return (
    normalized.includes("do not") ||
    normalized.includes("dont") ||
    normalized.includes("decline") ||
    normalized.includes("reject") ||
    normalized.includes("disagree") ||
    normalized.includes("not agree") ||
    normalized.includes("not accept")
  );
}

async function fillRandomReferralSourceDropdown(
  match: DetectedFieldMatch,
  group: CandidateGroup
): Promise<FilledFieldResult | null> {
  if (!isReferralSourceDropdown(match, group)) {
    return null;
  }

  const primaryElement = resolvePrimaryElement(group);

  if (primaryElement instanceof HTMLSelectElement) {
    return fillRandomNativeReferralSourceSelect(match, primaryElement);
  }

  if (primaryElement && isCustomSelectionControl(primaryElement)) {
    return fillRandomCustomReferralSourceSelect(match, group, primaryElement);
  }

  return null;
}

function fillRandomNativeReferralSourceSelect(
  match: DetectedFieldMatch,
  element: HTMLSelectElement
): FilledFieldResult {
  const existingOption = element.selectedOptions[0] ?? null;

  if (existingOption && isSelectableReferralOption(existingOption)) {
    return buildRandomReferralResult(
      match,
      "skipped",
      getNativeOptionDisplayText(existingOption),
      "Skipped because this source/referral dropdown already has a selected value."
    );
  }

  const option = pickRandomElement(
    Array.from(element.options).filter(isSelectableReferralOption)
  );

  if (!option) {
    return buildRandomReferralResult(
      match,
      "skipped",
      "",
      "No selectable source/referral dropdown options were available."
    );
  }

  element.focus();
  setNativeSelectValue(element, option.value);
  dispatchEvents(element, ["input", "change", "blur"]);
  highlightFilledElement(element);

  const verified = element.value === option.value;
  const preview = getNativeOptionDisplayText(option);

  return buildRandomReferralResult(
    match,
    verified ? "filled" : "error",
    preview,
    verified
      ? "Randomly selected a source/referral dropdown option."
      : "The source/referral dropdown did not keep the randomly selected option."
  );
}

async function fillRandomCustomReferralSourceSelect(
  match: DetectedFieldMatch,
  group: CandidateGroup,
  element: CustomFormControl
): Promise<FilledFieldResult> {
  const existingValue = getMeaningfulCustomSelectionValue(element);

  if (existingValue) {
    return buildRandomReferralResult(
      match,
      "skipped",
      existingValue,
      "Skipped because this source/referral dropdown already has a selected value."
    );
  }

  openCustomSelectionControl(element);
  await waitForDomUpdate(120);

  const option = pickRandomElement(
    getAssociatedOptionElements(element).filter(isSelectableCustomReferralOption)
  );

  if (!option) {
    return buildRandomReferralResult(
      match,
      "skipped",
      "",
      "No selectable source/referral dropdown options were available."
    );
  }

  const preview = getCustomOptionDisplayText(option);
  activateCustomOption(element, option);
  await waitForDomUpdate(120);

  if (!getMeaningfulCustomSelectionValue(element)) {
    commitCustomSelectionFallback(element, option, preview);
  }

  const verified = Boolean(getMeaningfulCustomSelectionValue(element));

  if (verified) {
    highlightFilledElement(element);
    highlightFilledElement(option);
  }

  void group;

  return buildRandomReferralResult(
    match,
    verified ? "filled" : "error",
    preview,
    verified
      ? "Randomly selected a source/referral dropdown option."
      : "The source/referral dropdown did not keep the randomly selected option."
  );
}

function buildRandomReferralResult(
  match: DetectedFieldMatch,
  action: FilledFieldResult["action"],
  valuePreview: string,
  message: string
): FilledFieldResult {
  return buildResult(match, action, valuePreview, message, {
    matchedKey: null,
    confidence: "high",
    fillSource: "random"
  });
}

function isReferralSourceDropdown(
  match: DetectedFieldMatch,
  group: CandidateGroup
): boolean {
  const primaryElement = resolvePrimaryElement(group);

  if (
    !(primaryElement instanceof HTMLSelectElement) &&
    !(primaryElement && isCustomSelectionControl(primaryElement))
  ) {
    return false;
  }

  return looksLikeReferralSourceQuestion(buildReferralSourceSearchText(match, group));
}

function buildReferralSourceSearchText(
  match: DetectedFieldMatch,
  group: CandidateGroup
): string {
  return normalizeText(
    [
      match.label,
      match.name,
      match.placeholder,
      match.ariaLabel,
      match.sectionHeading,
      match.nearbyText,
      match.matchedLabel,
      group.candidate.label,
      group.candidate.name,
      group.candidate.elementId,
      group.candidate.placeholder,
      group.candidate.ariaLabel,
      group.candidate.sectionHeading,
      group.candidate.nearbyText,
      ...group.candidate.optionLabels
    ].join(" ")
  );
}

function looksLikeReferralSourceQuestion(searchable: string): boolean {
  if (!searchable) {
    return false;
  }

  return (
    searchable.includes("how did you hear about us") ||
    searchable.includes("how did you hear of us") ||
    searchable.includes("how did you learn about us") ||
    searchable.includes("how did you find us") ||
    searchable.includes("where did you hear about us") ||
    searchable.includes("where did you learn about us") ||
    searchable.includes("where did you find this job") ||
    searchable.includes("how did you find this job") ||
    searchable.includes("how did you find this position") ||
    searchable.includes("how did you hear about this job") ||
    searchable.includes("how did you hear about this role") ||
    searchable.includes("how did you hear about this opportunity") ||
    searchable.includes("how did you learn about this opportunity") ||
    searchable.includes("referral source") ||
    searchable.includes("applicant source") ||
    searchable.includes("application source") ||
    searchable.includes("candidate source") ||
    searchable.includes("job source") ||
    searchable.includes("source details") ||
    searchable === "source"
  );
}

function isSelectableReferralOption(option: HTMLOptionElement): boolean {
  if (option.disabled) {
    return false;
  }

  const label = cleanText(option.textContent);
  const value = cleanText(option.value);

  if (!label && !value) {
    return false;
  }

  if (isPlaceholderDropdownToken(label) || isPlaceholderDropdownToken(value)) {
    return false;
  }

  return true;
}

function isSelectableCustomReferralOption(option: HTMLElement): boolean {
  if (
    option.getAttribute("aria-disabled") === "true" ||
    option.hasAttribute("disabled")
  ) {
    return false;
  }

  return isMeaningfulDropdownOptionText(getCustomOptionDisplayText(option));
}

function isMeaningfulDropdownOptionText(value: string): boolean {
  const normalized = normalizeText(cleanText(value));

  if (!normalized) {
    return false;
  }

  return !isPlaceholderDropdownToken(normalized);
}

function isPlaceholderDropdownToken(value: string): boolean {
  const normalized = normalizeText(cleanText(value));

  if (!normalized) {
    return false;
  }

  return [
    "select",
    "please select",
    "select an option",
    "choose",
    "choose one",
    "choose an option",
    "none selected",
    "not selected",
    "unknown"
  ].includes(normalized);
}

function getNativeOptionDisplayText(option: HTMLOptionElement): string {
  return cleanText(option.textContent || option.value);
}

function getCustomOptionDisplayText(option: HTMLElement): string {
  return cleanText(
    option.textContent ||
      option.getAttribute("aria-label") ||
      option.getAttribute("data-label") ||
      option.getAttribute("data-value") ||
      option.getAttribute("value") ||
      option.getAttribute("title")
  );
}

function getMeaningfulCustomSelectionValue(element: CustomFormControl): string {
  const current = cleanText(
    readTextControlValue(element) ||
      element.getAttribute("aria-valuetext") ||
      element.getAttribute("data-value") ||
      resolveAriaReferenceElement(element, "aria-activedescendant")?.textContent
  );

  return isMeaningfulDropdownOptionText(current) ? current : "";
}

function pickRandomElement<T>(items: T[]): T | null {
  if (items.length === 0) {
    return null;
  }

  return items[Math.floor(Math.random() * items.length)] ?? items[0] ?? null;
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
      option.selected = true;
      element.selectedIndex = option.index;
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
    async () => {
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
      const option = await waitForMatchingCustomOption(
        element,
        normalizedValues,
        targetValue
      );

      if (option) {
        activateCustomOption(element, option);
        await waitForDomUpdate(100);

        if (!doesCustomSelectionMatchValue(element, resolvedValue)) {
          commitCustomSelectionFallback(element, option, targetValue);
          await waitForDomUpdate(60);
        }

        closeCustomSelectionControl(element);
        highlightFilledElement(element);
        highlightFilledElement(option);
        return true;
      }

      if (!targetValue || !isTextFillControl(element)) {
        return false;
      }

      typeIntoCustomSelectionControl(element, targetValue);
      dispatchKeyboardEvent(element, "ArrowDown");
      await waitForDomUpdate(80);
      dispatchKeyboardEvent(element, "Enter");
      closeCustomSelectionControl(element);
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

  return getInferredChoiceKind(element) === "radio" ? "radio" : "checkbox";
}

function isChoiceControlChecked(element: ChoiceControl): boolean {
  if (element instanceof HTMLInputElement) {
    return element.checked;
  }

  const dataState = element.getAttribute("data-state")?.toLowerCase();
  const ariaPressed = element.getAttribute("aria-pressed");
  const ariaSelected = element.getAttribute("aria-selected");

  return (
    element.getAttribute("aria-checked") === "true" ||
    element.getAttribute("data-selected") === "true" ||
    ariaPressed === "true" ||
    ariaSelected === "true" ||
    dataState === "checked" ||
    dataState === "active" ||
    dataState === "on" ||
    dataState === "selected"
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

    const clickTarget = checked ? resolveNativeChoiceClickTarget(element) : null;

    if (clickTarget) {
      activateChoiceTarget(clickTarget, getChoiceKind(element) === "radio" ? "Enter" : "Space");
      dispatchEvents(element, ["input", "change", "blur"]);
      highlightFilledElement(element);
      highlightFilledElement(clickTarget);

      if (element.checked === checked) {
        return true;
      }
    }

    activateChoiceTarget(element, getChoiceKind(element) === "radio" ? "Enter" : "Space");
    dispatchEvents(element, ["input", "change", "blur"]);

    if (element.checked === checked) {
      highlightFilledElement(element);
      return true;
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

  activateChoiceTarget(element, getChoiceKind(element) === "radio" ? "Enter" : "Space");

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
          if (candidate.hasAttribute("aria-pressed")) {
            candidate.setAttribute("aria-pressed", candidate === element ? "true" : "false");
          }
          if (candidate.hasAttribute("aria-selected")) {
            candidate.setAttribute("aria-selected", candidate === element ? "true" : "false");
          }
          if (candidate.hasAttribute("data-state")) {
            candidate.setAttribute("data-state", candidate === element ? "checked" : "unchecked");
          }
        });
      } else {
        element.setAttribute("aria-checked", checked ? "true" : "false");
      }
    }

  if (isChoiceControlChecked(element) !== checked) {
    if (element.hasAttribute("aria-pressed")) {
      if (getChoiceKind(element) === "radio" && checked) {
        getChoiceGroupElements(element)
          .filter(isCustomChoiceControl)
          .forEach((candidate) => {
            candidate.setAttribute("aria-pressed", candidate === element ? "true" : "false");
          });
      } else {
        element.setAttribute("aria-pressed", checked ? "true" : "false");
      }
    }

    if (element.hasAttribute("aria-selected")) {
      if (getChoiceKind(element) === "radio" && checked) {
        getChoiceGroupElements(element)
          .filter(isCustomChoiceControl)
          .forEach((candidate) => {
            candidate.setAttribute("aria-selected", candidate === element ? "true" : "false");
          });
      } else {
        element.setAttribute("aria-selected", checked ? "true" : "false");
      }
    }

    if (element.hasAttribute("data-state")) {
      if (getChoiceKind(element) === "radio" && checked) {
        getChoiceGroupElements(element)
          .filter(isCustomChoiceControl)
          .forEach((candidate) => {
            candidate.setAttribute("data-state", candidate === element ? "checked" : "unchecked");
          });
      } else {
        element.setAttribute("data-state", checked ? "checked" : "unchecked");
      }
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
      getNativeChoiceLabelElements(element)
        .map((label) => label.textContent || "")
        .find((text) => Boolean(cleanText(text))) ||
        element.labels?.[0]?.textContent ||
        element.closest("label")?.textContent
    );
  }

  return cleanText(
    element.getAttribute("aria-label") ||
      resolveAriaReferenceText(element, "aria-labelledby") ||
      element.closest("label")?.textContent ||
      element.textContent
  );
}

function getNativeChoiceLabelElements(element: HTMLInputElement): HTMLElement[] {
  const labels = Array.from(element.labels ?? []);

  if (labels.length > 0) {
    return dedupeElements(labels);
  }

  const fallback: HTMLElement[] = [];
  const closestLabel = element.closest("label");

  if (closestLabel instanceof HTMLElement) {
    fallback.push(closestLabel);
  }

  if (element.id) {
    fallback.push(...queryAllDocuments<HTMLElement>(`label[for="${escapeAttributeValue(element.id)}"]`));
  }

  return dedupeElements(fallback);
}

function resolveNativeChoiceClickTarget(
  element: HTMLInputElement
): HTMLElement | HTMLInputElement | null {
  const visibleLabel = getNativeChoiceLabelElements(element).find(isVisibleElement);

  if (visibleLabel) {
    return visibleLabel;
  }

  const visibleProxy = getNativeChoiceProxyCandidates(element).find(isVisibleElement);

  if (visibleProxy) {
    return visibleProxy;
  }

  return isVisibleField(element) ? element : null;
}

function getNativeChoiceProxyCandidates(element: HTMLInputElement): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  let current = element.parentElement;
  let depth = 0;

  while (current && depth < 4) {
    const otherChoiceControls = Array.from(
      current.querySelectorAll<HTMLElement>(
        "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']"
      )
    ).filter((candidate) => candidate !== element);

    if (otherChoiceControls.length === 0) {
      candidates.push(current);
    }

    current = current.parentElement;
    depth += 1;
  }

  return dedupeElements(candidates);
}

function activateChoiceTarget(
  target: HTMLElement,
  keyboardKey?: "Enter" | "Space"
): void {
  target.scrollIntoView?.({
    block: "center",
    inline: "nearest"
  });
  target.focus?.();

  if (typeof PointerEvent !== "undefined") {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }

  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  target.click();

  if (keyboardKey) {
    dispatchKeyboardEvent(target, keyboardKey);
  }
}

function getInferredChoiceKind(element: HTMLElement): "radio" | "checkbox" | null {
  const role = getNormalizedRole(element);

  if (role === "radio" || role === "checkbox") {
    return role;
  }

  if (!isButtonChoiceControl(element)) {
    return null;
  }

  const container = resolveChoiceGroupContainer(element as FormControl);

  if (container?.matches("[role='radiogroup']")) {
    return "radio";
  }

  if (container?.matches("[role='group']") && hasBinaryChoiceButtons(container)) {
    return "radio";
  }

  if (container && hasBinaryChoiceButtons(container)) {
    return "radio";
  }

  return "checkbox";
}

function isButtonChoiceControl(field: HTMLElement): boolean {
  if (!(field instanceof HTMLButtonElement) && getNormalizedRole(field) !== "button") {
    return false;
  }

  if (field.matches("[role='tab'], [aria-haspopup='menu']")) {
    return false;
  }

  const dataState = field.getAttribute("data-state")?.toLowerCase() ?? "";
  const hasChoiceState =
    field.hasAttribute("aria-pressed") ||
    field.hasAttribute("aria-checked") ||
    field.hasAttribute("aria-selected") ||
    ["checked", "unchecked", "active", "inactive", "on", "off", "selected", "unselected"].includes(
      dataState
    );

  if (!hasChoiceState) {
    return false;
  }

  const text = cleanText(
    field.getAttribute("aria-label") ||
      field.getAttribute("value") ||
      field.textContent
  );

  if (!text) {
    return false;
  }

  const container = resolveChoiceGroupContainer(field as FormControl);
  const siblingChoices = container
    ? Array.from(
        container.querySelectorAll<HTMLElement>(
          `${BUTTON_CHOICE_SELECTOR}, [role='radio'], [role='checkbox'], input[type='radio'], input[type='checkbox']`
        )
      ).filter((candidate) => candidate !== field)
    : [];

  return siblingChoices.length > 0;
}

function hasBinaryChoiceButtons(container: HTMLElement): boolean {
  const labels = Array.from(
    container.querySelectorAll<HTMLElement>(
      `${BUTTON_CHOICE_SELECTOR}, [role='radio'], [role='checkbox'], label, button`
    )
  )
    .map((element) => normalizeText(cleanText(element.textContent || element.getAttribute("aria-label"))))
    .filter(Boolean)
    .slice(0, 8);

  return labels.includes("yes") && labels.includes("no");
}

function getCustomChoiceGroupingKey(field: CustomFormControl): string | null {
  const role = getInferredChoiceKind(field) ?? getNormalizedRole(field);
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
      extractChoicePromptText(container) ||
      container?.querySelector("legend, [role='heading'], label")?.textContent ||
      container?.getAttribute("aria-label") ||
      ""
  );
}

function extractChoicePromptText(container: HTMLElement | null): string {
  if (!container) {
    return "";
  }

  const directPrompt = Array.from(container.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement)
    .find((child) => {
      if (
        child.matches(
          `label, input, select, textarea, button, [role='button'], [role='radio'], [role='checkbox'], [role='option']`
        )
      ) {
        return false;
      }

      if (
        child.querySelector(
          "input, select, textarea, button, [role='button'], [role='radio'], [role='checkbox'], [role='option']"
        )
      ) {
        return false;
      }

      return Boolean(cleanText(child.textContent || ""));
    });

  if (directPrompt) {
    return cleanText(directPrompt.textContent || "");
  }

  const textNodes = Array.from(container.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => cleanText(node.textContent || ""))
    .filter(Boolean);

  return textNodes[0] ?? "";
}

function resolveChoiceGroupContainer(field: FormControl): HTMLElement | null {
  return (
    field.closest(
      "[role='radiogroup'], [role='group'], fieldset, [data-question-id], [data-testid*='question'], [data-testid*='field'], [data-testid*='input'], [data-automation-id='formField'], .application-question, .field, .question"
    ) ?? null
  );
}

function getChoiceGroupElements(field: ChoiceControl): ChoiceControl[] {
  const role = getChoiceKind(field);

  if (field instanceof HTMLInputElement && field.name) {
    return dedupeElements(
      queryAllDocuments<HTMLInputElement>(`input[name="${escapeAttributeValue(field.name)}"]`).filter(
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
      queryAllDocuments<HTMLElement>(
        role === "radio"
          ? `[role="radio"], ${BUTTON_CHOICE_SELECTOR}`
          : `[role="checkbox"], ${BUTTON_CHOICE_SELECTOR}`
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
          ? `input[type="radio"], [role="radio"], ${BUTTON_CHOICE_SELECTOR}`
          : `input[type="checkbox"], [role="checkbox"], ${BUTTON_CHOICE_SELECTOR}`
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
  apply: () => boolean | Promise<boolean>,
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
    const applied = await apply();
    changed = changed || applied;

    if (verify()) {
      return {
        changed,
        verified: true,
        failureMessage: ""
      };
    }

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

function isBinaryYesNoPolicyField(
  match: DetectedFieldMatch,
  group: CandidateGroup
): boolean {
  const primaryElement = resolvePrimaryElement(group);
  const searchable = buildBinaryPolicySearchText(match, group);

  if (
    match.matchedKey === "workAuthorization.disabilityStatus" ||
    looksLikeDisabilitySelfIdentificationSection(searchable)
  ) {
    return false;
  }

  if (isChoiceGroup(group)) {
    const options = getChoiceElements(group);

    if (options.length === 0 || getChoiceKind(options[0]) !== "radio") {
      return false;
    }

    const tokens = options.flatMap((option) => getChoiceControlTokens(option));
    return (
      hasBinaryYesNoTokens(tokens) ||
      (isKnownYesNoPolicyKey(match.matchedKey) && hasUnknownChoiceToken(tokens)) ||
      looksLikeBinaryQuestion(searchable)
    );
  }

  if (primaryElement instanceof HTMLSelectElement) {
    const tokens = Array.from(primaryElement.options).flatMap((option) => [
      option.textContent ?? "",
      option.label ?? "",
      option.value ?? ""
    ]);
    return (
      hasBinaryYesNoTokens(tokens) ||
      (isKnownYesNoPolicyKey(match.matchedKey) && hasUnknownChoiceToken(tokens)) ||
      looksLikeBinaryQuestion(searchable)
    );
  }

  if (primaryElement && isCustomSelectionControl(primaryElement)) {
    const tokens = getAssociatedOptionElements(primaryElement).flatMap((option) => [
      option.textContent ?? "",
      option.getAttribute("aria-label") ?? "",
      option.getAttribute("data-value") ?? ""
    ]);
    return (
      hasBinaryYesNoTokens(tokens) ||
      (isKnownYesNoPolicyKey(match.matchedKey) && hasUnknownChoiceToken(tokens)) ||
      looksLikeBinaryQuestion(searchable)
    );
  }

  return false;
}

function looksLikeDisabilitySelfIdentificationSection(searchable: string): boolean {
  if (!searchable) {
    return false;
  }

  const hasDisabilityAnchor =
    searchable.includes("disability") ||
    searchable.includes("form cc") ||
    searchable.includes("cc 305") ||
    searchable.includes("cc305") ||
    searchable.includes("cc-305") ||
    searchable.includes("individual with a disability") ||
    searchable.includes("have a disability") ||
    searchable.includes("disability status");
  const hasSelfIdentificationSignal =
    searchable.includes("self identification") ||
    searchable.includes("self identify") ||
    searchable.includes("self-identification") ||
    searchable.includes("self-identify") ||
    searchable.includes("self id") ||
    searchable.includes("self-id") ||
    searchable.includes("voluntary self identification") ||
    searchable.includes("voluntary self identify") ||
    searchable.includes("voluntary self id") ||
    searchable.includes("voluntary self-id");

  return (
    (hasDisabilityAnchor && hasSelfIdentificationSignal) ||
    searchable.includes("form cc 305") ||
    searchable.includes("standard form cc 305") ||
    searchable.includes("voluntary self identification form") ||
    searchable.includes("voluntary self-identification form")
  );
}

function hasBinaryYesNoTokens(values: string[]): boolean {
  const normalized = values
    .map((value) => normalizeBinaryChoiceToken(value))
    .filter((value): value is "yes" | "no" => value !== null);

  return normalized.includes("yes") && normalized.includes("no");
}

function normalizeBinaryChoiceToken(
  value: string | null | undefined
): "yes" | "no" | null {
  const normalized = normalizeText(cleanText(value));

  if (!normalized) {
    return null;
  }

  if (["yes", "y", "true"].includes(normalized)) {
    return "yes";
  }

  if (["no", "n", "false"].includes(normalized)) {
    return "no";
  }

  return null;
}

function hasUnknownChoiceToken(values: string[]): boolean {
  return values.some((value) => {
    const normalized = normalizeText(cleanText(value));
    return ["unknown", "undisclosed", "unset"].includes(normalized);
  });
}

function isKnownYesNoPolicyKey(key: ProfileFieldKey | null): boolean {
  return [
    "workAuthorization.requiresSponsorship",
    "workAuthorization.requiresFutureSponsorship",
    "workAuthorization.isAtLeast18",
    "workAuthorization.canVerifyLegalWorkRight",
    "workAuthorization.terminationHistory",
    "workAuthorization.friendsOrRelativesAtCompany",
    "workAuthorization.exportControlCitizenship",
    "workAuthorization.boardDirectorPlans"
  ].includes(key ?? "");
}

function buildBinaryPolicySearchText(
  match: DetectedFieldMatch,
  group: CandidateGroup
): string {
  return normalizeText(
    [
      match.label,
      match.name,
      match.placeholder,
      match.ariaLabel,
      match.sectionHeading,
      match.nearbyText,
      match.matchedLabel,
      group.candidate.label,
      group.candidate.name,
      group.candidate.elementId,
      group.candidate.placeholder,
      group.candidate.ariaLabel,
      group.candidate.sectionHeading,
      group.candidate.nearbyText,
      ...group.candidate.optionLabels
    ].join(" ")
  );
}

function looksLikeBinaryQuestion(searchable: string): boolean {
  if (!searchable) {
    return false;
  }

  return (
    searchable.includes(" are you ") ||
    searchable.startsWith("are you ") ||
    searchable.includes(" do you ") ||
    searchable.startsWith("do you ") ||
    searchable.includes(" have you ") ||
    searchable.startsWith("have you ") ||
    searchable.includes(" can you ") ||
    searchable.startsWith("can you ") ||
    searchable.includes(" will you ") ||
    searchable.startsWith("will you ") ||
    searchable.includes(" require sponsorship ") ||
    searchable.includes(" need sponsorship ") ||
    searchable.includes(" immigration related employment benefit ") ||
    searchable.includes(" if employment is offered can you ") ||
    searchable.includes(" legally authorized ") ||
    searchable.includes(" legal right to work ")
  );
}

function looksLikeAgeEligibilityQuestion(searchable: string): boolean {
  if (!searchable) {
    return false;
  }

  return (
    searchable.includes("at least 18") ||
    searchable.includes("18 years old") ||
    searchable.includes("18 years of age") ||
    searchable.includes("18 or older") ||
    searchable.includes("older than 18") ||
    searchable.includes("age requirement") ||
    searchable.includes("age eligibility")
  );
}

function shouldDefaultYesForBinaryQuestion(
  match: DetectedFieldMatch,
  group: CandidateGroup
): boolean {
  const searchable = buildBinaryPolicySearchText(match, group);

  if (!searchable) {
    return false;
  }

  if (looksLikeTermsAgreementQuestion(searchable)) {
    return true;
  }

  if (
    looksLikeAgeEligibilityQuestion(searchable) ||
    searchable.includes("sponsorship") ||
    searchable.includes("future sponsorship") ||
    searchable.includes("visa")
  ) {
    return looksLikeAgeEligibilityQuestion(searchable);
  }

  return [
    "authorized to work",
    "legally authorized",
    "legal right to work",
    "verify legal right to work",
    "verification of your legal right to work",
    "work authorization",
    "eligible to work",
    "employment authorization",
    "authorized for employment"
  ].some((phrase) => searchable.includes(phrase));
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

  const expectedOptions = options.filter((element) =>
    doesChoiceElementMatchNeedles(element, normalizedValues)
  );

  if (expectedOptions.length === 0) {
    return false;
  }

  return expectedOptions.every(isChoiceControlChecked);
}

function doesChoiceElementMatchNeedles(
  element: ChoiceControl,
  normalizedValues: string[]
): boolean {
  const tokens = getChoiceControlTokens(element);

  return normalizedValues.some((needle) =>
    tokens.some((token) => doesNormalizedOptionTokenMatch(token, needle))
  );
}

function doesSelectMatchValue(
  element: HTMLSelectElement,
  resolvedValue: ResolvedProfileValue
): boolean {
  const target = normalizedNeedles(resolvedValue);
  const currentTokens = [
    element.selectedOptions[0]?.textContent,
    element.selectedOptions[0]?.value,
    element.value
  ]
    .map((value) => normalizeText(cleanText(value ?? "")))
    .filter(Boolean);

  return currentTokens.some((token) =>
    target.some((needle) => doesNormalizedOptionTokenMatch(token, needle))
  );
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
    .flatMap((option) => [
      cleanText(option.textContent || option.getAttribute("aria-label")),
      cleanText(option.getAttribute("data-value") || option.getAttribute("value"))
    ]);
  const activeDescendantText = cleanText(
    resolveAriaReferenceElement(element, "aria-activedescendant")?.textContent
  );
  const backingFieldValues = getCustomSelectionBackingFields(element).flatMap((field) =>
    getSelectionFieldTokens(field)
  );
  const currentTokens = [
    element.getAttribute("aria-valuetext"),
    element.getAttribute("data-value"),
    activeDescendantText,
    ...selectedOptionText,
    ...backingFieldValues,
    readTextControlValue(element)
  ]
    .map((value) => normalizeText(value ?? ""))
    .filter(Boolean);

  const matched = normalizedValues.some((needle) =>
    currentTokens.some((token) => doesNormalizedOptionTokenMatch(token, needle))
  );

  if (!matched) {
    return false;
  }

  const requiredFields = [
    ...(isRequiredField(element as FormControl) ? [element] : []),
    ...getCustomSelectionBackingFields(element).filter((field) => isRequiredField(field))
  ];

  return requiredFields.every((field) => !isSelectionFieldValueMissing(field));
}

function getSelectionFieldTokens(
  field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): string[] {
  if (field instanceof HTMLSelectElement) {
    return [
      cleanText(field.value),
      cleanText(field.selectedOptions[0]?.textContent),
      cleanText(field.selectedOptions[0]?.value)
    ].filter(Boolean);
  }

  return [cleanText(field.value)].filter(Boolean);
}

function isSelectionFieldValueMissing(
  field: HTMLElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): boolean {
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLSelectElement ||
    field instanceof HTMLTextAreaElement
  ) {
    if (field instanceof HTMLSelectElement) {
      return (
        !cleanText(field.value) ||
        isPlaceholderLikeSelectionValue(field.value) ||
        field.validity?.valueMissing === true
      );
    }

    return !cleanText(field.value);
  }

  const currentValue = cleanText(
    field.getAttribute("aria-valuetext") ||
      field.getAttribute("data-value") ||
      field.textContent
  );

  return !currentValue || isPlaceholderLikeSelectionValue(currentValue);
}

function isPlaceholderLikeSelectionValue(value: string): boolean {
  const normalized = normalizeText(value);
  return ["select", "choose", "choose one", "please select"].includes(normalized);
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
  element.scrollIntoView?.({ block: "center", inline: "nearest" });
  element.focus();
  dispatchPointerLikeEvent(element, "pointerdown");
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  dispatchPointerLikeEvent(element, "pointerup");
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  element.click();
  dispatchKeyboardEvent(element, "ArrowDown");
}

function closeCustomSelectionControl(element: HTMLElement): void {
  dispatchEvents(element, ["blur"]);
}

function typeIntoCustomSelectionControl(element: HTMLElement, targetValue: string): void {
  if (!targetValue || !isTextFillControl(element as FormControl)) {
    return;
  }

  element.focus();
  setTextControlValue(element as FormControl, targetValue);
  dispatchEvents(element, ["input", "change"]);
}

async function waitForMatchingCustomOption(
  element: HTMLElement,
  normalizedValues: string[],
  targetValue: string
): Promise<HTMLElement | null> {
  let typedSearch = false;

  for (
    let attempt = 0;
    attempt < CUSTOM_SELECTION_OPTION_POLL_ATTEMPTS;
    attempt += 1
  ) {
    const option = findMatchingCustomOption(element, normalizedValues);

    if (option) {
      return option;
    }

    if (!typedSearch && targetValue && isTextFillControl(element as FormControl)) {
      typeIntoCustomSelectionControl(element, targetValue);
      typedSearch = true;
    } else if (attempt > 0 && element.getAttribute("aria-expanded") === "false") {
      openCustomSelectionControl(element);
    }

    await waitForDomUpdate(CUSTOM_SELECTION_OPTION_POLL_DELAY_MS);
  }

  return findMatchingCustomOption(element, normalizedValues);
}

function findMatchingCustomOption(
  element: HTMLElement,
  normalizedValues: string[]
): HTMLElement | null {
  const options = getAssociatedOptionElements(element).map((option) => ({
    option,
    tokens: getCustomOptionTokens(option)
  }));

  for (const needle of normalizedValues) {
    const exact = options.find(({ tokens }) =>
      tokens.some((token) => token === needle)
    );

    if (exact) {
      return exact.option;
    }
  }

  for (const needle of normalizedValues) {
    const partial = options.find(({ tokens }) =>
      tokens.some((token) => doesNormalizedOptionTokenMatch(token, needle))
    );

    if (partial) {
      return partial.option;
    }
  }

  return null;
}

function getCustomOptionTokens(option: HTMLElement): string[] {
  return [
    option.textContent,
    option.getAttribute("aria-label"),
    option.getAttribute("data-value"),
    option.getAttribute("data-key"),
    option.getAttribute("data-label"),
    option.getAttribute("value"),
    option.getAttribute("aria-valuetext"),
    option.getAttribute("title")
  ]
    .map((value) => normalizeText(cleanText(value)))
    .filter(Boolean);
}

function activateCustomOption(control: HTMLElement, option: HTMLElement): void {
  option.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  option.focus();
  dispatchPointerLikeEvent(option, "pointerdown");
  option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  dispatchPointerLikeEvent(option, "pointerup");
  option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  option.click();
  dispatchEvents(option, ["input", "change"]);
  dispatchEvents(control, ["input", "change"]);
}

function commitCustomSelectionFallback(
  control: HTMLElement,
  option: HTMLElement,
  targetValue: string
): void {
  const optionText = cleanText(
    option.textContent || option.getAttribute("aria-label") || targetValue
  );
  const committedValue = getCustomOptionCommittedValue(option, optionText || targetValue);
  const visibleValue = optionText || targetValue || committedValue;

  if (!visibleValue && !committedValue) {
    return;
  }

  getAssociatedOptionElements(control).forEach((candidate) => {
    const selected = candidate === option;

    if (candidate.hasAttribute("aria-selected")) {
      candidate.setAttribute("aria-selected", selected ? "true" : "false");
    }

    if (candidate.hasAttribute("aria-checked")) {
      candidate.setAttribute("aria-checked", selected ? "true" : "false");
    }

    if (candidate.hasAttribute("data-selected")) {
      candidate.setAttribute("data-selected", selected ? "true" : "false");
    }
  });

  if (option.id) {
    control.setAttribute("aria-activedescendant", option.id);
  }

  if (visibleValue) {
    control.setAttribute("aria-valuetext", visibleValue);
  }

  if (committedValue) {
    control.setAttribute("data-value", committedValue);
  }

  if (isTextFillControl(control as FormControl)) {
    setTextControlValue(control as FormControl, visibleValue || committedValue);
  } else {
    const valueContainer =
      control.querySelector<HTMLElement>(
        "[data-value-label], [data-selected-label], [class*='value'], [class*='selected'], span"
      ) ?? control;

    valueContainer.textContent = visibleValue || committedValue;
  }

  syncCustomSelectionBackingFields(control, committedValue, visibleValue || committedValue);
  dispatchEvents(control, ["input", "change", "blur"]);
}

function getCustomOptionCommittedValue(
  option: HTMLElement,
  fallbackValue: string
): string {
  return cleanText(
    option.getAttribute("data-value") ||
      option.getAttribute("value") ||
      option.getAttribute("data-key") ||
      option.getAttribute("aria-valuetext") ||
      fallbackValue
  );
}

function syncCustomSelectionBackingFields(
  control: HTMLElement,
  committedValue: string,
  visibleValue: string
): void {
  const fields = getCustomSelectionBackingFields(control);
  const preferredValues = [committedValue, visibleValue].filter(Boolean);

  fields.forEach((field) => {
    if (field instanceof HTMLSelectElement) {
      const option = findMatchingOption(
        field.options,
        preferredValues.flatMap((value) => expandNormalizedNeedles(normalizeText(value)))
      );

      if (!option) {
        return;
      }

      field.focus();
      setNativeSelectValue(field, option.value);
      Array.from(field.options).forEach((candidate) => {
        candidate.selected = candidate === option;
      });
      dispatchEvents(field, ["input", "change", "blur"]);
      return;
    }

    field.focus();
    setTextControlValue(field, committedValue || visibleValue);
    dispatchEvents(field, ["input", "change", "blur"]);
  });
}

function getCustomSelectionBackingFields(
  control: HTMLElement
): Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> {
  const container = resolveSelectionFieldContainer(control);

  if (!container) {
    return [];
  }

  return dedupeElements(
    Array.from(
      container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input, select, textarea"
      )
    ).filter(
      (field) =>
        field !== control &&
        field.isConnected &&
        isPotentialSelectionBackingField(field)
    )
  );
}

function resolveSelectionFieldContainer(control: HTMLElement): HTMLElement | null {
  return (
    control.closest(
      [
        "[data-question-id]",
        "[data-testid*='field']",
        "[data-testid*='input']",
        "[data-testid*='select']",
        "[data-automation-id='formField']",
        ".select-wrapper",
        ".field",
        ".question",
        ".form-field",
        "label"
      ].join(", ")
    ) ??
    control.parentElement
  );
}

function isPotentialSelectionBackingField(
  field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): boolean {
  if (field instanceof HTMLSelectElement) {
    return true;
  }

  if (field instanceof HTMLTextAreaElement) {
    return field.hasAttribute("hidden") || field.getAttribute("aria-hidden") === "true";
  }

  const type = field.type.toLowerCase();

  if (["radio", "checkbox", "file", "button", "submit", "reset"].includes(type)) {
    return false;
  }

  return (
    type === "hidden" ||
    field.hasAttribute("hidden") ||
    field.getAttribute("aria-hidden") === "true" ||
    field.readOnly ||
    field.tabIndex < 0
  );
}

function dispatchPointerLikeEvent(element: HTMLElement, type: string): void {
  if (typeof PointerEvent === "undefined") {
    return;
  }

  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true
    })
  );
}

function fillFileInputControl(
  element: HTMLInputElement,
  files: File[]
): boolean {
  const transfer = createSyntheticDataTransfer(files);
  const nextFiles = transfer?.files ?? createSyntheticFileList(files);

  if (!nextFiles || files.length === 0) {
    return false;
  }

  element.focus();

  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "files"
    );

    if (descriptor?.set) {
      descriptor.set.call(element, nextFiles);
    } else {
      element.files = nextFiles;
    }
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

  dispatchFileUploadEvents(element, transfer);
  dispatchEvents(element, ["input", "change", "blur"]);
  highlightFilledElement(element);
  return (element.files?.length ?? 0) > 0;
}

function createSyntheticDataTransfer(files: File[]): DataTransfer | null {
  if (typeof DataTransfer === "undefined") {
    return null;
  }

  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  return transfer;
}

function createSyntheticFileList(files: File[]): FileList | null {
  const transfer = createSyntheticDataTransfer(files);

  if (transfer) {
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

function dispatchFileUploadEvents(
  element: HTMLInputElement,
  transfer: DataTransfer | null
): void {
  const targets = dedupeElements([
    element,
    ...(getFileUploadEventTargets(element) as HTMLElement[])
  ]);

  targets.forEach((target) => {
    if (typeof DragEvent !== "undefined" && transfer) {
      target.dispatchEvent(
        new DragEvent("dragenter", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer
        })
      );
      target.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer
        })
      );
      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer
        })
      );
      return;
    }

    if (transfer) {
      const dropEvent = new Event("drop", {
        bubbles: true,
        cancelable: true
      }) as Event & { dataTransfer?: DataTransfer };
      dropEvent.dataTransfer = transfer;
      target.dispatchEvent(dropEvent);
    }
  });

  void element;
}

function getFileUploadEventTargets(element: HTMLInputElement): HTMLElement[] {
  const targets: HTMLElement[] = [];
  const visibleLabel = getNativeChoiceLabelElements(element).find(isVisibleElement);

  if (visibleLabel) {
    targets.push(visibleLabel);
  }

  let current = element.parentElement;
  let depth = 0;

  while (current && depth < 5) {
    const text = normalizeText(
      cleanText(
        current.getAttribute("aria-label") ||
          current.getAttribute("data-testid") ||
          current.textContent
      )
    );

    if (
      text.includes("resume") ||
      text.includes("upload") ||
      text.includes("browse") ||
      text.includes("drop")
    ) {
      targets.push(current);
    }

    current = current.parentElement;
    depth += 1;
  }

  const scope = element.closest("form") ?? document.body;

  if (scope) {
    targets.push(
      ...Array.from(
        scope.querySelectorAll<HTMLElement>(
          [
            "label",
            "button",
            "[role='button']",
            "[data-testid]",
            "[data-qa]",
            "[data-automation-id]",
            "[aria-label]",
            "[class]"
          ].join(", ")
        )
      )
        .filter(
          (target) =>
            target !== element &&
            isVisibleElement(target) &&
            looksLikeResumeUploadText(getElementDescriptorText(target))
        )
        .slice(0, 8)
    );
  }

  return dedupeElements(targets);
}

function findResumeUploadInput(group: CandidateGroup): HTMLInputElement | null {
  const currentElements = resolveCurrentGroupElements(group);
  const inGroup = currentElements.filter(isFileInput);

  if (inGroup.length > 0) {
    const resumeLikeInGroup = inGroup.filter((input) =>
      isLikelyResumeUploadInput(input, group.candidate)
    );

    return chooseBestResumeUploadInput(
      resumeLikeInGroup.length > 0 ? resumeLikeInGroup : inGroup,
      group.candidate
    );
  }

  const allFileInputs = queryAllDocuments<HTMLInputElement>("input[type='file']");
  const resumeLikeInputs = allFileInputs.filter((input) =>
    isLikelyResumeUploadInput(input, group.candidate)
  );

  if (resumeLikeInputs.length > 0) {
    return chooseBestResumeUploadInput(resumeLikeInputs, group.candidate);
  }

  if (shouldUseSingleResumeFileInputFallback(allFileInputs, group.candidate)) {
    return chooseBestResumeUploadInput(allFileInputs, group.candidate);
  }

  return null;
}

function chooseBestResumeUploadInput(
  inputs: HTMLInputElement[],
  candidate: FieldScanCandidate
): HTMLInputElement | null {
  if (inputs.length === 0) {
    return null;
  }

  const scored = inputs.map((input) => {
    const inputCandidate = buildFileUploadCandidate(input, candidate);
    const accept = normalizeText(input.accept);
    const text = normalizeText(
      [
        inputCandidate.label,
        inputCandidate.name,
        inputCandidate.elementId,
        inputCandidate.placeholder,
        inputCandidate.ariaLabel,
        inputCandidate.nearbyText,
        inputCandidate.sectionHeading,
        inputCandidate.selectorHint,
        inputCandidate.autocomplete,
        input.getAttribute("data-testid"),
        input.getAttribute("data-qa"),
        input.getAttribute("data-automation-id")
      ].join(" ")
    );

    let score = 0;
    if (hasResumeUploadSignal(text)) {
      score += 6;
    }
    if (hasUploadInteractionSignal(text)) {
      score += 2;
    }
    if (accept.includes("pdf") || accept.includes("doc")) {
      score += 1;
    }
    if (looksLikeResumeUpload(candidate)) {
      score += 2;
    }
    if (hasCoverLetterSignal(text)) {
      score -= 8;
    }
    if (input.files?.length) {
      score -= 3;
    }

    return { input, score };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.input ?? null;
}

function buildFileUploadCandidate(
  input: HTMLInputElement,
  fallback: FieldScanCandidate
): FieldScanCandidate {
  return {
    ...fallback,
    fieldId: input.id ? `input:${input.id}` : fallback.fieldId,
    selectorHint: buildSelectorHint(input, 0),
    label: extractFieldLabel(input),
    inputType: detectFieldInputType(input),
    name: getFieldSemanticName(input),
    elementId: getFieldSemanticId(input),
    placeholder: getFieldPlaceholder(input),
    ariaLabel: input.getAttribute("aria-label")?.trim() ?? "",
    autocomplete: input.getAttribute("autocomplete")?.trim() ?? "",
    sectionHeading: extractSectionHeading(input),
    nearbyText: extractNearbyText(input),
    optionLabels: [],
    adapterSignals: []
  };
}

function isLikelyResumeUploadInput(
  input: HTMLInputElement,
  fallback: FieldScanCandidate
): boolean {
  const inputCandidate = buildFileUploadCandidate(input, fallback);

  return (
    looksLikeResumeUpload(inputCandidate) ||
    looksLikeResumeUpload(fallback) ||
    getFileUploadEventTargets(input).some((target) =>
      looksLikeResumeUploadText(getElementDescriptorText(target))
    )
  );
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

  return looksLikeResumeUploadText(searchable);
}

function looksLikeResumeUploadText(searchable: string): boolean {
  const normalized = normalizeText(cleanText(searchable));

  if (!normalized) {
    return false;
  }

  return hasResumeUploadSignal(normalized) && !hasCoverLetterSignal(normalized);
}

function hasResumeUploadSignal(searchable: string): boolean {
  if (!searchable) {
    return false;
  }

  return (
    searchable.includes("resume") ||
    searchable.includes("curriculum vitae") ||
    /\bcv\b/.test(searchable)
  );
}

function hasCoverLetterSignal(searchable: string): boolean {
  return searchable.includes("cover letter") || searchable.includes("coverletter");
}

function hasUploadInteractionSignal(searchable: string): boolean {
  return (
    searchable.includes("upload") ||
    searchable.includes("attach") ||
    searchable.includes("browse") ||
    searchable.includes("choose file") ||
    searchable.includes("drop")
  );
}

function shouldUseSingleResumeFileInputFallback(
  inputs: HTMLInputElement[],
  candidate: FieldScanCandidate
): boolean {
  if (inputs.length !== 1) {
    return false;
  }

  if (looksLikeResumeUpload(candidate)) {
    return true;
  }

  const bodyText = normalizeText(cleanText(document.body?.textContent ?? ""));

  return (
    hasResumeUploadSignal(bodyText) &&
    hasUploadInteractionSignal(bodyText) &&
    !hasCoverLetterSignal(bodyText)
  );
}

function getElementDescriptorText(element: HTMLElement): string {
  return [
    element.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-qa"),
    element.getAttribute("data-automation-id"),
    element.getAttribute("class")
  ]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(" ");
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
      const normalizedTokens = [
        option.textContent,
        option.label,
        option.value
      ]
        .map((value) => normalizeText(cleanText(value ?? "")))
        .filter(Boolean);
      return normalizedTokens.some((token) => token === needle);
    });

    if (exact) {
      return exact;
    }
  }

  for (const needle of normalizedValues) {
    const partial = optionList.find((option) => {
      const normalizedTokens = [
        option.textContent,
        option.label,
        option.value
      ]
        .map((value) => normalizeText(cleanText(value ?? "")))
        .filter(Boolean);
      return normalizedTokens.some(
        (token) => doesNormalizedOptionTokenMatch(token, needle)
      );
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

function doesNormalizedOptionTokenMatch(token: string, needle: string): boolean {
  if (!token || !needle) {
    return false;
  }

  if (token === needle) {
    return true;
  }

  if (isStrictBinaryChoiceToken(token) || isStrictBinaryChoiceToken(needle)) {
    return false;
  }

  if (
    (isUnitedStatesNeedle(needle) && isUnitedStatesTerritoryToken(token)) ||
    (isUnitedStatesNeedle(token) && isUnitedStatesTerritoryToken(needle))
  ) {
    return false;
  }

  return token.includes(needle) || needle.includes(token);
}

function isStrictBinaryChoiceToken(value: string): boolean {
  return ["yes", "no", "true", "false", "y", "n", "unknown"].includes(value);
}

function isUnitedStatesNeedle(value: string): boolean {
  return [
    "us",
    "usa",
    "u s",
    "united states",
    "united states of america"
  ].includes(value);
}

function isUnitedStatesTerritoryToken(value: string): boolean {
  return (
    value.includes("united states minor outlying islands") ||
    value.includes("u s minor outlying islands") ||
    value.includes("us minor outlying islands") ||
    value.includes("united states virgin islands")
  );
}

function normalizedNeedles(resolvedValue: ResolvedProfileValue): string[] {
  if (Array.isArray(resolvedValue.raw)) {
    return dedupeStrings(
      resolvedValue.raw.flatMap((value) => expandNormalizedNeedles(normalizeText(value)))
    );
  }

  const rawValue = resolvedValue.raw ?? "";
  return expandNormalizedNeedles(normalizeText(rawValue));
}

function expandNormalizedNeedles(primaryNeedle: string): string[] {
  const needles = [primaryNeedle].filter(Boolean);

  if (primaryNeedle === "no") {
    needles.push("false");
  } else if (primaryNeedle === "yes") {
    needles.push("true");
  }

  if (
    primaryNeedle === "prefer not to self identify" ||
    primaryNeedle === "prefer not to say" ||
    primaryNeedle === "prefer not to answer" ||
    primaryNeedle === "declined to state" ||
    primaryNeedle === "decline to state"
  ) {
    needles.push(
      "prefer not to self identify",
      "prefer not to say",
      "prefer not to answer",
      "declined to state",
      "decline to state",
      "i do not wish to self identify",
      "i dont wish to self identify",
      "do not wish to self identify",
      "decline to self identify",
      "choose not to disclose",
      "decline to answer"
    );
  }

  if (primaryNeedle === "prefer not to self-identify") {
    needles.push("prefer not to self identify");
  }

  if (
    primaryNeedle === "i am not a veteran" ||
    primaryNeedle === "not a veteran" ||
    primaryNeedle === "not protected veteran"
  ) {
    needles.push(
      "i am not a veteran",
      "not a veteran",
      "i am not a protected veteran",
      "not a protected veteran",
      "i do not identify as a protected veteran",
      "i dont identify as a protected veteran",
      "no veteran status"
    );
  }

  return dedupeStrings(needles);
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
  const fields = queryAllDocuments<HTMLElement>(
    [
      "input",
      "textarea",
      "select",
      "[role='textbox']",
      "[role='combobox']",
      "[role='listbox']",
      "button[aria-haspopup='listbox']",
      "button[aria-expanded][aria-controls]",
      "[role='button'][aria-haspopup='listbox']",
      "[role='button'][aria-expanded][aria-controls]",
      "[role='radio']",
      "[role='checkbox']",
      BUTTON_CHOICE_SELECTOR,
      "[contenteditable='true']",
      "[contenteditable='plaintext-only']"
    ].join(", ")
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

  if (!isVisibleField(field) && !isHiddenButScannableChoiceField(field)) {
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

function isHiddenButScannableChoiceField(field: FormControl): boolean {
  if (!isNativeChoiceControl(field)) {
    return false;
  }

  const labelElements = getNativeChoiceLabelElements(field);

  if (labelElements.some(isVisibleElement)) {
    return true;
  }

  const container = resolveChoiceGroupContainer(field);
  return Boolean(container && isVisibleElement(container));
}

function isVisibleElement(element: HTMLElement): boolean {
  if (element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const hiddenByContainer = Boolean(
    element.closest("[hidden], [aria-hidden='true']")
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

  return Boolean(cleanText(element.textContent || "")) || element.isConnected;
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
  const name = field.getAttribute("name");
  const stableId =
    field.id ||
    field.getAttribute("data-qa") ||
    field.getAttribute("data-testid") ||
    (isGenericFieldName(name) ? "" : name);

  return stableId?.trim()
    ? `${field.tagName.toLowerCase()}:${stableId.trim()}`
    : `${field.tagName.toLowerCase()}:${index}`;
}

function buildSelectorHint(field: FormControl, index: number): string {
  if (field.id) {
    return `#${field.id}`;
  }

  const name = field.getAttribute("name");

  if (name && !isGenericFieldName(name)) {
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
    resolveAriaReferenceText(field, "aria-describedby"),
    field.id
      ? queryFirstDocument<HTMLElement>(`label[for="${escapeAttributeValue(field.id)}"]`)
          ?.textContent
      : "",
    getElementLabelText(field),
    getNearbyLabelText(field),
    field.closest("label")?.textContent,
    getSemanticAttributeText(field),
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

function getNearbyLabelText(field: FormControl): string {
  const candidates: string[] = [];
  const previous = field.previousElementSibling;
  const parent = field.parentElement;

  if (previous) {
    candidates.push(previous.textContent ?? "");
  }

  if (parent) {
    const labelledSibling = Array.from(
      parent.querySelectorAll<HTMLElement>(
        ".label, .field-label, [data-label], [data-testid*='label'], [class*='label']"
      )
    ).find((element) => element !== field && !element.contains(field));

    candidates.push(labelledSibling?.textContent ?? "");
  }

  return candidates.map(cleanText).find(Boolean) ?? "";
}

function getFieldSemanticName(field: Element): string {
  return getFirstAttributeValue(field, [
    "name",
    "data-name",
    "data-field",
    "data-testid",
    "data-test-id",
    "data-qa",
    "data-automation-id",
    "formcontrolname",
    "ng-reflect-name"
  ]);
}

function getFieldSemanticId(field: Element): string {
  return getFirstAttributeValue(field, [
    "id",
    "data-testid",
    "data-test-id",
    "data-qa",
    "data-automation-id"
  ]);
}

function getSemanticAttributeText(field: Element): string {
  return [
    "data-name",
    "data-field",
    "data-testid",
    "data-test-id",
    "data-qa",
    "data-automation-id",
    "formcontrolname",
    "ng-reflect-name"
  ]
    .map((attribute) => field.getAttribute(attribute)?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

function getFirstAttributeValue(field: Element, attributes: string[]): string {
  for (const attribute of attributes) {
    const value = field.getAttribute(attribute)?.trim();

    if (value) {
      return value;
    }
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

function extractBroaderFieldContext(field: HTMLElement): string {
  const container =
    field.closest("fieldset, section, article, form, [role='group']") ??
    field.parentElement;
  const text = cleanText(container?.textContent);

  if (!text) {
    return "";
  }

  return text.length > 320 ? `${text.slice(0, 317)}...` : text;
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
    return queryAllDocuments<HTMLInputElement>("input")
      .filter(
        (input) =>
          input.type === field.type &&
          input.name === field.name &&
          (isVisibleField(input) || isHiddenButScannableChoiceField(input))
      )
      .map((input) =>
        cleanText(getChoiceControlLabel(input))
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
  const selectionRole = getSelectionControlRole(field);

  if (selectionRole) {
    return selectionRole;
  }

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
  const inferredChoiceKind = getInferredChoiceKind(field);

  if (inferredChoiceKind) {
    return inferredChoiceKind;
  }

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
    field.getAttribute("aria-placeholder")?.trim() ??
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
    role === "checkbox" ||
    Boolean(getSelectionControlRole(field)) ||
    isButtonChoiceControl(field)
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
    !(field instanceof HTMLSelectElement) &&
    Boolean(getSelectionControlRole(field))
  );
}

function isCustomChoiceControl(field: HTMLElement): field is CustomFormControl {
  return (
    field instanceof HTMLElement &&
    !(field instanceof HTMLInputElement) &&
    !(field instanceof HTMLTextAreaElement) &&
    !(field instanceof HTMLSelectElement) &&
    Boolean(getInferredChoiceKind(field))
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

function getSelectionControlRole(field: Element | null): "combobox" | "listbox" | null {
  if (!(field instanceof HTMLElement) || field instanceof HTMLSelectElement) {
    return null;
  }

  const normalizedRole = getNormalizedRole(field);

  if (normalizedRole === "combobox" || normalizedRole === "listbox") {
    return normalizedRole;
  }

  const popupType = field.getAttribute("aria-haspopup")?.trim().toLowerCase();

  if (popupType === "listbox") {
    return "combobox";
  }

  if (
    field.hasAttribute("aria-expanded") &&
    (field.hasAttribute("aria-controls") ||
      popupType === "menu" ||
      looksLikeSelectionTrigger(field))
  ) {
    return "combobox";
  }

  if (
    field instanceof HTMLInputElement &&
    (field.hasAttribute("aria-expanded") ||
      field.hasAttribute("aria-controls") ||
      normalizeText(getFieldPlaceholder(field)) === "select" ||
      normalizeText(field.value) === "select")
  ) {
    return "combobox";
  }

  return null;
}

function looksLikeSelectionTrigger(field: HTMLElement): boolean {
  const searchable = normalizeText(
    [
      field.getAttribute("data-testid"),
      field.getAttribute("data-qa"),
      field.getAttribute("data-automation-id"),
      field.getAttribute("class"),
      field.getAttribute("aria-label"),
      field.getAttribute("title"),
      field.textContent
    ].join(" ")
  );

  return (
    searchable.includes("select") ||
    searchable.includes("dropdown") ||
    searchable.includes("combobox") ||
    searchable.includes("autocomplete") ||
    searchable.includes("listbox")
  );
}

function resolveCurrentGroupElements(group: CandidateGroup): FormControl[] {
  const resolved = [
    ...queryElementsFromSelectorHint(group.candidate.selectorHint),
    ...queryElementsById(group.candidate.elementId),
    ...(isGenericFieldName(group.candidate.name)
      ? []
      : queryElementsByName(group.candidate.name)),
    ...group.elements.filter((element) => element.isConnected)
  ];

  return dedupeElements(resolved.filter(isFormControlElement));
}

function resolvePrimaryElement(group: CandidateGroup): FormControl | null {
  return resolveCurrentGroupElements(group)[0] ?? null;
}

function queryAllDocuments<T extends Element>(selector: string): T[] {
  try {
    return dedupeElements(
      collectSearchRoots().flatMap((root) => Array.from(root.querySelectorAll<T>(selector)))
    );
  } catch {
    return [];
  }
}

function queryFirstDocument<T extends Element>(selector: string): T | null {
  return queryAllDocuments<T>(selector)[0] ?? null;
}

function collectSearchRoots(): SearchRoot[] {
  const roots: SearchRoot[] = [];
  const visited = new Set<Node>();

  const visitRoot = (root: SearchRoot) => {
    if (visited.has(root)) {
      return;
    }

    visited.add(root);
    roots.push(root);

    Array.from(root.querySelectorAll<HTMLElement>("*")).forEach((element) => {
      if (element.shadowRoot) {
        visitRoot(element.shadowRoot);
      }

      if (element instanceof HTMLIFrameElement) {
        const frameDocument = resolveAccessibleFrameDocument(element);

        if (frameDocument) {
          visitRoot(frameDocument);
        }
      }
    });
  };

  visitRoot(document);
  return roots;
}

function resolveAccessibleFrameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument && frame.contentDocument.documentElement
      ? frame.contentDocument
      : null;
  } catch {
    return null;
  }
}

function queryElementsFromSelectorHint(selectorHint: string): HTMLElement[] {
  if (!selectorHint || selectorHint.includes(":index(")) {
    return [];
  }

  try {
    return queryAllDocuments<HTMLElement>(selectorHint);
  } catch {
    return [];
  }
}

function queryElementsById(elementId: string): HTMLElement[] {
  if (!elementId) {
    return [];
  }

  return queryAllDocuments<HTMLElement>(`[id="${escapeAttributeValue(elementId)}"]`);
}

function queryElementsByName(name: string): HTMLElement[] {
  if (!name) {
    return [];
  }

  return queryAllDocuments<HTMLElement>(`[name="${escapeAttributeValue(name)}"]`);
}

function isGenericFieldName(value: string | null | undefined): boolean {
  const normalized = normalizeText(cleanText(value));

  if (!normalized) {
    return false;
  }

  return (
    [
      "name",
      "value",
      "answer",
      "answers",
      "response",
      "responses",
      "field",
      "fields",
      "input",
      "text",
      "question"
    ].includes(normalized) || /^answers? \d+$/.test(normalized)
  );
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function waitForFieldSettle(field: HTMLElement, delayMs = FILL_SETTLE_DELAY_MS): Promise<void> {
  const root =
    field.closest("form, fieldset, section, article, [role='group']") ??
    field.ownerDocument.body ??
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
  const localContainers: HTMLElement[] = [];
  const associatedByReference = [
    ...resolveAriaReferenceElements(field, "aria-controls"),
    ...resolveAriaReferenceElements(field, "aria-owns")
  ].filter((element): element is HTMLElement => element instanceof HTMLElement);

  if (getNormalizedRole(field) === "listbox") {
    localContainers.push(field);
  }

  const nearbyListbox = field.closest(
    "[role='combobox'], [role='listbox'], fieldset, section, article, form, div"
  )?.querySelector<HTMLElement>("[role='listbox']");

  if (nearbyListbox) {
    localContainers.push(nearbyListbox);
  }

  localContainers.push(...associatedByReference);

  const localOptions = collectOptionElementsFromContainers(localContainers);

  if (localOptions.length > 0 || field.getAttribute("aria-expanded") !== "true") {
    return localOptions;
  }

  const expandedPortalContainers = queryAllDocuments<HTMLElement>(
    [
      "[role='listbox']",
      "[role='menu']",
      "[role='dialog'] [role='listbox']",
      "[data-testid*='listbox']",
      "[data-testid*='dropdown']",
      "[data-testid*='menu']",
      "[id*='listbox']",
      "[id*='menu']",
      "[class*='listbox']",
      "[class*='dropdown']",
      "[class*='menu']",
      "[class*='select-menu']",
      "[class*='popover']",
      "[class*='popper']"
    ].join(", ")
  ).filter(isVisibleElement);

  return collectOptionElementsFromContainers(expandedPortalContainers);
}

function collectOptionElementsFromContainers(containers: HTMLElement[]): HTMLElement[] {
  return dedupeElements(
    containers
      .flatMap((container) => getPotentialOptionElements(container))
      .filter((option) => option.isConnected && !option.closest("[hidden], [aria-hidden='true']"))
  );
}

function getPotentialOptionElements(container: HTMLElement): HTMLElement[] {
  const explicitOptions = Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        "[role='option']",
        "[role='radio']",
        "[role='menuitem']",
        "[aria-selected]",
        "[aria-checked]",
        "[data-value]",
        "[data-option]",
        "[data-option-index]",
        "[data-testid*='option']",
        "[class*='option']",
        "button",
        "li"
      ].join(", ")
    )
  );
  const directChildren = Array.from(container.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && Boolean(cleanText(child.textContent))
  );
  const candidates = dedupeElements([...explicitOptions, ...directChildren]);

  return candidates.filter(
    (element) =>
      element !== container &&
      isVisibleElement(element) &&
      !containsPreferredOptionCandidate(element, candidates)
  );
}

function containsPreferredOptionCandidate(
  element: HTMLElement,
  candidates: HTMLElement[]
): boolean {
  return candidates.some(
    (candidate) =>
      candidate !== element &&
      element.contains(candidate) &&
      isPreferredOptionCandidate(candidate)
  );
}

function isPreferredOptionCandidate(element: HTMLElement): boolean {
  return (
    element.matches("button, [role='option'], [role='radio'], [role='menuitem']") ||
    element.hasAttribute("data-value") ||
    element.hasAttribute("data-option")
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
    .flatMap((id) => queryElementsById(id))
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
