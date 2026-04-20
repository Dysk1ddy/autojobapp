import {
  ApplicantProfile,
  DocumentReference,
  ExtensionSettings,
  IndeedModeStatus
} from "../shared/core";

type IndeedApplyOutcome = "applied" | "skipped" | "failed";

interface IndeedJobCard {
  id: string;
  element: HTMLElement;
  link: HTMLAnchorElement;
  title: string;
  href: string;
}

interface IndeedApplyResult {
  outcome: IndeedApplyOutcome;
  message: string;
  title: string;
}

interface ResumeReadyResult {
  ok: boolean;
  message: string;
}

interface IndeedModeController {
  active: boolean;
  stopRequested: boolean;
  attemptedJobIds: Set<string>;
  runPromise: Promise<IndeedModeStatus> | null;
  status: IndeedModeStatus;
}

interface IndeedRunOptions {
  controller?: IndeedModeController;
  maxIdleRounds?: number;
  actionDelayMs?: number;
  surfaceTimeoutMs?: number;
}

declare global {
  interface Window {
    __AUTO_JOB_APP_INDEED_MODE__?: IndeedModeController;
  }
}

const INDEED_OVERLAY_ID = "autojobapp-indeed-mode-overlay";
const ACTION_CONTROL_SELECTOR = [
  "button",
  "[role='button']",
  "a[href]",
  "input[type='button']",
  "input[type='submit']"
].join(", ");
const APPLICATION_SURFACE_SELECTOR = [
  "#ia-container",
  "[id*='ia-container']",
  "[data-testid*='indeed-apply']",
  "[data-testid*='ia-']",
  "[role='dialog']",
  "[aria-modal='true']",
  "[class*='modal']",
  "[class*='Modal']",
  ".modal"
].join(", ");
const INDEED_JOB_LINK_SELECTOR = [
  "a[href*='viewjob']",
  "a[href*='jk=']",
  "a[href*='vjk=']",
  "a[data-jk]",
  "[data-jk] a[href]"
].join(", ");
const INDEED_JOB_CONTAINER_SELECTOR = [
  "[data-jk]",
  ".job_seen_beacon",
  "li",
  "article",
  "[role='listitem']",
  "[data-testid*='job']",
  "[class*='job']",
  "[class*='Job']"
].join(", ");
const DOCUMENT_OPTION_SELECTOR = [
  "[role='option']",
  "[role='menuitem']",
  "[aria-selected]",
  "[data-value]",
  "button",
  "li"
].join(", ");
const DEFAULT_ACTION_DELAY_MS = 650;
const DEFAULT_SURFACE_TIMEOUT_MS = 4500;
const DEFAULT_MAX_IDLE_ROUNDS = 3;

export async function toggleIndeedMode(
  profile: ApplicantProfile,
  settings: ExtensionSettings
): Promise<IndeedModeStatus> {
  const controller = getIndeedController();

  if (controller.active) {
    controller.stopRequested = true;
    controller.status = {
      ...controller.status,
      active: false,
      message: "Indeed mode is stopping after the current job."
    };
    renderIndeedOverlay(controller.status);
    return controller.status;
  }

  if (!isIndeedHostname(window.location.hostname)) {
    controller.status = {
      ...createInitialStatus(),
      active: false,
      message: "Indeed mode only runs on indeed.com pages."
    };
    renderIndeedOverlay(controller.status);
    return controller.status;
  }

  controller.active = true;
  controller.stopRequested = false;
  controller.attemptedJobIds.clear();
  controller.status = {
    ...createInitialStatus(),
    active: true,
    message: "Indeed mode started. Press the shortcut again to stop."
  };
  renderIndeedOverlay(controller.status);

  controller.runPromise = runIndeedMode(profile, settings, { controller }).finally(
    () => {
      controller.active = false;
      controller.stopRequested = false;
      renderIndeedOverlay(controller.status);
    }
  );

  void controller.runPromise.catch((error) => {
    controller.status = {
      ...controller.status,
      active: false,
      failed: controller.status.failed + 1,
      message: `Indeed mode stopped: ${toErrorMessage(error)}`
    };
    renderIndeedOverlay(controller.status);
  });

  return controller.status;
}

