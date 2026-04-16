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

type FormControl = AdapterFormControl;

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

const FILL_HIGHLIGHT_STYLE_ID = "autojobapp-fill-style";
const FILL_HIGHLIGHT_CLASS = "autojobapp-fill-flash";
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

  const results = fieldMatches.map((match) =>
    fillMatchedGroup(
      match,
      groupByFieldId.get(match.fieldId),
      profile,
      repeatEntryIndexByFieldId.get(match.fieldId) ?? 0,
      settings.fillMode,
      aiSuggestionByFieldId.get(match.fieldId)
    )
  );

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
  const elementTag = field.tagName.toLowerCase() as FieldElementTag;

  return {
    fieldId: buildFieldId(field, index),
    selectorHint: buildSelectorHint(field, index),
    label: adapter.getLabel(field) || extractFieldLabel(field),
    elementTag,
    inputType:
      field instanceof HTMLInputElement
        ? field.type.toLowerCase() || "text"
        : elementTag === "textarea"
          ? "textarea"
          : "select",
    name: field.getAttribute("name")?.trim() ?? "",
    elementId: field.id.trim(),
    placeholder:
      field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
        ? field.placeholder.trim()
        : "",
    ariaLabel: field.getAttribute("aria-label")?.trim() ?? "",
    autocomplete: field.getAttribute("autocomplete")?.trim() ?? "",
    sectionHeading: adapter.getSectionHeading(field) || extractSectionHeading(field),
    nearbyText: adapter.getNearbyText(field) || extractNearbyText(field),
    optionLabels: dedupeStrings([
      ...adapter.getOptionLabels(field),
      ...extractOptionLabels(field)
    ]),
    adapterSignals: adapter.getSignals(field),
    required:
      field.required || field.getAttribute("aria-required")?.trim() === "true"
  };
}

