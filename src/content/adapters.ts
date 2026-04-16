import {
  SupportedPlatform,
  detectPlatformFromHostname
} from "../shared/core";

export type AdapterFormControl =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement;

export interface PlatformAdapter {
  platform: SupportedPlatform;
  label: string;
  notes: string[];
  getLabel(field: AdapterFormControl): string;
  getSectionHeading(field: AdapterFormControl): string;
  getNearbyText(field: AdapterFormControl): string;
  getOptionLabels(field: AdapterFormControl): string[];
  getSignals(field: AdapterFormControl): string[];
  getGroupingKey(field: AdapterFormControl): string | null;
  getJobSignals(pageText: string): string[];
}

export function resolvePlatformAdapter(hostname: string): PlatformAdapter {
  const platform = detectPlatformFromHostname(hostname);

  switch (platform) {
    case "greenhouse":
      return greenhouseAdapter;
    case "lever":
      return leverAdapter;
    case "workday":
      return workdayAdapter;
    default:
      return genericAdapter;
  }
}

const genericAdapter = createAdapter("generic", "Generic adapter", [
  "Using shared label, section, and nearby-text heuristics."
]);

const greenhouseAdapter = createAdapter("greenhouse", "Greenhouse adapter", [
  "Reads application-question and field wrappers for stronger labels.",
  "Keeps the generic fallback path for unsupported controls."
], {
  getLabel: (field) =>
    firstText(
      textFromClosest(
        field,
        ".application-question, .field, .question, [data-question-id]",
        "label, .application-label, .field-label, .question-label"
      ),
      referencedText(field, "aria-labelledby")
    ),
  getSectionHeading: (field) =>
    firstText(
      textFromClosest(
        field,
        "fieldset, section, form, .application-form",
        "legend, h2, h3, h4, .section-header, .application-section-title"
      ),
      nearestHeadingText(field)
    ),
  getNearbyText: (field) =>
    clippedText(
      field.closest(
        ".application-question, .field, .question, fieldset, section, article, li, div, label"
      )?.textContent
    ),
  getOptionLabels: (field) =>
    extractChoiceLabels(
      field,
      ".application-question, .field, .question, fieldset"
    ),
  getSignals: (field) =>
    dedupeStrings([
      ...attributeTokens(field, ["data-qa", "data-field", "data-mapped"]),
      ...ancestorAttributeTokens(
        field,
        ["data-question-id", "data-qa"],
        4
      ),
      ...referencedTextTokens(field, "aria-describedby")
    ]),
  getGroupingKey: (field) =>
    choiceGroupingKey(
      field,
      ".application-question, .field, .question, [data-question-id]",
      ["data-question-id"]
    ),
  getJobSignals: (pageText) =>
    filterSignals(pageText, [
      "resume",
      "cover letter",
      "eeoc",
      "voluntary self identification"
    ])
});

const leverAdapter = createAdapter("lever", "Lever adapter", [
  "Reads posting-form and application-section wrappers for question context.",
  "Adds Lever data-qa hints to improve field classification."
], {
  getLabel: (field) =>
    firstText(
      textFromClosest(
        field,
        ".application-question, .posting-form__question, .application-section, [data-qa='question']",
        "label, .application-label, [data-qa='question-label'], [data-qa='label']"
      ),
      referencedText(field, "aria-labelledby")
    ),
  getSectionHeading: (field) =>
    firstText(
      textFromClosest(
        field,
        ".application-section, .posting-form__section, form, section",
        "h2, h3, h4, .section-header, .posting-form__section-header"
      ),
      nearestHeadingText(field)
    ),
  getNearbyText: (field) =>
    clippedText(
      field.closest(
        ".application-question, .posting-form__question, .application-section, section, article, li, div, label"
      )?.textContent
    ),
  getOptionLabels: (field) =>
    extractChoiceLabels(
      field,
      ".application-question, .posting-form__question, .application-section"
    ),
  getSignals: (field) =>
    dedupeStrings([
      ...attributeTokens(field, ["data-qa", "data-testid"]),
      ...ancestorAttributeTokens(field, ["data-qa"], 4),
      ...referencedTextTokens(field, "aria-describedby")
    ]),
  getGroupingKey: (field) =>
    choiceGroupingKey(
      field,
      ".application-question, .posting-form__question, [data-qa='question']",
      ["data-qa"]
    ),
  getJobSignals: (pageText) =>
    filterSignals(pageText, [
      "resume",
      "cover letter",
      "additional information",
      "sponsorship"
    ])
});