export async function runIndeedMode(
  profile: ApplicantProfile,
  _settings: ExtensionSettings,
  options: IndeedRunOptions = {}
): Promise<IndeedModeStatus> {
  const controller = options.controller ?? createIndeedController();
  const maxIdleRounds = options.maxIdleRounds ?? DEFAULT_MAX_IDLE_ROUNDS;
  const actionDelayMs = options.actionDelayMs ?? DEFAULT_ACTION_DELAY_MS;
  const surfaceTimeoutMs =
    options.surfaceTimeoutMs ?? DEFAULT_SURFACE_TIMEOUT_MS;
  let idleRounds = 0;

  controller.active = true;
  controller.stopRequested = false;
  controller.status = {
    ...controller.status,
    active: true,
    message: "Scanning visible Indeed jobs..."
  };
  renderIndeedOverlay(controller.status);

  while (!controller.stopRequested) {
    const cards = collectIndeedJobCards().filter(
      (card) => !controller.attemptedJobIds.has(card.id)
    );

    if (cards.length === 0) {
      const moved = await moveToMoreIndeedJobs(actionDelayMs);

      if (!moved) {
        idleRounds += 1;
      } else {
        idleRounds = 0;
      }

      if (idleRounds >= maxIdleRounds) {
        controller.status = {
          ...controller.status,
          message: "Indeed mode finished. No more unvisited jobs were found."
        };
        break;
      }

      continue;
    }

    idleRounds = 0;

    for (const card of cards) {
      if (controller.stopRequested) {
        break;
      }

      controller.attemptedJobIds.add(card.id);
      controller.status = {
        ...controller.status,
        visited: controller.status.visited + 1,
        lastJobTitle: card.title,
        message: `Opening ${card.title || "next Indeed job"}...`
      };
      renderIndeedOverlay(controller.status);

      await activateIndeedJobCard(card, actionDelayMs);

      const result = await tryApplyToCurrentIndeedJob(profile, {
        surfaceTimeoutMs,
        actionDelayMs
      });
      controller.status = reduceIndeedStatus(controller.status, result);
      renderIndeedOverlay(controller.status);
      await delay(actionDelayMs);
    }
  }

  controller.active = false;
  controller.stopRequested = false;
  controller.status = {
    ...controller.status,
    active: false,
    message:
      controller.status.message ||
      "Indeed mode stopped. Press the shortcut to start again."
  };
  renderIndeedOverlay(controller.status);
  return controller.status;
}

export function isIndeedEasyApplyControl(control: HTMLElement): boolean {
  if (!isVisibleActionControl(control) || isDisabledControl(control)) {
    return false;
  }

  if (control instanceof HTMLAnchorElement || control.closest("a[href]")) {
    return false;
  }

  if (isInsideIndeedJobResult(control)) {
    return false;
  }

  const text = normalizeText(getActionControlText(control));

  if (!text.includes("apply")) {
    return false;
  }

  if (
    text.includes("company site") ||
    text.includes("company website") ||
    text.includes("employer site") ||
    text.includes("external") ||
    text.includes("externally") ||
    text.includes("applied") ||
    text.includes("withdraw") ||
    text.includes("save")
  ) {
    return false;
  }

  return (
    text === "apply now" ||
    text.includes("apply now") ||
    text === "easily apply" ||
    text.includes("easily apply")
  );
}

export function findIndeedEasyApplyControl(
  root: ParentNode = findIndeedJobDetailRoot() ?? document
): HTMLElement | null {
  return (
    queryAll<HTMLElement>(ACTION_CONTROL_SELECTOR, root).find(
      isIndeedEasyApplyControl
    ) ?? null
  );
}

export function isIndeedApplicationSurfaceEasy(surface: HTMLElement): boolean {
  const surfaceText = normalizeText(cleanText(surface.textContent));

  if (!surfaceText) {
    return false;
  }

  if (
    surfaceText.includes("apply on company site") ||
    surfaceText.includes("company website") ||
    surfaceText.includes("external site")
  ) {
    return false;
  }

  if (hasUnsupportedIndeedPrompt(surfaceText)) {
    return false;
  }

  if (hasAdditionalRequiredQuestions(surface)) {
    return false;
  }

  return Boolean(
    findSubmitApplicationControl(surface, { includeDisabled: true }) ||
      findContinueControl(surface)
  );
}

function getIndeedController(): IndeedModeController {
  if (!window.__AUTO_JOB_APP_INDEED_MODE__) {
    window.__AUTO_JOB_APP_INDEED_MODE__ = createIndeedController();
  }

  return window.__AUTO_JOB_APP_INDEED_MODE__;
}

function createIndeedController(): IndeedModeController {
  return {
    active: false,
    stopRequested: false,
    attemptedJobIds: new Set<string>(),
    runPromise: null,
    status: createInitialStatus()
  };
}

function createInitialStatus(): IndeedModeStatus {
  return {
    active: false,
    applied: 0,
    skipped: 0,
    failed: 0,
    visited: 0,
    message: "",
    lastJobTitle: ""
  };
}

function reduceIndeedStatus(
  status: IndeedModeStatus,
  result: IndeedApplyResult
): IndeedModeStatus {
  const nextStatus = {
    ...status,
    lastJobTitle: result.title,
    message: result.message
  };

  switch (result.outcome) {
    case "applied":
      return {
        ...nextStatus,
        applied: status.applied + 1
      };
    case "failed":
      return {
        ...nextStatus,
        failed: status.failed + 1
      };
    default:
      return {
        ...nextStatus,
        skipped: status.skipped + 1
      };
  }
}

function collectIndeedJobCards(): IndeedJobCard[] {
  const currentJobCard = findCurrentIndeedJobCard();
  const links = queryAll<HTMLAnchorElement>(INDEED_JOB_LINK_SELECTOR);
  const cards = links
    .map((link) => {
      const id = getIndeedJobIdFromLink(link);

      if (!id || !isIndeedJobNavigationLink(link)) {
        return null;
      }

      const element =
        link.closest<HTMLElement>(INDEED_JOB_CONTAINER_SELECTOR) ?? link;
      const title =
        clipText(cleanText(link.textContent), 96) ||
        clipText(cleanText(element.querySelector("h2, [role='heading']")?.textContent), 96);

      return {
        id,
        element,
        link,
        title: title || `Indeed job ${id}`,
        href: link.href
      } satisfies IndeedJobCard;
    })
    .filter((card): card is IndeedJobCard => Boolean(card))
    .filter((card) => isVisibleElement(card.element));

  return dedupeBy(
    [currentJobCard, ...cards].filter((card): card is IndeedJobCard =>
      Boolean(card)
    ),
    (card) => card.id
  );
}

