import { ApplicationWorkflowSummary } from "../shared/core";
import { PlatformAdapter } from "./adapters";

const GENERIC_STEP_SELECTORS = [
  "[aria-current='step']",
  "[data-step]",
  ".step",
  ".steps li",
  ".wizard-step",
  ".progress-step",
  ".application-step",
  "[role='listitem']"
];

const CURRENT_STEP_SELECTORS = [
  "[aria-current='step']",
  ".is-active",
  ".active",
  "[data-active='true']",
  "[aria-selected='true']"
];

const NEXT_ACTION_SELECTORS = [
  "button",
  "input[type='button']",
  "input[type='submit']",
  "[role='button']"
];

const STEP_KEYWORDS = [
  "contact",
  "profile",
  "resume",
  "experience",
  "education",
  "questions",
  "assessment",
  "review",
  "submit",
  "documents",
  "application"
];

const NEXT_ACTION_KEYWORDS = [
  "continue",
  "next",
  "review",
  "submit",
  "save and continue",
  "continue to next step"
];

export function detectApplicationWorkflow(
  adapter: PlatformAdapter
): ApplicationWorkflowSummary {
  const detectedSteps = collectDetectedSteps(adapter);
  const currentStep = detectCurrentStep(detectedSteps);
  const nextActions = collectNextActions();
  const isMultiStepLikely =
    detectedSteps.length > 1 ||
    (Boolean(currentStep) && nextActions.length > 0);

  return {
    isMultiStepLikely,
    currentStep,
    detectedSteps,
    nextActions
  };
}

function collectDetectedSteps(adapter: PlatformAdapter): string[] {
  const selectors = [
    ...GENERIC_STEP_SELECTORS,
    ...platformStepSelectors(adapter)
  ];

  const values = selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll(selector))
      .map((element) => cleanText(element.textContent))
      .filter(isLikelyStepLabel)
  );

  return dedupe(values).slice(0, 8);
}

function detectCurrentStep(detectedSteps: string[]): string {
  const currentFromSelectors = CURRENT_STEP_SELECTORS.flatMap((selector) =>
    Array.from(document.querySelectorAll(selector))
      .map((element) => cleanText(element.textContent))
      .filter(isLikelyStepLabel)
  )[0];

  if (currentFromSelectors) {
    return currentFromSelectors;
  }

  const heading = cleanText(
    document.querySelector("h1, h2, h3, [role='heading']")?.textContent
  );

  if (isLikelyStepLabel(heading)) {
    return heading;
  }

  return detectedSteps[0] ?? "";
}

function collectNextActions(): string[] {
  return dedupe(
    NEXT_ACTION_SELECTORS.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector))
        .map((element) => {
          if (element instanceof HTMLInputElement) {
            return cleanText(element.value);
          }

          return cleanText(element.textContent);
        })
        .filter((value) =>
          NEXT_ACTION_KEYWORDS.some((keyword) => value.toLowerCase().includes(keyword))
        )
    )
  ).slice(0, 4);
}

function platformStepSelectors(adapter: PlatformAdapter): string[] {
  switch (adapter.platform) {
    case "greenhouse":
      return [
        ".application-form section h2",
        ".application-form legend",
        ".application-question h3"
      ];
    case "lever":
      return [
        ".application-section h3",
        ".posting-form__section h3",
        "[data-qa='question'] [data-qa='question-label']"
      ];
    case "workday":
      return [
        "[data-automation-id='progressBar'] *",
        "[data-automation-id='pageSection'] [role='heading']",
        "[data-automation-id='formField-sectionHeader']"
      ];
    default:
      return [];
  }
}

function isLikelyStepLabel(value: string): boolean {
  if (!value) {
    return false;
  }

  if (value.length > 48) {
    return false;
  }

  const normalized = value.toLowerCase();
  return STEP_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function dedupe(values: string[]): string[] {
  return values.filter(
    (value, index) => Boolean(value) && values.indexOf(value) === index
  );
}