const workdayAdapter = createAdapter("workday", "Workday adapter", [
  "Reads data-automation-id and aria-labelledby metadata from Workday forms.",
  "Adds Workday field wrapper context before falling back to generic matching."
], {
  getLabel: (field) =>
    firstText(
      referencedText(field, "aria-labelledby"),
      textFromClosest(
        field,
        "[data-automation-id='formField'], [data-automation-id='fieldSetContent'], [data-automation-id='dateSectionMonth-input'], [data-automation-id='dateSectionYear-input']",
        "label, [data-automation-id='formLabel'], [data-automation-id='fieldSetLegend'], [data-automation-id='promptOption']"
      )
    ),
  getSectionHeading: (field) =>
    firstText(
      textFromClosest(
        field,
        "[data-automation-id='pageSection'], [data-automation-id='formField'], section, article",
        "[data-automation-id='formField-sectionHeader'], h2, h3, h4, [role='heading']"
      ),
      nearestHeadingText(field)
    ),
  getNearbyText: (field) =>
    clippedText(
      field.closest(
        "[data-automation-id='formField'], [data-automation-id='fieldSetContent'], [data-automation-id='promptOption'], section, article, div"
      )?.textContent
    ),
  getOptionLabels: (field) =>
    extractChoiceLabels(
      field,
      "[data-automation-id='formField'], [data-automation-id='fieldSetContent'], [role='group']"
    ),
  getSignals: (field) =>
    dedupeStrings([
      ...attributeTokens(field, ["data-automation-id", "data-testid"]),
      ...ancestorAttributeTokens(field, ["data-automation-id"], 5),
      ...referencedTextTokens(field, "aria-describedby"),
      ...referencedTextTokens(field, "aria-labelledby")
    ]),
  getGroupingKey: (field) =>
    choiceGroupingKey(
      field,
      "[data-automation-id='formField'], [data-automation-id='fieldSetContent'], [role='group']",
      ["data-automation-id"]
    ),
  getJobSignals: (pageText) =>
    filterSignals(pageText, [
      "my information",
      "work experience",
      "resume/cv",
      "add another"
    ])
});

function createAdapter(
  platform: SupportedPlatform,
  label: string,
  notes: string[],
  overrides: Partial<PlatformAdapter> = {}
): PlatformAdapter {
  return {
    platform,
    label,
    notes,
    getLabel: overrides.getLabel ?? (() => ""),
    getSectionHeading: overrides.getSectionHeading ?? (() => ""),
    getNearbyText: overrides.getNearbyText ?? (() => ""),
    getOptionLabels: overrides.getOptionLabels ?? (() => []),
    getSignals: overrides.getSignals ?? (() => []),
    getGroupingKey: overrides.getGroupingKey ?? (() => null),
    getJobSignals: overrides.getJobSignals ?? (() => [])
  };
}

function textFromClosest(
  field: AdapterFormControl,
  containerSelector: string,
  childSelector: string
): string {
  const container = field.closest(containerSelector);
  return cleanText(container?.querySelector(childSelector)?.textContent);
}

function referencedText(
  field: AdapterFormControl,
  attributeName: "aria-labelledby" | "aria-describedby"
): string {
  const ids = field.getAttribute(attributeName)?.trim();

  if (!ids) {
    return "";
  }

  return cleanText(
    ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
  );
}

function referencedTextTokens(
  field: AdapterFormControl,
  attributeName: "aria-labelledby" | "aria-describedby"
): string[] {
  const text = referencedText(field, attributeName);
  return text ? [text] : [];
}

function nearestHeadingText(field: AdapterFormControl): string {
  let current: Element | null = field.parentElement;
  let depth = 0;

  while (current && depth < 6) {
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

function extractChoiceLabels(
  field: AdapterFormControl,
  containerSelector: string
): string[] {
  if (
    !(field instanceof HTMLInputElement) ||
    (field.type !== "radio" && field.type !== "checkbox")
  ) {
    return [];
  }

  const container = field.closest(containerSelector);

  if (!container) {
    return [];
  }

  return dedupeStrings(
    Array.from(container.querySelectorAll("label"))
      .map((label) => cleanText(label.textContent))
      .filter(Boolean)
      .slice(0, 10)
  );
}

function choiceGroupingKey(
  field: AdapterFormControl,
  containerSelector: string,
  attributes: string[]
): string | null {
  if (
    !(field instanceof HTMLInputElement) ||
    (field.type !== "radio" && field.type !== "checkbox")
  ) {
    return null;
  }

  const container = field.closest(containerSelector);

  if (!container) {
    return null;
  }

  const attributeMatch = attributes
    .map((attribute) => container.getAttribute(attribute)?.trim())
    .find(Boolean);

  const stableValue =
    attributeMatch ||
    container.id ||
    cleanText(container.querySelector("legend, label, [role='heading']")?.textContent);

  return stableValue ? `${field.type}:${normalizeKey(stableValue)}` : null;
}

function attributeTokens(
  field: AdapterFormControl,
  attributes: string[]
): string[] {
  return attributes
    .map((attribute) => cleanText(field.getAttribute(attribute)))
    .filter(Boolean);
}

function ancestorAttributeTokens(
  field: AdapterFormControl,
  attributes: string[],
  maxDepth: number
): string[] {
  const values: string[] = [];
  let current: Element | null = field.parentElement;
  let depth = 0;

  while (current && depth < maxDepth) {
    attributes.forEach((attribute) => {
      const value = cleanText(current?.getAttribute(attribute));
      if (value) {
        values.push(value);
      }
    });

    current = current.parentElement;
    depth += 1;
  }

  return dedupeStrings(values);
}

function filterSignals(pageText: string, values: string[]): string[] {
  const normalizedPage = pageText.toLowerCase();
  return values.filter((value) => normalizedPage.includes(value));
}

function firstText(...values: Array<string | null | undefined>): string {
  return values.map(cleanText).find(Boolean) ?? "";
}

function clippedText(value: string | null | undefined, maxLength = 220): string {
  const text = cleanText(value);

  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
}

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function dedupeStrings(values: string[]): string[] {
  return values.filter(
    (value, index) => Boolean(value) && values.indexOf(value) === index
  );
}