function findCurrentIndeedJobCard(): IndeedJobCard | null {
  const detailRoot = findIndeedJobDetailRoot();
  const currentJobId =
    findCurrentIndeedJobId(detailRoot) ||
    (detailRoot ? createFallbackCurrentIndeedJobId(detailRoot) : "");

  if (!currentJobId || (!detailRoot && !isLikelyIndeedJobUrl(window.location.href))) {
    return null;
  }

  const title = getCurrentIndeedJobTitle();
  const href = findCurrentIndeedJobHref(detailRoot) || window.location.href;

  return {
    id: currentJobId,
    element: detailRoot ?? document.body,
    link: createSyntheticCurrentJobLink(currentJobId, href),
    title: title || `Indeed job ${currentJobId}`,
    href
  };
}

function findCurrentIndeedJobId(detailRoot: HTMLElement | null): string {
  const candidates = [
    window.location.href,
    findCurrentIndeedJobHref(detailRoot),
    document.querySelector<HTMLLinkElement>("link[rel='canonical']")?.href,
    document
      .querySelector<HTMLMetaElement>("meta[property='og:url'], meta[name='twitter:url']")
      ?.content,
    ...queryAll<HTMLAnchorElement>(INDEED_JOB_LINK_SELECTOR, detailRoot ?? document)
      .slice(0, 10)
      .map((link) => link.href || link.getAttribute("data-jk") || "")
  ];

  for (const candidate of candidates) {
    const id = extractIndeedJobId(candidate ?? "");

    if (id) {
      return id;
    }
  }

  const attrSource =
    findElementWithIndeedJobId(detailRoot ?? document.body) ??
    findElementWithIndeedJobId(document.body);
  return attrSource ? readIndeedJobIdFromElement(attrSource) : "";
}

function findCurrentIndeedJobHref(detailRoot: HTMLElement | null): string {
  const candidates = [
    window.location.href,
    document.querySelector<HTMLLinkElement>("link[rel='canonical']")?.href,
    document
      .querySelector<HTMLMetaElement>("meta[property='og:url'], meta[name='twitter:url']")
      ?.content,
    queryAll<HTMLAnchorElement>(INDEED_JOB_LINK_SELECTOR, detailRoot ?? document)
      .find((link) => getIndeedJobIdFromLink(link))
      ?.href
  ];

  return (
    candidates.find(
      (candidate): candidate is string =>
        typeof candidate === "string" &&
        candidate.length > 0 &&
        candidate !== "about:blank" &&
        isLikelyIndeedJobUrl(candidate)
    ) ?? ""
  );
}

function createFallbackCurrentIndeedJobId(detailRoot: HTMLElement): string {
  const source = [
    findCurrentIndeedJobHref(detailRoot),
    getCurrentIndeedJobTitle(),
    cleanText(detailRoot.getAttribute("aria-label") ?? "")
  ]
    .filter(Boolean)
    .join("|");

  return source ? `current-${hashString(source)}` : "";
}

function findElementWithIndeedJobId(root: ParentNode): HTMLElement | null {
  return (
    queryAll<HTMLElement>(
      [
        "[data-jk]",
        "[data-jobkey]",
        "[data-job-key]",
        "[data-indeed-apply-jobkey]",
        "[data-indeed-apply-job-key]",
        "[data-indeed-apply-jobid]",
        "[data-indeed-apply-job-id]"
      ].join(", "),
      root
    ).find((element) => Boolean(readIndeedJobIdFromElement(element))) ?? null
  );
}

function readIndeedJobIdFromElement(element: HTMLElement): string {
  const attrNames = [
    "data-jk",
    "data-jobkey",
    "data-job-key",
    "data-indeed-apply-jobkey",
    "data-indeed-apply-job-key",
    "data-indeed-apply-jobid",
    "data-indeed-apply-job-id"
  ];

  for (const attrName of attrNames) {
    const value = cleanText(element.getAttribute(attrName) ?? "");

    if (value) {
      return value;
    }
  }

  return "";
}

function isLikelyIndeedJobUrl(value: string): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value, window.location.href);
    const path = url.pathname.toLowerCase();

    return (
      isIndeedHostname(url.hostname) &&
      (extractIndeedJobId(url.href) !== "" ||
        path.includes("viewjob") ||
        path.includes("/rc/clk") ||
        path.includes("/pagead/clk") ||
        path.includes("/cmp/"))
    );
  } catch {
    return false;
  }
}

