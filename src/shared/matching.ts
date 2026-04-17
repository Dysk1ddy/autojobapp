import {
  ApplicantProfile,
  DetectedFieldMatch,
  FieldElementTag,
  FieldMatchBreakdown,
  MatchConfidence,
  ProfileFieldKey,
  TemplateCategory
} from "./core";

export interface FieldScanCandidate {
  fieldId: string;
  selectorHint: string;
  label: string;
  elementTag: FieldElementTag;
  inputType: string;
  name: string;
  elementId: string;
  placeholder: string;
  ariaLabel: string;
  autocomplete: string;
  sectionHeading: string;
  nearbyText: string;
  optionLabels: string[];
  adapterSignals: string[];
  required: boolean;
}

export interface ResolvedProfileValue {
  raw: string | string[] | null;
  preview: string;
  hasValue: boolean;
}

interface FieldDefinition {
  key: ProfileFieldKey;
  label: string;
  synonyms: string[];
  autocomplete?: string[];
  preferredTags?: FieldElementTag[];
  preferredInputTypes?: string[];
  disallowedInputTypes?: string[];
  getValue: (
    profile: ApplicantProfile,
    entryIndex?: number
  ) => ResolvedProfileValue;
}

interface FieldEvaluation {
  key: ProfileFieldKey;
  label: string;
  score: number;
  signals: string[];
  valuePreview: string;
  hasValue: boolean;
}

const FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: "personal.fullName",
    label: "Full name",
    synonyms: [
      "full name",
      "legal name",
      "your name",
      "applicant name",
      "signature name",
      "signed name",
      "typed name",
      "type your name",
      "electronic signature",
      "name"
    ],
    autocomplete: ["name"],
    preferredInputTypes: ["text"],
    getValue: (profile) => textValue(profile.personal.fullName)
  },
  {
    key: "personal.firstName",
    label: "First name",
    synonyms: ["first name", "given name", "forename"],
    autocomplete: ["given-name"],
    preferredInputTypes: ["text"],
    getValue: (profile) => textValue(profile.personal.firstName)
  },
  {
    key: "personal.lastName",
    label: "Last name",
    synonyms: ["last name", "family name", "surname"],
    autocomplete: ["family-name"],
    preferredInputTypes: ["text"],
    getValue: (profile) => textValue(profile.personal.lastName)
  },
  {
    key: "personal.preferredName",
    label: "Preferred name",
    synonyms: ["preferred name", "nickname", "chosen name"],
    preferredInputTypes: ["text"],
    getValue: (profile) => textValue(profile.personal.preferredName)
  },
  {
    key: "personal.pronouns",
    label: "Pronouns",
    synonyms: ["pronouns", "personal pronouns"],
    preferredTags: ["input", "select"],
    getValue: (profile) => textValue(profile.personal.pronouns)
  },
  {
    key: "personal.headline",
    label: "Headline",
    synonyms: ["headline", "professional headline", "current title"],
    preferredInputTypes: ["text"],
    getValue: (profile) => textValue(profile.personal.headline)
  },
  {
    key: "personal.summary",
    label: "Professional summary",
    synonyms: [
      "summary",
      "professional summary",
      "about you",
      "tell us about yourself",
      "bio"
    ],
    preferredTags: ["textarea"],
    getValue: (profile) => textValue(profile.personal.summary)
  },
  {
    key: "contact.email",
    label: "Email",
    synonyms: ["email", "email address", "e mail"],
    autocomplete: ["email"],
    preferredInputTypes: ["email", "text"],
    getValue: (profile) => textValue(profile.contact.email)
  },
  {
    key: "contact.phone",
    label: "Phone",
    synonyms: ["phone", "mobile", "phone number", "telephone", "cell"],
    autocomplete: ["tel", "tel-national"],
    preferredInputTypes: ["tel", "text"],
    getValue: (profile) => textValue(profile.contact.phone)
  },
  {
    key: "contact.addressLine1",
    label: "Address line 1",
    synonyms: ["address", "street address", "address line 1", "street"],
    autocomplete: ["street-address", "address-line1"],
    preferredInputTypes: ["text"],
    getValue: (profile) => textValue(profile.contact.addressLine1)
  },
  {
    key: "contact.addressLine2",
    label: "Address line 2",
    synonyms: ["address line 2", "apartment", "suite", "unit"],
    autocomplete: ["address-line2"],
    preferredInputTypes: ["text"],
    getValue: (profile) => textValue(profile.contact.addressLine2)
  },
  {
    key: "contact.city",
    label: "City",
    synonyms: ["city", "town"],
    autocomplete: ["address-level2"],
    preferredInputTypes: ["text"],
    getValue: (profile) => textValue(profile.contact.city)
  },
  {
    key: "contact.state",
    label: "State or province",
    synonyms: ["state", "province", "state or province", "state province", "region"],
    autocomplete: ["address-level1"],
    preferredInputTypes: ["text"],
    getValue: (profile) => textValue(profile.contact.state)
  },
  {
    key: "contact.postalCode",
    label: "Postal code",
    synonyms: ["zip", "zip code", "postal code", "postcode"],
    autocomplete: ["postal-code"],
    preferredInputTypes: ["text"],
    getValue: (profile) => textValue(profile.contact.postalCode)
  },
  {
    key: "contact.country",
    label: "Country",
    synonyms: ["country", "country of residence"],
    autocomplete: ["country", "country-name"],
    preferredTags: ["input", "select"],
    getValue: (profile) => textValue(profile.contact.country)
  },
  {
    key: "links.linkedin",
    label: "LinkedIn",
    synonyms: ["linkedin", "linkedin url", "linkedin profile"],
    preferredInputTypes: ["url", "text"],
    getValue: (profile) => textValue(profile.links.linkedin)
  },
  {
    key: "links.github",
    label: "GitHub",
    synonyms: [
      "github",
      "github url",
      "github profile",
      "github profile url",
      "github link",
      "github account"
    ],
    preferredInputTypes: ["url", "text"],
    getValue: (profile) => textValue(profile.links.github)
  },
  {
    key: "links.portfolio",
    label: "Portfolio",
    synonyms: ["portfolio", "portfolio url", "portfolio website"],
    preferredInputTypes: ["url", "text"],
    getValue: (profile) => textValue(profile.links.portfolio)
  },
  {
    key: "links.website",
    label: "Website",
    synonyms: ["website", "personal website", "homepage"],
    preferredInputTypes: ["url", "text"],
    getValue: (profile) => textValue(profile.links.website)
  },
  {
    key: "education.school",
    label: "School",
    synonyms: ["school", "university", "college", "institution"],
    preferredInputTypes: ["text"],
    getValue: (profile, entryIndex = 0) =>
      textValue(profile.education[entryIndex]?.school)
  },
  {
    key: "education.degree",
    label: "Degree",
    synonyms: ["degree", "degree type", "qualification"],
    preferredInputTypes: ["text"],
    getValue: (profile, entryIndex = 0) =>
      textValue(profile.education[entryIndex]?.degree)
  },
  {
    key: "education.major",
    label: "Major",
    synonyms: ["major", "field of study", "subject"],
    preferredInputTypes: ["text"],
    getValue: (profile, entryIndex = 0) =>
      textValue(profile.education[entryIndex]?.major)
  },
  {
    key: "experience.company",
    label: "Company",
    synonyms: ["company", "employer", "organization"],
    preferredInputTypes: ["text"],
    getValue: (profile, entryIndex = 0) =>
      textValue(profile.experience[entryIndex]?.company)
  },
  {
    key: "experience.title",
    label: "Job title",
    synonyms: ["job title", "title", "position", "role"],
    preferredInputTypes: ["text"],
    getValue: (profile, entryIndex = 0) =>
      textValue(profile.experience[entryIndex]?.title)
  },
  {
    key: "experience.location",
    label: "Experience location",
    synonyms: ["work location", "job location", "location"],
    preferredInputTypes: ["text"],
    getValue: (profile, entryIndex = 0) =>
      textValue(profile.experience[entryIndex]?.location)
  },
  {
    key: "experience.description",
    label: "Experience description",
    synonyms: [
      "responsibilities",
      "job description",
      "experience description",
      "accomplishments",
      "what did you do"
    ],
    preferredTags: ["textarea"],
    getValue: (profile, entryIndex = 0) =>
      textValue(
        profile.experience[entryIndex]?.description ||
          profile.experience[entryIndex]?.achievements.join("; ")
      )
  },
  {
    key: "projects.name",
    label: "Project name",
    synonyms: ["project name", "project", "project title"],
    preferredInputTypes: ["text"],
    getValue: (profile, entryIndex = 0) =>
      textValue(profile.projects[entryIndex]?.name)
  },
  {
    key: "projects.description",
    label: "Project description",
    synonyms: ["project description", "project details", "describe your project"],
    preferredTags: ["textarea"],
    getValue: (profile, entryIndex = 0) =>
      textValue(profile.projects[entryIndex]?.description)
  },
  {
    key: "skills.list",
    label: "Skills",
    synonyms: ["skills", "technical skills", "technologies", "tools"],
    preferredTags: ["input", "textarea"],
    getValue: (profile) => listValue(profile.skills)
  },
  {
    key: "workAuthorization.authorizedCountries",
    label: "Work authorization",
    synonyms: [
      "authorized to work",
      "legally authorized",
      "work authorization",
      "eligible to work"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) => listValue(profile.workAuthorization.authorizedCountries)
  },
  {
    key: "workAuthorization.requiresSponsorship",
    label: "Requires sponsorship",
    synonyms: [
      "require sponsorship",
      "need sponsorship",
      "visa sponsorship",
      "sponsorship required",
      "immigration related employment benefit",
      "h 1b visa petition",
      "f 1 visa",
      "o 1 visa petition",
      "e 3 visa petition",
      "tn status"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text", "combobox", "listbox"],
    getValue: (profile) =>
      yesNoValueWithDefault(profile.workAuthorization.requiresSponsorship, "no")
  },
  {
    key: "workAuthorization.requiresFutureSponsorship",
    label: "Future sponsorship",
    synonyms: [
      "future sponsorship",
      "now or in the future require sponsorship",
      "will you now or in the future require sponsorship",
      "future visa sponsorship",
      "in the future require sponsorship",
      "sponsorship for an immigration related employment benefit",
      "immigration related employment benefit",
      "job flexibility benefits",
      "adjustment of status portability"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text", "combobox", "listbox"],
    getValue: (profile) =>
      yesNoValueWithDefault(profile.workAuthorization.requiresFutureSponsorship, "no")
  },
  {
    key: "workAuthorization.willingToRelocate",
    label: "Relocation preference",
    synonyms: ["willing to relocate", "relocation", "open to relocation"],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) =>
      textValue(toSentenceCase(profile.workAuthorization.willingToRelocate))
  },
  {
    key: "workAuthorization.veteranStatus",
    label: "Veteran status",
    synonyms: [
      "veteran status",
      "protected veteran",
      "military veteran",
      "are you a veteran",
      "voluntary self identification of veteran status",
      "categories of protected veterans",
      "protected veterans listed above",
      "government contractor subject to vevraa",
      "vevraa"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) => veteranStatusValue(profile.workAuthorization.veteranStatus)
  },
  {
    key: "workAuthorization.disabilityStatus",
    label: "Disability status",
    synonyms: [
      "disability status",
      "disability",
      "self identify as having a disability",
      "voluntary self identification of disability",
      "voluntary self-identification of disability",
      "self identification of disability",
      "self-identification of disability",
      "identify as an individual with a disability",
      "do you have a disability",
      "have a disability",
      "disability disclosure",
      "form cc 305",
      "cc-305",
      "cc 305",
      "i do not want to answer",
      "i do not wish to answer"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) => textValue(profile.workAuthorization.disabilityStatus)
  },
  {
    key: "workAuthorization.gender",
    label: "Gender",
    synonyms: [
      "gender",
      "gender identity",
      "self described gender",
      "sex",
      "sex or gender"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) => textValue(profile.workAuthorization.gender)
  },
  {
    key: "workAuthorization.ethnicity",
    label: "Ethnicity",
    synonyms: [
      "ethnicity",
      "race",
      "race/ethnicity",
      "ethnicity/race",
      "hispanic or latino",
      "racial identity",
      "self identify your ethnicity",
      "voluntary self identification of ethnicity"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) => textValue(profile.workAuthorization.ethnicity)
  },
  {
    key: "workAuthorization.selfIdentificationLanguage",
    label: "Self-identification language",
    synonyms: [
      "self identification language",
      "self-identification language",
      "eeo language",
      "language for self identification"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["select", "radio", "text"],
    getValue: (profile) =>
      textValue(profile.workAuthorization.selfIdentificationLanguage || "English")
  },
  {
    key: "workAuthorization.isAtLeast18",
    label: "At least 18 years old",
    synonyms: [
      "are you at least 18 years old",
      "at least 18 years old",
      "18 years old",
      "18 years of age",
      "over 18",
      "18 or older",
      "older than 18",
      "age requirement",
      "age eligibility"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) =>
      textValue(
        toSentenceCase(
          profile.workAuthorization.isAtLeast18 === "unknown"
            ? "yes"
            : profile.workAuthorization.isAtLeast18
        )
      )
  },
  {
    key: "workAuthorization.canVerifyLegalWorkRight",
    label: "Can verify legal work right",
    synonyms: [
      "submit verification of your legal right to work",
      "legal right to work at a micron affiliated company",
      "verification of your legal right to work",
      "can you submit verification of your legal right to work",
      "verify your legal right to work"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) =>
      yesNoValueWithDefault(profile.workAuthorization.canVerifyLegalWorkRight, "yes")
  },
  {
    key: "workAuthorization.terminationHistory",
    label: "Termination history",
    synonyms: [
      "have you ever been terminated",
      "asked to resign by any former employer",
      "termination history",
      "former employer for the following reasons"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) =>
      yesNoValueWithDefault(profile.workAuthorization.terminationHistory, "no")
  },
  {
    key: "workAuthorization.friendsOrRelativesAtCompany",
    label: "Friends or relatives at company",
    synonyms: [
      "friends relatives presently employed",
      "friends or relatives presently employed",
      "friends or relatives employed by micron",
      "friends relatives employed by the company",
      "relatives employed by micron"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) =>
      yesNoValueWithDefault(
        profile.workAuthorization.friendsOrRelativesAtCompany,
        "no"
      )
  },
  {
    key: "workAuthorization.exportControlCitizenship",
    label: "Export-control restricted citizenship",
    synonyms: [
      "export control rules",
      "citizen of or hold dual citizenship",
      "cuba iran north korea and syria",
      "dual citizenship with any of these countries",
      "export control citizenship"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) =>
      yesNoValueWithDefault(profile.workAuthorization.exportControlCitizenship, "no")
  },
  {
    key: "workAuthorization.boardDirectorPlans",
    label: "Board of directors plans",
    synonyms: [
      "plans to join the board of directors",
      "join the board of directors of a for profit company",
      "board of directors prior to starting",
      "board of directors plans"
    ],
    preferredTags: ["select", "input"],
    preferredInputTypes: ["radio", "checkbox", "select", "text"],
    getValue: (profile) =>
      yesNoValueWithDefault(profile.workAuthorization.boardDirectorPlans, "no")
  },
  {
    key: "workAuthorization.availabilityDate",
    label: "Availability after offer",
    synonyms: [
      "when would you be available",
      "available if an offer was accepted",
      "availability after offer",
      "availability date",
      "when can you start",
      "earliest start date",
      "start date availability",
      "available start date",
      "notice period"
    ],
    preferredTags: ["select", "input", "textarea"],
    preferredInputTypes: ["radio", "checkbox", "select", "text", "textarea", "combobox", "listbox"],
    getValue: (profile) =>
      textValue(profile.workAuthorization.availabilityDate || "Immediately")
  },
  {
    key: "documents.resume",
    label: "Resume upload",
    synonyms: ["resume", "cv", "upload resume", "attach resume"],
    preferredInputTypes: ["file"],
    getValue: (profile) => documentValue(profile.documents.resume, "No saved resume")
  },
  {
    key: "documents.coverLetter",
    label: "Cover letter upload",
    synonyms: ["cover letter", "upload cover letter", "attach cover letter"],
    preferredInputTypes: ["file"],
    getValue: (profile) =>
      documentValue(profile.documents.coverLetter, "No saved cover letter")
  },
  {
    key: "templates.cover-note",
    label: "Cover note answer",
    synonyms: [
      "cover letter",
      "cover note",
      "additional information",
      "short note",
      "introduction"
    ],
    preferredTags: ["textarea"],
    disallowedInputTypes: ["radio", "checkbox"],
    getValue: (profile) => templateValue(profile, "cover-note")
  },
  {
    key: "templates.motivation",
    label: "Motivation answer",
    synonyms: [
      "why this role",
      "why are you interested",
      "why do you want this role",
      "why us",
      "why this company"
    ],
    preferredTags: ["textarea"],
    disallowedInputTypes: ["radio", "checkbox"],
    getValue: (profile) => templateValue(profile, "motivation")
  },
  {
    key: "templates.salary",
    label: "Salary answer",
    synonyms: [
      "salary",
      "compensation",
      "salary expectation",
      "desired salary",
      "pay expectation"
    ],
    preferredTags: ["textarea", "input", "select"],
    disallowedInputTypes: ["radio", "checkbox"],
    getValue: (profile) => templateValue(profile, "salary")
  },
  {
    key: "templates.relocation",
    label: "Relocation answer",
    synonyms: ["relocation", "willing to relocate", "open to relocation"],
    preferredTags: ["textarea", "input", "select"],
    disallowedInputTypes: ["radio", "checkbox"],
    getValue: (profile) => templateValue(profile, "relocation")
  },
  {
    key: "templates.sponsorship",
    label: "Sponsorship answer",
    synonyms: [
      "sponsorship",
      "visa sponsorship",
      "work authorization question",
      "need sponsorship"
    ],
    preferredTags: ["textarea", "input"],
    disallowedInputTypes: ["radio", "checkbox", "select", "combobox", "listbox"],
    getValue: (profile) => templateValue(profile, "sponsorship")
  }
];

export function classifyFieldCandidates(
  candidates: FieldScanCandidate[],
  profile: ApplicantProfile
): DetectedFieldMatch[] {
  return candidates.map((candidate) => classifyFieldCandidate(candidate, profile));
}

export function summarizeFieldMatches(
  matches: DetectedFieldMatch[]
): FieldMatchBreakdown {
  return matches.reduce<FieldMatchBreakdown>(
    (summary, match) => {
      summary[match.confidence] += 1;
      return summary;
    },
    {
      high: 0,
      medium: 0,
      low: 0,
      unmatched: 0
    }
  );
}

export function resolveProfileFieldValue(
  profile: ApplicantProfile,
  key: ProfileFieldKey,
  entryIndex = 0
): ResolvedProfileValue {
  const definition = FIELD_DEFINITIONS.find((field) => field.key === key);

  return definition?.getValue(profile, entryIndex) ?? emptyValue();
}

export function getProfileFieldLabel(key: ProfileFieldKey): string {
  return FIELD_DEFINITIONS.find((field) => field.key === key)?.label ?? key;
}

export function isRepeatableProfileFieldKey(key: ProfileFieldKey): boolean {
  return (
    key.startsWith("education.") ||
    key.startsWith("experience.") ||
    key.startsWith("projects.")
  );
}

function classifyFieldCandidate(
  candidate: FieldScanCandidate,
  profile: ApplicantProfile
): DetectedFieldMatch {
  const evaluations = FIELD_DEFINITIONS.map((definition) =>
    evaluateDefinition(candidate, definition, profile)
  ).sort((left, right) => right.score - left.score);

  const top = evaluations[0];
  const runnerUp = evaluations[1];
  const confidence = determineConfidence(top, runnerUp);

  if (confidence === "unmatched") {
    return {
      ...candidate,
      matchedKey: null,
      matchedLabel: "",
      matchedValuePreview: "",
      hasValue: false,
      confidence,
      score: top?.score ?? 0,
      matchedSignals: top?.signals.slice(0, 4) ?? []
    };
  }

  return {
    ...candidate,
    matchedKey: top.key,
    matchedLabel: top.label,
    matchedValuePreview: top.valuePreview,
    hasValue: top.hasValue,
    confidence,
    score: top.score,
    matchedSignals: top.signals.slice(0, 6)
  };
}

function evaluateDefinition(
  candidate: FieldScanCandidate,
  definition: FieldDefinition,
  profile: ApplicantProfile
): FieldEvaluation {
  const signals: string[] = [];
  let score = 0;

  score += scoreSource(candidate.label, definition.synonyms, 14, "label", signals);
  score += scoreSource(candidate.name, definition.synonyms, 11, "name", signals);
  score += scoreSource(candidate.elementId, definition.synonyms, 10, "id", signals);
  score += scoreSource(
    candidate.placeholder,
    definition.synonyms,
    9,
    "placeholder",
    signals
  );
  score += scoreSource(
    candidate.ariaLabel,
    definition.synonyms,
    9,
    "aria",
    signals
  );
  score += scoreSource(
    candidate.sectionHeading,
    definition.synonyms,
    7,
    "section",
    signals
  );
  score += scoreSource(
    candidate.nearbyText,
    definition.synonyms,
    5,
    "nearby",
    signals
  );
  score += scoreSource(
    candidate.optionLabels.join(" "),
    definition.synonyms,
    4,
    "options",
    signals
  );
  score += scoreSource(
    candidate.adapterSignals.join(" "),
    definition.synonyms,
    10,
    "adapter",
    signals
  );
  score += scoreSource(
    candidate.autocomplete,
    definition.autocomplete ?? [],
    18,
    "autocomplete",
    signals,
    true
  );

  if (definition.preferredTags?.includes(candidate.elementTag)) {
    score += 4;
    pushUnique(signals, `tag:${candidate.elementTag}`);
  }
  else {
    const customTagBoost = getCustomTagPreferenceBoost(candidate, definition);

    if (customTagBoost > 0) {
      score += customTagBoost;
      pushUnique(signals, `custom-tag:${candidate.inputType}`);
    }
  }

  if (definition.preferredInputTypes?.includes(candidate.inputType)) {
    score += 5;
    pushUnique(signals, `type:${candidate.inputType}`);
  }

  if (definition.disallowedInputTypes?.includes(candidate.inputType)) {
    score -= 8;
  }

  if (candidate.required) {
    score += 1;
  }

  const value = definition.getValue(profile);

  return {
    key: definition.key,
    label: definition.label,
    score,
    signals,
    valuePreview: value.preview,
    hasValue: value.hasValue
  };
}

function determineConfidence(
  top: FieldEvaluation | undefined,
  runnerUp: FieldEvaluation | undefined
): MatchConfidence {
  if (!top || top.score < 12) {
    return "unmatched";
  }

  let adjustedScore = top.score;
  const scoreGap = top.score - (runnerUp?.score ?? 0);

  if (scoreGap < 4) {
    adjustedScore -= 4;
  }

  if (top.signals.length <= 1) {
    adjustedScore -= 3;
  }

  if (adjustedScore >= 28) {
    return "high";
  }

  if (adjustedScore >= 19) {
    return "medium";
  }

  if (adjustedScore >= 12) {
    return "low";
  }

  return "unmatched";
}

function scoreSource(
  rawSource: string,
  phrases: string[],
  weight: number,
  sourceLabel: string,
  signals: string[],
  requireExact = false
): number {
  if (!rawSource || phrases.length === 0) {
    return 0;
  }

  const normalizedSource = normalizeText(rawSource);

  if (!normalizedSource) {
    return 0;
  }

  for (const phrase of phrases) {
    const normalizedPhrase = normalizeText(phrase);

    if (!normalizedPhrase) {
      continue;
    }

    const matches = requireExact
      ? normalizedSource === normalizedPhrase ||
        normalizedSource.startsWith(`${normalizedPhrase} `)
      : normalizedSource.includes(normalizedPhrase);

    if (matches) {
      pushUnique(signals, `${sourceLabel}:${phrase}`);
      return weight + getSourceMatchBoost(normalizedSource, normalizedPhrase);
    }
  }

  return 0;
}

function getSourceMatchBoost(
  normalizedSource: string,
  normalizedPhrase: string
): number {
  if (!normalizedSource || !normalizedPhrase) {
    return 0;
  }

  if (normalizedSource === normalizedPhrase) {
    return 10;
  }

  if (
    normalizedSource.endsWith(` ${normalizedPhrase}`) ||
    normalizedSource.startsWith(`${normalizedPhrase} `)
  ) {
    return Math.min(6, Math.max(2, normalizedPhrase.split(" ").length * 2));
  }

  return 0;
}

function getCustomTagPreferenceBoost(
  candidate: FieldScanCandidate,
  definition: FieldDefinition
): number {
  if (candidate.elementTag !== "custom" || !definition.preferredTags?.length) {
    return 0;
  }

  if (
    (candidate.inputType === "textbox" || candidate.inputType === "contenteditable") &&
    (definition.preferredTags.includes("textarea") || definition.preferredTags.includes("input"))
  ) {
    return definition.preferredTags.includes("textarea") ? 6 : 4;
  }

  if (
    (candidate.inputType === "combobox" || candidate.inputType === "listbox") &&
    (definition.preferredTags.includes("select") || definition.preferredTags.includes("input"))
  ) {
    return definition.preferredTags.includes("select") ? 6 : 4;
  }

  if (
    (candidate.inputType === "radio" || candidate.inputType === "checkbox") &&
    definition.preferredTags.includes("input")
  ) {
    return 6;
  }

  return 0;
}

function templateValue(
  profile: ApplicantProfile,
  category: TemplateCategory
): ResolvedProfileValue {
  const answer =
    profile.templates.find((template) => template.category === category)?.answer ?? "";

  return textValue(answer);
}

function documentValue(
  document: ApplicantProfile["documents"]["resume"] | ApplicantProfile["documents"]["coverLetter"],
  fallbackLabel: string
): ResolvedProfileValue {
  if (!document) {
    return {
      raw: null,
      preview: fallbackLabel,
      hasValue: false
    };
  }

  return {
    raw: document.fileName || document.name,
    preview: truncatePreview(document.fileName || document.name),
    hasValue: true
  };
}

function textValue(value: string | undefined): ResolvedProfileValue {
  const nextValue = value?.trim() ?? "";

  return {
    raw: nextValue || null,
    preview: truncatePreview(nextValue),
    hasValue: Boolean(nextValue)
  };
}

function yesNoValueWithDefault(
  value: "yes" | "no" | "unknown",
  fallback: "yes" | "no"
): ResolvedProfileValue {
  return textValue(toSentenceCase(value === "unknown" ? fallback : value));
}

function veteranStatusValue(value: string | undefined): ResolvedProfileValue {
  const normalized = normalizeText(value ?? "");

  if (
    !normalized ||
    normalized === "prefer not to say" ||
    normalized === "prefer not to answer" ||
    normalized === "prefer not to self identify" ||
    normalized === "i dont wish to answer" ||
    normalized === "i do not wish to answer"
  ) {
    return textValue("I am not a veteran");
  }

  return textValue(value);
}

function listValue(values: string[] | undefined): ResolvedProfileValue {
  if (!values || values.length === 0) {
    return emptyValue();
  }

  return {
    raw: values,
    preview: truncatePreview(values.join(", ")),
    hasValue: true
  };
}

function emptyValue(): ResolvedProfileValue {
  return {
    raw: null,
    preview: "",
    hasValue: false
  };
}

function truncatePreview(value: string, maxLength = 88): string {
  if (!value) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
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

function toSentenceCase(value: string): string {
  if (!value) {
    return "";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}
