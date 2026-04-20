import {
  ApplicantProfile,
  DocumentReference,
  ExtensionSettings,
  HandshakeModeStatus
} from "../shared/core";

type HandshakeApplyOutcome = "applied" | "skipped" | "failed";

interface HandshakeJobCard {
  id: string;
  element: HTMLElement;
  title: string;
  href: string;
}

interface HandshakeApplyResult {
  outcome: HandshakeApplyOutcome;
  message: string;
  title: string;
}

interface ResumeReadyResult {
  ok: boolean;
  message: string;
}

interface HandshakeModeController {
  active: boolean;
  stopRequested: boolean;
  attemptedJobIds: Set<string>;
  runPromise: Promise<HandshakeModeStatus> | null;
  status: HandshakeModeStatus;
}

interface HandshakeRunOptions {
  controller?: HandshakeModeController;
  maxIdleRounds?: number;
  actionDelayMs?: number;
  surfaceTimeoutMs?: number;
}

declare global {
  interface Window {
    __AUTO_JOB_APP_HANDSHAKE_MODE__?: HandshakeModeController;
  }
}

const HANDSHAKE_OVERLAY_ID = "autojobapp-handshake-mode-overlay";
const ACTION_CONTROL_SELECTOR = [
  "button",
  "[role='button']",
  "a[href]",
  "input[type='button']",
  "input[type='submit']"
].join(", ");
const APPLICATION_SURFACE_SELECTOR = [
  "[role='dialog']",
  "[aria-modal='true']",
  "[data-testid*='modal']",
  "[data-test-id*='modal']",
  "[class*='modal']",
  "[class*='Modal']",
  ".modal"
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

export async function toggleHandshakeMode(
  profile: ApplicantProfile,
  settings: ExtensionSettings
): Promise<HandshakeModeStatus> {
  const controller = getHandshakeController();

  if (controller.active) {
    controller.stopRequested = true;
    controller.status = {
      ...controller.status,
      active: false,
      message: "Handshake mode is stopping after the current job."
    };
    renderHandshakeOverlay(controller.status);
    return controller.status;
  }

  if (!isHandshakeHostname(window.location.hostname)) {
    controller.status = {
      ...createInitialStatus(),
      active: false,
      message: "Handshake mode only runs on app.joinhandshake.com pages."
    };
    renderHandshakeOverlay(controller.status);
    return controller.status;
  }

  controller.active = true;
  controller.stopRequested = false;
  controller.attemptedJobIds.clear();
  controller.status = {
    ...createInitialStatus(),
    active: true,
    message: "Handshake mode started. Press the shortcut again to stop."
  };
  renderHandshakeOverlay(controller.status);

  controller.runPromise = runHandshakeMode(profile, settings, { controller }).finally(
    () => {
      controller.active = false;
      controller.stopRequested = false;
      renderHandshakeOverlay(controller.status);
    }
  );

  void controller.runPromise.catch((error) => {
    controller.status = {
      ...controller.status,
      active: false,
      failed: controller.status.failed + 1,
      message: `Handshake mode stopped: ${toErrorMessage(error)}`
    };
    renderHandshakeOverlay(controller.status);
  });

  return controller.status;
}

export async function runHandshakeMode(
  profile: ApplicantProfile,
  settings: ExtensionSettings,
  options: HandshakeRunOptions = {}
): Promise<HandshakeModeStatus> {
  const controller = options.controller ?? createHandshakeController();
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
    message: "Scanning visible Handshake jobs..."
  };
  renderHandshakeOverlay(controller.status);

  while (!controller.stopRequested) {
    const cards = collectHandshakeJobCards().filter(
      (card) => !controller.attemptedJobIds.has(card.id)
    );

    if (cards.length === 0) {
      const moved = await moveToMoreHandshakeJobs(actionDelayMs);

      if (!moved) {
        idleRounds += 1;
      } else {
        idleRounds = 0;
      }

      if (idleRounds >= maxIdleRounds) {
        controller.status = {
          ...controller.status,
          message: "Handshake mode finished. No more unvisited jobs were found."
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
        message: `Opening ${card.title || "next Handshake job"}...`
      };
      renderHandshakeOverlay(controller.status);

      await activateHandshakeJobCard(card, actionDelayMs);

      const result = await tryApplyToCurrentHandshakeJob(profile, {
        settings,
        surfaceTimeoutMs,
        actionDelayMs
      });
      controller.status = reduceHandshakeStatus(controller.status, result);
      renderHandshakeOverlay(controller.status);
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
      "Handshake mode stopped. Press the shortcut to start again."
  };
  renderHandshakeOverlay(controller.status);
  return controller.status;
}

export function isHandshakeEasyApplyControl(control: HTMLElement): boolean {
  if (!isVisibleActionControl(control) || isDisabledControl(control)) {
    return false;
  }

  const text = normalizeText(getActionControlText(control));

  if (!text.includes("apply")) {
    return false;
  }

  if (
    text.includes("external") ||
    text.includes("externally") ||
    text.includes("applied") ||
    text.includes("withdraw") ||
    text.includes("save")
  ) {
    return false;
  }

  if (isExternalHandshakeHref(resolveControlHref(control))) {
    return false;
  }

  return (
    text === "apply" ||
    text === "apply now" ||
    text === "quick apply" ||
    text.includes("quick apply")
  );
}

export function findHandshakeEasyApplyControl(
  root: ParentNode = document
): HTMLElement | null {
  return (
    queryAll<HTMLElement>(ACTION_CONTROL_SELECTOR, root).find(
      isHandshakeEasyApplyControl
    ) ?? null
  );
}

export function isHandshakeApplicationSurfaceEasy(surface: HTMLElement): boolean {
  const surfaceText = normalizeText(cleanText(surface.textContent));

  if (!surfaceText) {
    return false;
  }

  if (surfaceText.includes("apply externally")) {
    return false;
  }

  if (hasUnsupportedDocumentPrompt(surfaceText)) {
    return false;
  }

  if (hasAdditionalRequiredQuestions(surface)) {
    return false;
  }

  return Boolean(
    findSubmitApplicationControl(surface, {
      includeDisabled: true
    })
  );
}

function getHandshakeController(): HandshakeModeController {
  if (!window.__AUTO_JOB_APP_HANDSHAKE_MODE__) {
    window.__AUTO_JOB_APP_HANDSHAKE_MODE__ = createHandshakeController();
  }

  return window.__AUTO_JOB_APP_HANDSHAKE_MODE__;
}

function createHandshakeController(): HandshakeModeController {
  return {
    active: false,
    stopRequested: false,
    attemptedJobIds: new Set<string>(),
    runPromise: null,
    status: createInitialStatus()
  };
}

function createInitialStatus(): HandshakeModeStatus {
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

function reduceHandshakeStatus(
  status: HandshakeModeStatus,
  result: HandshakeApplyResult
): HandshakeModeStatus {
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

function collectHandshakeJobCards(): HandshakeJobCard[] {
  const links = queryAll<HTMLAnchorElement>(
    "a[href*='/job-search/'], a[href*='/jobs/']"
  );
  const cards = links
    .map((link) => {
      const id = extractHandshakeJobId(link.href);

      if (!id || isExternalHandshakeHref(link.href)) {
        return null;
      }

      const element =
        link.closest<HTMLElement>(
          "li, article, [role='listitem'], [data-testid*='job'], [data-test-id*='job'], [class*='job'], [class*='Job']"
        ) ?? link;
      const title = clipText(cleanText(element.textContent || link.textContent), 96);

      return {
        id,
        element,
        title: title || `Handshake job ${id}`,
        href: link.href
      } satisfies HandshakeJobCard;
    })
    .filter((card): card is HandshakeJobCard => Boolean(card))
    .filter((card) => isVisibleElement(card.element));

  const uniqueCards = dedupeBy(cards, (card) => card.id);

  if (uniqueCards.length > 0) {
    return uniqueCards;
  }

  const currentJobId = extractHandshakeJobId(window.location.href);

  if (!currentJobId) {
    return [];
  }

  return [
    {
      id: currentJobId,
      element: document.body,
      title: clipText(cleanText(document.title), 96) || `Handshake job ${currentJobId}`,
      href: window.location.href
    }
  ];
}

function extractHandshakeJobId(href: string): string {
  const match = href.match(/\/(?:job-search|jobs)\/(\d+)/i);
  return match?.[1] ?? "";
}

async function activateHandshakeJobCard(
  card: HandshakeJobCard,
  actionDelayMs: number
): Promise<void> {
  const currentJobId = extractHandshakeJobId(window.location.href);

  if (currentJobId && currentJobId === card.id) {
    return;
  }

  card.element.scrollIntoView({
    block: "center",
    inline: "nearest"
  });
  card.element.focus();
  card.element.click();
  await delay(actionDelayMs);
}

async function tryApplyToCurrentHandshakeJob(
  profile: ApplicantProfile,
  options: {
    settings: ExtensionSettings;
    surfaceTimeoutMs: number;
    actionDelayMs: number;
  }
): Promise<HandshakeApplyResult> {
  const title = getCurrentHandshakeJobTitle();

  if (hasSubmittedApplicationSignal()) {
    return {
      outcome: "skipped",
      title,
      message: `${title} was already applied to.`
    };
  }

  const applyControl = findHandshakeEasyApplyControl();

  if (!applyControl) {
    return {
      outcome: "skipped",
      title,
      message: `${title} was skipped because no in-Handshake easy apply button was found.`
    };
  }

  applyControl.focus();
  applyControl.click();

  const surface = await waitForApplicationSurface(options.surfaceTimeoutMs);

  if (!surface) {
    return {
      outcome: "failed",
      title,
      message: `${title} could not be submitted because the Handshake apply dialog did not open.`
    };
  }

  if (!isHandshakeApplicationSurfaceEasy(surface)) {
    closeApplicationSurface(surface);
    return {
      outcome: "skipped",
      title,
      message: `${title} was skipped because the application asked for more than a resume-only Handshake submit.`
    };
  }

  const resumeReady = await ensureHandshakeResumeReady(
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

  const submitControl = findSubmitApplicationControl(surface);

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
      message: `${title} submit was clicked, but Handshake did not show a submission confirmation.`
    };
  }

  return {
    outcome: "applied",
    title,
    message: `${title} was submitted through Handshake.`
  };
}

async function ensureHandshakeResumeReady(
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
        ? "Handshake already has a resume selected."
        : "Handshake did not require a resume for this application."
    };
  }

  if (!hasResumePrompt) {
    return {
      ok: true,
      message: "Handshake did not require documents for this application."
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

  if (submitControl && !isDisabledControl(submitControl)) {
    return {
      ok: true,
      message: changed
        ? "Selected the resume document for Handshake."
        : "Handshake had a usable resume selection."
    };
  }

  return {
    ok: false,
    message: "Handshake still requires a resume selection before submit."
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
        text.includes("submit application") ||
        text.includes("send application") ||
        (text === "submit" && rootText.includes("application"))
      );
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
        text.includes("submit application") ||
        text.includes("resume") ||
        text.includes("cv") ||
        text.includes("additional document")
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

function hasUnsupportedDocumentPrompt(surfaceText: string): boolean {
  return [
    "cover letter",
    "transcript",
    "writing sample",
    "portfolio document",
    "other document",
    "references",
    "additional required document"
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
    text.includes("application received")
  );
}

function getCurrentHandshakeJobTitle(): string {
  const heading = cleanText(
    document.querySelector("h1, h2, [role='heading']")?.textContent
  );

  if (heading) {
    return clipText(heading, 96);
  }

  return clipText(cleanText(document.title), 96) || "Handshake job";
}

async function moveToMoreHandshakeJobs(actionDelayMs: number): Promise<boolean> {
  const cards = collectHandshakeJobCards();
  const scrolled = scrollHandshakeJobList(cards);

  if (scrolled) {
    await delay(actionDelayMs);
    return true;
  }

  const nextPage = findNextPageControl();

  if (!nextPage) {
    return false;
  }

  nextPage.focus();
  nextPage.click();
  await delay(actionDelayMs);
  return true;
}

function scrollHandshakeJobList(cards: HandshakeJobCard[]): boolean {
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

function findScrollableJobContainer(
  cards: HandshakeJobCard[]
): HTMLElement | null {
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

      const text = normalizeText(getActionControlText(control));
      return text === "next" || text.includes("next page");
    }) ?? null
  );
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

function renderHandshakeOverlay(status: HandshakeModeStatus): void {
  const existing = document.getElementById(HANDSHAKE_OVERLAY_ID);
  const overlay = existing ?? document.createElement("div");

  overlay.id = HANDSHAKE_OVERLAY_ID;
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
    status.active ? "Handshake mode running" : "Handshake mode stopped",
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

function resolveControlHref(control: HTMLElement): string {
  if (control instanceof HTMLAnchorElement) {
    return control.href;
  }

  return control.closest<HTMLAnchorElement>("a[href]")?.href ?? "";
}

function isExternalHandshakeHref(href: string): boolean {
  if (!href) {
    return false;
  }

  try {
    const url = new URL(href, window.location.href);
    return Boolean(url.hostname) && !isHandshakeHostname(url.hostname);
  } catch {
    return false;
  }
}

function isHandshakeHostname(hostname: string): boolean {
  return hostname.toLowerCase().includes("joinhandshake.com");
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