function isIndeedJobNavigationLink(link: HTMLAnchorElement): boolean {
  const id = getIndeedJobIdFromLink(link);

  if (!id || isExternalIndeedHref(link.href)) {
    return false;
  }

  const text = normalizeText(getActionControlText(link));

  if (
    text === "apply" ||
    text === "apply now" ||
    text === "easily apply" ||
    text.includes("apply on company") ||
    text === "next" ||
    text.includes("next page")
  ) {
    return false;
  }

  try {
    const url = new URL(link.href, window.location.href);
    const path = url.pathname.toLowerCase();
    return !path.includes("apply") && !path.includes("company");
  } catch {
    return false;
  }
}

function getIndeedJobIdFromLink(link: HTMLAnchorElement): string {
  return (
    extractIndeedJobId(link.href || link.getAttribute("data-jk") || "") ||
    readIndeedJobIdFromElement(link) ||
    readIndeedJobIdFromElement(
      link.closest<HTMLElement>("[data-jk], [data-jobkey], [data-job-key]") ??
        link
    )
  );
}

function createSyntheticCurrentJobLink(
  currentJobId: string,
  href: string
): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href || window.location.href;
  link.dataset.autojobappCurrentJob = "true";
  link.textContent = `Indeed job ${currentJobId}`;
  return link;
}

function extractIndeedJobId(value: string): string {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value, window.location.href);
    const jk =
      url.searchParams.get("jk") ??
      url.searchParams.get("vjk") ??
      url.searchParams.get("jobkey") ??
      url.searchParams.get("jobKey");

    if (jk) {
      return jk;
    }
  } catch {
    // Continue with the regex fallback.
  }

  const match = value.match(
    /(?:^|[?&#])(?:jk|vjk|jobkey)=([^&#\s"']+)|data-(?:jk|jobkey|job-key)=["']?([^"'\s&>]+)/i
  );
  return decodeURIComponent(match?.[1] ?? match?.[2] ?? "");
}

async function activateIndeedJobCard(
  card: IndeedJobCard,
  actionDelayMs: number
): Promise<void> {
  const currentJobId = extractIndeedJobId(window.location.href);

  if (
    card.link.dataset.autojobappCurrentJob === "true" ||
    (currentJobId && currentJobId === card.id)
  ) {
    return;
  }

  card.element.scrollIntoView({
    block: "center",
    inline: "nearest"
  });
  card.link.focus();
  clickInternalIndeedLink(card.link);
  await delay(actionDelayMs);
}

async function tryApplyToCurrentIndeedJob(
  profile: ApplicantProfile,
  options: {
    surfaceTimeoutMs: number;
    actionDelayMs: number;
  }
): Promise<IndeedApplyResult> {
  const title = getCurrentIndeedJobTitle();

  if (hasSubmittedApplicationSignal()) {
    return {
      outcome: "skipped",
      title,
      message: `${title} was already applied to.`
    };
  }

  const applyControl = findIndeedEasyApplyControl();

  if (!applyControl) {
    return {
      outcome: "skipped",
      title,
      message: `${title} was skipped because no Indeed Easy Apply button was found.`
    };
  }

  applyControl.focus();
  applyControl.click();

  let surface = await waitForApplicationSurface(options.surfaceTimeoutMs);

  if (!surface) {
    return {
      outcome: "failed",
      title,
      message: `${title} could not be submitted because the Indeed apply surface did not open.`
    };
  }

  if (!isIndeedApplicationSurfaceEasy(surface)) {
    closeApplicationSurface(surface);
    return {
      outcome: "skipped",
      title,
      message: `${title} was skipped because the application asked for more than a resume-only Indeed submit.`
    };
  }

  let resumeReady = await ensureIndeedResumeReady(
    surface,
    profile,
    options.actionDelayMs
  );

  if (!resumeReady.ok) {
    closeApplicationSurface(surface);
    return {
      outcome: "failed",
      title,
      message: `${title} could not be submitted: ${resumeReady.message}`
    };
  }

  let submitControl = findSubmitApplicationControl(surface);

  if (!submitControl) {
    const continueControl = findContinueControl(surface);

    if (continueControl) {
      continueControl.focus();
      continueControl.click();
      await delay(options.actionDelayMs);
      surface = findApplicationSurface() ?? surface;

      if (!isIndeedApplicationSurfaceEasy(surface)) {
        closeApplicationSurface(surface);
        return {
          outcome: "skipped",
          title,
          message: `${title} was skipped because a later Indeed step asked for extra information.`
        };
      }

      resumeReady = await ensureIndeedResumeReady(
        surface,
        profile,
        options.actionDelayMs
      );

      if (!resumeReady.ok) {
        closeApplicationSurface(surface);
        return {
          outcome: "failed",
          title,
          message: `${title} could not be submitted: ${resumeReady.message}`
        };
      }

      submitControl = findSubmitApplicationControl(surface);
    }
  }

  if (!submitControl || isDisabledControl(submitControl)) {
    closeApplicationSurface(surface);
    return {
      outcome: "failed",
      title,
      message: `${title} could not be submitted because the submit button was unavailable.`
    };
  }

  submitControl.focus();
  submitControl.click();

  const submitted = await waitForSubmissionConfirmation(
    surface,
    options.surfaceTimeoutMs
  );

  if (!submitted) {
    return {
      outcome: "failed",
      title,
      message: `${title} submit was clicked, but Indeed did not show a submission confirmation.`
    };
  }

  return {
    outcome: "applied",
    title,
    message: `${title} was submitted through Indeed.`
  };
}

async function ensureIndeedResumeReady(
  surface: HTMLElement,
  profile: ApplicantProfile,
  actionDelayMs: number
): Promise<ResumeReadyResult> {
  const surfaceText = normalizeText(cleanText(surface.textContent));
  const fileInputs = queryAll<HTMLInputElement>("input[type='file']", surface)
    .filter(isResumeUploadInput);
  const hasResumePrompt =
    surfaceText.includes("resume") ||
    surfaceText.includes("cv") ||
    fileInputs.length > 0;
  const initialSubmit = findSubmitApplicationControl(surface);

  if (initialSubmit && !isDisabledControl(initialSubmit)) {
    return {
      ok: true,
      message: hasResumePrompt
        ? "Indeed already has a resume selected."
        : "Indeed did not require a resume for this application."
    };
  }

  if (!hasResumePrompt) {
    return {
      ok: true,
      message: "Indeed did not require documents for this application."
    };
  }

  let changed = false;

  if (fileInputs.length > 0) {
    const resumeDocument = profile.documents.resume;

    if (!resumeDocument) {
      return {
        ok: false,
        message: "No saved resume is available for the file upload prompt."
      };
    }

    fileInputs.forEach((input) => {
      uploadResumeDocument(input, resumeDocument);
      changed = true;
    });
    await delay(actionDelayMs);
  }

  changed = chooseNativeResumeSelect(surface, profile) || changed;

  if (!changed) {
    changed = await chooseCustomResumeOption(surface, profile, actionDelayMs);
  }

  await delay(actionDelayMs);

  const submitControl = findSubmitApplicationControl(surface);
  const continueControl = findContinueControl(surface);

  if (
    (submitControl && !isDisabledControl(submitControl)) ||
    (continueControl && !isDisabledControl(continueControl))
  ) {
    return {
      ok: true,
      message: changed
        ? "Selected the resume document for Indeed."
        : "Indeed had a usable resume selection."
    };
  }

  return {
    ok: false,
    message: "Indeed still requires a resume selection before submit."
  };
}

function uploadResumeDocument(
  input: HTMLInputElement,
  resumeDocument: DocumentReference
): void {
  const file = createFileFromDocument(resumeDocument);
  const files = createFileList(file);

  Object.defineProperty(input, "files", {
    configurable: true,
    value: files
  });

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  const dropTarget =
    input.closest<HTMLElement>(
      "[data-testid*='drop'], [data-test-id*='drop'], [class*='drop'], [class*='upload'], label, div"
    ) ?? input;

  dropTarget.dispatchEvent(createDropEvent(file));
}

function createFileFromDocument(documentReference: DocumentReference): File {
  const binary = window.atob(documentReference.dataBase64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], documentReference.fileName || documentReference.name, {
    type: documentReference.mimeType || "application/pdf"
  });
}