function fillMatchedGroup(
  match: DetectedFieldMatch,
  group: CandidateGroup | undefined,
  profile: ApplicantProfile,
  repeatEntryIndex: number,
  fillMode: FillMode,
  aiSuggestion?: AiFieldSuggestion
): FilledFieldResult {
  if (!group) {
    return buildResult(
      match,
      "error",
      "",
      "Field group was not found during fill."
    );
  }

  const profileSuggestionAllowed = shouldFillConfidence(match.confidence, fillMode);
  const aiSuggestionAllowed = aiSuggestion
    ? shouldFillConfidence(aiSuggestion.confidence, fillMode)
    : false;
  const profileResolvedValue =
    match.matchedKey
      ? resolveProfileFieldValue(profile, match.matchedKey, repeatEntryIndex)
      : null;
  const aiResolvedValue = aiSuggestion
    ? createAiResolvedValue(aiSuggestion)
    : null;
  const fillTarget =
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
      : aiSuggestionAllowed &&
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

  if (!fillTarget) {
    if (!profileSuggestionAllowed && !aiSuggestionAllowed) {
      return buildResult(
        match,
        "skipped",
        aiSuggestion?.valuePreview || match.matchedValuePreview,
        getFillSkipMessage(fillMode)
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

  if (group.elements.some(isFileInput)) {
    return buildResult(
      match,
      "unsupported",
      fillTarget.resolvedValue.preview,
      "Browser security prevents automatic file uploads for resume and cover letter inputs.",
      {
        matchedKey: fillTarget.matchedKey,
        confidence: fillTarget.confidence,
        fillSource: fillTarget.source
      }
    );
  }

  if (isAlreadyFilled(group, match, fillTarget.resolvedValue)) {
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
      const changed = fillChoiceGroup(group, fillTarget.resolvedValue);

      return buildResult(
        match,
        changed ? "filled" : "skipped",
        fillTarget.resolvedValue.preview,
        changed
          ? fillTarget.source === "ai"
            ? "Filled a radio or checkbox choice using an AI suggestion."
            : "Filled a radio or checkbox choice."
          : "A matching option was not found for this choice field."
        ,
        {
          matchedKey: fillTarget.matchedKey,
          confidence: fillTarget.confidence,
          fillSource: fillTarget.source
        }
      );
    }

    const primaryElement = group.elements[0];

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
      const changed = fillSelectControl(primaryElement, fillTarget.resolvedValue);

      return buildResult(
        match,
        changed ? "filled" : "skipped",
        fillTarget.resolvedValue.preview,
        changed
          ? fillTarget.source === "ai"
            ? "Filled a select control using an AI suggestion."
            : "Filled a select control."
          : "No compatible select option was found."
        ,
        {
          matchedKey: fillTarget.matchedKey,
          confidence: fillTarget.confidence,
          fillSource: fillTarget.source
        }
      );
    }

    const changed = fillTextControl(primaryElement, fillTarget.resolvedValue);

    return buildResult(
      match,
      changed ? "filled" : "skipped",
      fillTarget.resolvedValue.preview,
      changed
        ? fillTarget.source === "ai"
          ? "Filled a text-based control using an AI suggestion."
          : "Filled a text-based control."
        : "The text control already matched or could not be updated."
      ,
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
  match: DetectedFieldMatch,
  resolvedValue: ResolvedProfileValue
): boolean {
  if (isChoiceGroup(group)) {
    return group.elements.some(
      (element) => element instanceof HTMLInputElement && element.checked
    );
  }

  const primaryElement = group.elements[0];

  if (!primaryElement) {
    return false;
  }

  if (primaryElement instanceof HTMLSelectElement) {
    const current = cleanText(
      primaryElement.selectedOptions[0]?.textContent || primaryElement.value
    );
    const target = normalizedNeedles(resolvedValue)[0];

    return Boolean(current) && (!target || normalizeText(current) === target);
  }

  const currentValue = cleanText(primaryElement.value);
  const targetValue = stringifyResolvedValue(resolvedValue);

  return Boolean(currentValue) && normalizeText(currentValue) === normalizeText(targetValue);
}

function fillTextControl(
  element: HTMLInputElement | HTMLTextAreaElement,
  resolvedValue: ResolvedProfileValue
): boolean {
  const targetValue = stringifyResolvedValue(resolvedValue);

  if (!targetValue) {
    return false;
  }

  if (normalizeText(element.value) === normalizeText(targetValue)) {
    return false;
  }

  element.focus();
  setNativeValue(element, targetValue);
  dispatchEvents(element, ["input", "change", "blur"]);
  highlightFilledElement(element);
  return true;
}

function fillSelectControl(
  element: HTMLSelectElement,
  resolvedValue: ResolvedProfileValue
): boolean {
  const option = findMatchingOption(element.options, normalizedNeedles(resolvedValue));

  if (!option) {
    return false;
  }

  if (element.value === option.value) {
    return false;
  }

  element.focus();
  setNativeSelectValue(element, option.value);
  dispatchEvents(element, ["input", "change", "blur"]);
  highlightFilledElement(element);
  return true;
}

function fillChoiceGroup(
  group: CandidateGroup,
  resolvedValue: ResolvedProfileValue
): boolean {
  const options = group.elements.filter(
    (element): element is HTMLInputElement => element instanceof HTMLInputElement
  );
  const normalizedValues = normalizedNeedles(resolvedValue);

  if (options.length === 0 || normalizedValues.length === 0) {
    return false;
  }

  const matches = options.filter((element) => {
    const label = cleanText(
      element.labels?.[0]?.textContent || element.closest("label")?.textContent
    );
    const tokens = [label, element.value, element.getAttribute("aria-label") ?? ""]
      .map(normalizeText)
      .filter(Boolean);

    return normalizedValues.some((needle) =>
      tokens.some((token) => token === needle || token.includes(needle))
    );
  });

  if (matches.length === 0) {
    return false;
  }

  let changed = false;

  matches.forEach((element, index) => {
    if (element.type === "radio" && index > 0) {
      return;
    }

    if (!element.checked) {
      element.focus();
      setNativeChecked(element, true);
      dispatchEvents(element, ["input", "change", "blur"]);
      highlightFilledElement(element);
      changed = true;
    }
  });

  return changed;
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
  return Array.from(
    document.querySelectorAll<FormControl>("input, textarea, select")
  );
}

function isChoiceGroup(group: CandidateGroup): boolean {
  return group.elements.some(
    (element) =>
      element instanceof HTMLInputElement &&
      (element.type === "radio" || element.type === "checkbox")
  );
}

function isFileInput(element: FormControl): boolean {
  return element instanceof HTMLInputElement && element.type === "file";
}

function isScannableFieldElement(field: FormControl): boolean {
  if (!isVisibleField(field)) {
    return false;
  }

  if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) {
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

  return !field.disabled;
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
    "color"
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

  return candidate.fieldId || `field:${index}`;
}

function buildFieldId(field: FormControl, index: number): string {
  const stableId =
    field.id || field.getAttribute("name") || field.getAttribute("data-qa");

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

  return `${field.tagName.toLowerCase()}:index(${index})`;
}

function extractFieldLabel(field: FormControl): string {
  const candidates = [
    field.labels?.[0]?.textContent,
    field.closest("label")?.textContent,
    field.getAttribute("aria-label"),
    field.getAttribute("placeholder"),
    field.getAttribute("name"),
    field.getAttribute("id")
  ];

  const label = candidates.map(cleanText).find((value) => Boolean(value));

  return label ?? "";
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

  if (
    field instanceof HTMLInputElement &&
    (field.type === "radio" || field.type === "checkbox") &&
    field.name
  ) {
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