function createFileList(file: File): FileList {
  const dataTransfer = createDataTransfer(file);

  if (dataTransfer.files.length > 0) {
    return dataTransfer.files;
  }

  const fileList = {
    0: file,
    length: 1,
    item: (index: number) => (index === 0 ? file : null)
  };

  return fileList as unknown as FileList;
}

function createDataTransfer(file: File): DataTransfer {
  if (typeof DataTransfer !== "undefined") {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    return dataTransfer;
  }

  return {
    files: {
      0: file,
      length: 1,
      item: (index: number) => (index === 0 ? file : null)
    },
    items: {
      add: () => file
    }
  } as unknown as DataTransfer;
}

function createDropEvent(file: File): Event {
  if (typeof DragEvent !== "undefined") {
    return new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: createDataTransfer(file)
    });
  }

  const event = new Event("drop", {
    bubbles: true,
    cancelable: true
  });

  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: createDataTransfer(file)
  });

  return event;
}

function chooseNativeResumeSelect(
  surface: HTMLElement,
  profile: ApplicantProfile
): boolean {
  let changed = false;
  const resumeDocument = profile.documents.resume;
  const preferredNames = [
    resumeDocument?.fileName,
    resumeDocument?.name,
    "resume",
    "cv",
    "pdf",
    "doc"
  ]
    .map((value) => normalizeText(value ?? ""))
    .filter(Boolean);

  queryAll<HTMLSelectElement>("select", surface)
    .filter((select) => isVisibleElement(select) || select.required)
    .forEach((select) => {
      const options = Array.from(select.options).filter(
        (option) =>
          !option.disabled &&
          option.value.trim() &&
          !isPlaceholderText(option.textContent ?? option.value)
      );
      const match =
        options.find((option) =>
          preferredNames.some((name) =>
            normalizeText(option.textContent ?? option.value).includes(name)
          )
        ) ?? options[0];

      if (!match || select.value === match.value) {
        return;
      }

      select.value = match.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      changed = true;
    });

  return changed;
}

async function chooseCustomResumeOption(
  surface: HTMLElement,
  profile: ApplicantProfile,
  actionDelayMs: number
): Promise<boolean> {
  const triggers = queryAll<HTMLElement>(
    [
      "button",
      "[role='button']",
      "[role='combobox']",
      "input[aria-expanded]",
      "[aria-haspopup='listbox']"
    ].join(", "),
    surface
  ).filter((element) => {
    if (!isVisibleActionControl(element) || isDisabledControl(element)) {
      return false;
    }

    const text = normalizeText(
      [
        getActionControlText(element),
        element.getAttribute("placeholder"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.closest("label")?.textContent
      ].join(" ")
    );

    return (
      text.includes("resume") ||
      text.includes("cv") ||
      text.includes("document") ||
      text.includes("select") ||
      text.includes("choose")
    );
  });

  for (const trigger of triggers) {
    trigger.focus();
    trigger.click();
    await delay(actionDelayMs);

    const option = findResumeDocumentOption(profile);

    if (!option) {
      continue;
    }

    option.focus();
    option.click();
    return true;
  }

  return false;
}

function findResumeDocumentOption(profile: ApplicantProfile): HTMLElement | null {
  const resumeDocument = profile.documents.resume;
  const preferredNames = [
    resumeDocument?.fileName,
    resumeDocument?.name,
    "resume",
    "cv",
    "pdf",
    "doc"
  ]
    .map((value) => normalizeText(value ?? ""))
    .filter(Boolean);

  return (
    queryAll<HTMLElement>(DOCUMENT_OPTION_SELECTOR)
      .filter(isVisibleElement)
      .filter((element) => !isSubmitOrCancelControl(element))
      .find((element) => {
        const text = normalizeText(getActionControlText(element));
        return preferredNames.some((name) => text.includes(name));
      }) ?? null
  );
}

function findSubmitApplicationControl(
  root: ParentNode = document,
  options: {
    includeDisabled?: boolean;
  } = {}
): HTMLElement | null {
  const rootText = normalizeText(
    cleanText(root instanceof Node ? root.textContent : "")
  );

  return (
    queryAll<HTMLElement>(ACTION_CONTROL_SELECTOR, root).find((control) => {
      if (!isVisibleActionControl(control)) {
        return false;
      }

      if (!options.includeDisabled && isDisabledControl(control)) {
        return false;
      }

      const text = normalizeText(getActionControlText(control));

      return (
        text.includes("submit your application") ||
        text.includes("submit application") ||
        text.includes("send application") ||
        (text === "submit" && rootText.includes("application"))
      );
    }) ?? null
  );
}

function findContinueControl(root: ParentNode = document): HTMLElement | null {
  return (
    queryAll<HTMLElement>(ACTION_CONTROL_SELECTOR, root).find((control) => {
      if (!isVisibleActionControl(control) || isDisabledControl(control)) {
        return false;
      }

      const text = normalizeText(getActionControlText(control));
      return text === "continue" || text.includes("continue to");
    }) ?? null
  );
}

async function waitForApplicationSurface(
  timeoutMs: number
): Promise<HTMLElement | null> {
  return waitForValue(findApplicationSurface, timeoutMs);
}

function findApplicationSurface(): HTMLElement | null {
  const explicitSurface = queryAll<HTMLElement>(APPLICATION_SURFACE_SELECTOR).find(
    (surface) => {
      if (!isVisibleElement(surface)) {
        return false;
      }

      const text = normalizeText(cleanText(surface.textContent));
      return (
        text.includes("submit your application") ||
        text.includes("submit application") ||
        text.includes("resume") ||
        text.includes("cv") ||
        text.includes("indeed apply")
      );
    }
  );

  if (explicitSurface) {
    return explicitSurface;
  }

  const submitControl = findSubmitApplicationControl();
  return (
    submitControl?.closest<HTMLElement>(
      "form, [role='dialog'], [aria-modal='true'], section, article"
    ) ??
    submitControl ??
    null
  );
}

function hasUnsupportedIndeedPrompt(surfaceText: string): boolean {
  return [
    "cover letter",
    "transcript",
    "writing sample",
    "portfolio document",
    "other document",
    "references",
    "additional required document",
    "employer questions",
    "questions from the employer",
    "answer these questions",
    "answer the following questions"
  ].some((term) => surfaceText.includes(term));
}

function hasAdditionalRequiredQuestions(surface: HTMLElement): boolean {
  const controls = queryAll<HTMLElement>(
    [
      "textarea",
      "input:not([type='hidden']):not([type='file']):not([type='button']):not([type='submit']):not([type='checkbox']):not([type='radio'])",
      "[role='textbox']"
    ].join(", "),
    surface
  ).filter((control) => isVisibleElement(control) || isRequiredControl(control));

  return controls.some((control) => {
    const context = normalizeText(
      [
        control.getAttribute("placeholder"),
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.closest("label")?.textContent,
        control.closest("fieldset, section, article")?.textContent
      ].join(" ")
    );

    if (
      context.includes("resume") ||
      context.includes("cv") ||
      context.includes("document") ||
      context.includes("search") ||
      context.includes("select")
    ) {
      return false;
    }

    return true;
  });
}

function isResumeUploadInput(input: HTMLInputElement): boolean {
  const context = normalizeText(
    [
      input.name,
      input.id,
      input.accept,
      input.getAttribute("aria-label"),
      input.closest("label")?.textContent,
      input.closest("[data-testid], [data-test-id], div")?.textContent
    ].join(" ")
  );

  return (
    context.includes("resume") ||
    context.includes("cv") ||
    context.includes("pdf") ||
    context.includes("document")
  );
}

async function waitForSubmissionConfirmation(
  surface: HTMLElement,
  timeoutMs: number
): Promise<boolean> {
  const result = await waitForValue(() => {
    if (!surface.isConnected || !isVisibleElement(surface)) {
      return true;
    }

    return hasSubmittedApplicationSignal() ? true : null;
  }, timeoutMs);

  return result === true;
}

function hasSubmittedApplicationSignal(): boolean {
  const text = normalizeText(document.body?.innerText ?? document.body?.textContent ?? "");

  return (
    text.includes("application submitted") ||
    text.includes("you applied") ||
    text.includes("applied on") ||
    text.includes("application received") ||
    text.includes("your application has been submitted")
  );
}

function getCurrentIndeedJobTitle(): string {
  const detailRoot = findIndeedJobDetailRoot();
  const heading = cleanText(
    detailRoot?.querySelector("h1, h2, [role='heading']")?.textContent ??
      document.querySelector("h1, h2, [role='heading']")?.textContent
  );

  if (heading) {
    return clipText(heading, 96);
  }

  return clipText(cleanText(document.title), 96) || "Indeed job";
}

async function moveToMoreIndeedJobs(actionDelayMs: number): Promise<boolean> {
  const cards = collectIndeedJobCards();
  const scrolled = scrollIndeedJobList(cards);

  if (scrolled) {
    await delay(actionDelayMs);
    return true;
  }

  const nextPage = findNextPageControl();

  if (!nextPage) {
    return false;
  }

  nextPage.focus();
  clickInternalIndeedLink(nextPage);
  await delay(actionDelayMs);
  return true;
}

function scrollIndeedJobList(cards: IndeedJobCard[]): boolean {
  const scrollContainer = findScrollableJobContainer(cards);

  if (!scrollContainer) {
    return false;
  }

  const before = scrollContainer.scrollTop;
  const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;

  if (maxScrollTop <= before + 1) {
    return false;
  }

  const amount = Math.max(scrollContainer.clientHeight * 0.8, 640);

  scrollContainer.scrollTop = Math.min(before + amount, maxScrollTop);
  cards.at(-1)?.element.scrollIntoView({
    block: "end",
    inline: "nearest"
  });

  return scrollContainer.scrollTop !== before;
}

function findScrollableJobContainer(cards: IndeedJobCard[]): HTMLElement | null {
  for (const card of cards) {
    let current = card.element.parentElement;

    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);

      if (
        current.scrollHeight > current.clientHeight + 40 &&
        ["auto", "scroll"].includes(style.overflowY)
      ) {
        return current;
      }

      current = current.parentElement;
    }
  }

  return (document.scrollingElement as HTMLElement | null) ?? document.body;
}

function findNextPageControl(): HTMLElement | null {
  return (
    queryAll<HTMLElement>(ACTION_CONTROL_SELECTOR).find((control) => {
      if (!isVisibleActionControl(control) || isDisabledControl(control)) {
        return false;
      }

      const text = normalizeText(
        [
          getActionControlText(control),
          control.getAttribute("aria-label"),
          control.getAttribute("title")
        ].join(" ")
      );
      return text === "next" || text.includes("next page");
    }) ?? null
  );
}

function findIndeedJobDetailRoot(): HTMLElement | null {
  const roots = queryAll<HTMLElement>(
    [
      "#jobsearch-ViewJobPaneWrapper",
      "#jobsearch-ViewjobPaneWrapper",
      "#viewJobSSRRoot",
      "[data-testid='jobsearch-JobComponent']",
      ".jobsearch-JobComponent",
      "[data-testid*='jobsearch-Job']",
      "[aria-label*='Job details']",
      "[aria-label*='job details']",
      "[class*='jobsearch-ViewJobLayout']",
      "[class*='ViewJobLayout']"
    ].join(", ")
  ).filter(isVisibleElement);

  return (
    roots.find((root) =>
      queryAll<HTMLElement>(ACTION_CONTROL_SELECTOR, root).some((control) =>
        normalizeText(getActionControlText(control)).includes("apply")
      )
    ) ??
    roots[0] ??
    null
  );
}

function clickInternalIndeedLink(control: HTMLElement): boolean {
  const link =
    control instanceof HTMLAnchorElement
      ? control
      : control.closest<HTMLAnchorElement>("a[href]");

  if (!link) {
    control.click();
    return true;
  }

  if (isExternalIndeedHref(link.href)) {
    return false;
  }

  const originalTarget = link.getAttribute("target");

  link.setAttribute("target", "_self");
  link.click();

  if (originalTarget === null) {
    link.removeAttribute("target");
  } else {
    link.setAttribute("target", originalTarget);
  }

  return true;
}

function closeApplicationSurface(surface: HTMLElement): void {
  const closeControl =
    queryAll<HTMLElement>(ACTION_CONTROL_SELECTOR, surface).find((control) => {
      if (!isVisibleActionControl(control) || isDisabledControl(control)) {
        return false;
      }

      const text = normalizeText(getActionControlText(control));
      return (
        text === "cancel" ||
        text === "close" ||
        text.includes("close dialog") ||
        text.includes("not now")
      );
    }) ??
    queryAll<HTMLElement>("[aria-label*='Close'], [aria-label*='close']", surface).find(
      isVisibleElement
    ) ??
    null;

  if (closeControl) {
    closeControl.focus();
    closeControl.click();
    return;
  }

  surface.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true
    })
  );
}

function renderIndeedOverlay(status: IndeedModeStatus): void {
  const existing = document.getElementById(INDEED_OVERLAY_ID);
  const overlay = existing ?? document.createElement("div");

  overlay.id = INDEED_OVERLAY_ID;
  overlay.setAttribute("role", "status");
  overlay.style.position = "fixed";
  overlay.style.right = "16px";
  overlay.style.bottom = "16px";
  overlay.style.zIndex = "2147483647";
  overlay.style.maxWidth = "320px";
  overlay.style.padding = "12px 14px";
  overlay.style.borderRadius = "8px";
  overlay.style.boxShadow = "0 12px 32px rgba(0, 0, 0, 0.28)";
  overlay.style.background = status.active ? "#111827" : "#374151";
  overlay.style.color = "#ffffff";
  overlay.style.font = "13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  overlay.style.pointerEvents = "none";
  overlay.textContent = [
    status.active ? "Indeed mode running" : "Indeed mode stopped",
    `Applied ${status.applied} | Skipped ${status.skipped} | Failed ${status.failed}`,
    status.message
  ]
    .filter(Boolean)
    .join(" - ");

  if (!existing) {
    document.documentElement.appendChild(overlay);
  }
}

function queryAll<T extends Element>(
  selector: string,
  root: ParentNode = document
): T[] {
  try {
    return Array.from(root.querySelectorAll<T>(selector));
  } catch {
    return [];
  }
}

function isVisibleActionControl(control: HTMLElement): boolean {
  return isVisibleElement(control) && !control.closest("[hidden], [aria-hidden='true']");
}

function isVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (
    element.hidden ||
    element.closest("[hidden], [aria-hidden='true']") ||
    element.getAttribute("aria-hidden") === "true"
  ) {
    return false;
  }

  const style = window.getComputedStyle(element);

  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || element.isConnected;
}

function isDisabledControl(control: HTMLElement): boolean {
  if (
    control instanceof HTMLButtonElement ||
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement ||
    control instanceof HTMLTextAreaElement
  ) {
    return control.disabled;
  }

  return control.getAttribute("aria-disabled") === "true";
}

function isRequiredControl(control: HTMLElement): boolean {
  if (
    control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLSelectElement
  ) {
    return control.required || control.getAttribute("aria-required") === "true";
  }

  return control.getAttribute("aria-required") === "true";
}

function isSubmitOrCancelControl(element: HTMLElement): boolean {
  const text = normalizeText(getActionControlText(element));
  return (
    text.includes("submit") ||
    text.includes("continue") ||
    text.includes("cancel") ||
    text.includes("close") ||
    text.includes("apply")
  );
}

function getActionControlText(control: HTMLElement): string {
  if (control instanceof HTMLInputElement) {
    return cleanText(
      control.value ||
        control.getAttribute("aria-label") ||
        control.getAttribute("title") ||
        control.placeholder
    );
  }

  return cleanText(
    control.textContent ||
      control.getAttribute("aria-label") ||
      control.getAttribute("title")
  );
}

function isInsideIndeedJobResult(element: HTMLElement): boolean {
  const detailRoot = findIndeedJobDetailRoot();

  if (detailRoot?.contains(element)) {
    return false;
  }

  const container = element.closest<HTMLElement>(INDEED_JOB_CONTAINER_SELECTOR);

  if (!container || container.closest(APPLICATION_SURFACE_SELECTOR)) {
    return false;
  }

  return queryAll<HTMLAnchorElement>(INDEED_JOB_LINK_SELECTOR, container).some(
    isIndeedJobNavigationLink
  );
}

function isExternalIndeedHref(href: string): boolean {
  if (!href) {
    return false;
  }

  try {
    const url = new URL(href, window.location.href);
    return Boolean(url.hostname) && !isIndeedHostname(url.hostname);
  } catch {
    return false;
  }
}

function isIndeedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "indeed.com" || host.endsWith(".indeed.com");
}

async function waitForValue<T>(
  producer: () => T | null,
  timeoutMs: number,
  intervalMs = 100
): Promise<T | null> {
  const expiresAt = Date.now() + timeoutMs;

  while (Date.now() <= expiresAt) {
    const value = producer();

    if (value) {
      return value;
    }

    await delay(intervalMs);
  }

  return null;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
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

function clipText(value: string, maxLength: number): string {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function isPlaceholderText(value: string): boolean {
  const text = normalizeText(value);
  return !text || text === "select" || text.includes("choose") || text.includes("select");
}

function dedupeBy<T>(values: T[], keyFn: (value: T) => string): T[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = keyFn(value);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
