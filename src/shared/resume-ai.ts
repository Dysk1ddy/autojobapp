import {
  AnswerTemplate,
  ApplicantProfile,
  CertificationEntry,
  ContactDetails,
  DEFAULT_AI_ASSIST_MODEL,
  EducationEntry,
  ExperienceEntry,
  ExtensionSettings,
  LinkDetails,
  PersonalDetails,
  ProjectEntry,
  ResumeImportSummary,
  TemplateCategory,
  WorkAuthorizationDetails,
  toErrorMessage
} from "./core";
import {
  ResumeImportOptions,
  ResumeImportResult,
  importResumeTextIntoProfile
} from "./resume";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_RESUME_TEXT_LENGTH = 18000;

export interface AiResumeImportResponse {
  summary: string;
  warnings: string[];
  personal: Pick<
    PersonalDetails,
    | "fullName"
    | "firstName"
    | "lastName"
    | "preferredName"
    | "headline"
    | "summary"
  >;
  contact: Pick<
    ContactDetails,
    "email" | "phone" | "addressLine1" | "city" | "state" | "postalCode" | "country"
  >;
  links: Pick<LinkDetails, "linkedin" | "github" | "portfolio" | "website">;
  education: Array<
    Pick<
      EducationEntry,
      | "school"
      | "degree"
      | "major"
      | "minor"
      | "gpa"
      | "startDate"
      | "endDate"
      | "location"
      | "currentlyEnrolled"
      | "highlights"
    >
  >;
  experience: Array<
    Pick<
      ExperienceEntry,
      | "company"
      | "title"
      | "location"
      | "employmentType"
      | "startDate"
      | "endDate"
      | "current"
      | "description"
      | "achievements"
      | "technologies"
    >
  >;
  projects: Array<
    Pick<
      ProjectEntry,
      | "name"
      | "role"
      | "description"
      | "technologies"
      | "link"
      | "startDate"
      | "endDate"
      | "highlights"
    >
  >;
  skills: string[];
  workAuthorization: Pick<
    WorkAuthorizationDetails,
    "authorizedCountries" | "remoteWorkPreference" | "clearanceStatus"
  >;
  certifications: Array<
    Pick<
      CertificationEntry,
      | "name"
      | "issuer"
      | "issueDate"
      | "expirationDate"
      | "credentialId"
      | "credentialUrl"
    >
  >;
  templates: Array<
    Pick<AnswerTemplate, "title" | "category" | "promptHints" | "answer">
  >;
}

interface AiResumeMergeResult {
  profile: ApplicantProfile;
  importedFields: string[];
  warnings: string[];
}

export async function generateAiResumeImport(
  profile: ApplicantProfile,
  rawText: string,
  settings: ExtensionSettings,
  options: ResumeImportOptions = {}
): Promise<ResumeImportResult> {
  const baseline = importResumeTextIntoProfile(profile, rawText, options);
  const apiKey = settings.openAiApiKey.trim();
  const model = settings.aiAssistModel.trim() || DEFAULT_AI_ASSIST_MODEL;
  const customInstructions = settings.aiCustomInstructions.trim();
  const normalizedText = rawText.trim();

  if (!normalizedText) {
    return baseline;
  }

  if (!apiKey) {
    throw new Error(
      "Save an OpenAI API key in Options before running ChatGPT resume parsing."
    );
  }

  const truncatedResumeText = normalizedText.slice(0, MAX_RESUME_TEXT_LENGTH);
  const truncationWarning =
    normalizedText.length > MAX_RESUME_TEXT_LENGTH
      ? [
          "The uploaded resume text was truncated before ChatGPT parsing to keep the request lightweight."
        ]
      : [];
  const requestInput = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            "You extract structured applicant profile data from resume text. Return only facts supported by the resume. Leave unknown strings empty and unknown arrays empty. Do not invent EEO, disability, veteran, ethnicity, gender, date-of-birth, or social-security details. Only set work authorization or clearance fields when the resume explicitly states them. You may draft reusable answer templates when they can be grounded in the resume and current profile context. Keep summaries concise, keep bullet arrays short, and preserve links exactly when present."
        }
      ]
    }
  ] as Array<Record<string, unknown>>;

  if (customInstructions) {
    requestInput.push({
      role: "system",
      content: [
        {
          type: "input_text",
          text: `Additional user instructions for AI resume parsing: ${customInstructions}`
        }
      ]
    });
  }

  requestInput.push({
    role: "user",
    content: [
      {
        type: "input_text",
        text: JSON.stringify(
          buildAiResumePromptPayload(truncatedResumeText, profile, baseline.profile)
        )
      }
    ]
  });

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 3200,
      input: requestInput,
      text: {
        format: {
          type: "json_schema",
          name: "resume_import_profile",
          strict: true,
          schema: createAiResumeResponseSchema()
        }
      }
    })
  });

  if (!response.ok) {
    const errorBody = await safeReadResponseText(response);
    throw new Error(
      `OpenAI request failed (${response.status}): ${
        errorBody || response.statusText || "Unknown error"
      }`
    );
  }

  const rawResponse = (await response.json()) as Record<string, unknown>;
  const parsed = parseStructuredAiResumeResponse(rawResponse);
  const merged = mergeAiResumePatch(baseline.profile, parsed);
  const summary: ResumeImportSummary = {
    importedAt: new Date().toISOString(),
    sourceKind: options.sourceKind ?? baseline.summary.sourceKind,
    sourceName: options.sourceName ?? baseline.summary.sourceName,
    sourceMimeType: options.sourceMimeType ?? baseline.summary.sourceMimeType,
    parserLabel: createAiResumeParserLabel(
      options.parserLabel ?? baseline.summary.parserLabel
    ),
    sourcePreview: normalizedText.slice(0, 160),
    importedFields: dedupeStrings([
      ...baseline.summary.importedFields,
      ...merged.importedFields
    ]),
    warnings: dedupeStrings([
      ...baseline.summary.warnings,
      ...truncationWarning,
      ...merged.warnings
    ])
  };

  return {
    profile: merged.profile,
    summary
  };
}

export function mergeAiResumePatch(
  profile: ApplicantProfile,
  patch: AiResumeImportResponse
): AiResumeMergeResult {
  const nextProfile = cloneProfile(profile);
  const importedFields = new Set<string>();

  assignStringField(
    nextProfile.personal,
    "fullName",
    patch.personal.fullName,
    "personal.fullName",
    importedFields
  );
  assignStringField(
    nextProfile.personal,
    "firstName",
    patch.personal.firstName,
    "personal.firstName",
    importedFields
  );
  assignStringField(
    nextProfile.personal,
    "lastName",
    patch.personal.lastName,
    "personal.lastName",
    importedFields
  );
  assignStringField(
    nextProfile.personal,
    "preferredName",
    patch.personal.preferredName,
    "personal.preferredName",
    importedFields
  );
  assignStringField(
    nextProfile.personal,
    "headline",
    patch.personal.headline,
    "personal.headline",
    importedFields
  );
  assignStringField(
    nextProfile.personal,
    "summary",
    patch.personal.summary,
    "personal.summary",
    importedFields
  );

  assignStringField(
    nextProfile.contact,
    "email",
    patch.contact.email,
    "contact.email",
    importedFields
  );
  assignStringField(
    nextProfile.contact,
    "phone",
    patch.contact.phone,
    "contact.phone",
    importedFields
  );
  assignStringField(
    nextProfile.contact,
    "addressLine1",
    patch.contact.addressLine1,
    "contact.addressLine1",
    importedFields
  );
  assignStringField(
    nextProfile.contact,
    "city",
    patch.contact.city,
    "contact.city",
    importedFields
  );
  assignStringField(
    nextProfile.contact,
    "state",
    patch.contact.state,
    "contact.state",
    importedFields
  );
  assignStringField(
    nextProfile.contact,
    "postalCode",
    patch.contact.postalCode,
    "contact.postalCode",
    importedFields
  );
  assignStringField(
    nextProfile.contact,
    "country",
    patch.contact.country,
    "contact.country",
    importedFields
  );

  assignStringField(
    nextProfile.links,
    "linkedin",
    patch.links.linkedin,
    "links.linkedin",
    importedFields
  );
  assignStringField(
    nextProfile.links,
    "github",
    patch.links.github,
    "links.github",
    importedFields
  );
  assignStringField(
    nextProfile.links,
    "portfolio",
    patch.links.portfolio,
    "links.portfolio",
    importedFields
  );
  assignStringField(
    nextProfile.links,
    "website",
    patch.links.website,
    "links.website",
    importedFields
  );

  const parsedSkills = sanitizeStringArray(patch.skills, 36);
  if (parsedSkills.length > 0 && !sameStringArray(nextProfile.skills, parsedSkills)) {
    nextProfile.skills = parsedSkills;
    importedFields.add("skills");
  }

  const preferredNameFromFirstName = cleanString(
    patch.personal.preferredName || patch.personal.firstName
  );

  if (!nextProfile.personal.preferredName && preferredNameFromFirstName) {
    nextProfile.personal.preferredName = preferredNameFromFirstName;
    importedFields.add("personal.preferredName");
  }

  const authorizedCountries = sanitizeStringArray(
    patch.workAuthorization.authorizedCountries,
    5
  );
  if (
    authorizedCountries.length > 0 &&
    !sameStringArray(
      nextProfile.workAuthorization.authorizedCountries,
      authorizedCountries
    )
  ) {
    nextProfile.workAuthorization.authorizedCountries = authorizedCountries;
    importedFields.add("workAuthorization.authorizedCountries");
  }

  assignStringField(
    nextProfile.workAuthorization,
    "remoteWorkPreference",
    patch.workAuthorization.remoteWorkPreference,
    "workAuthorization.remoteWorkPreference",
    importedFields
  );
  assignStringField(
    nextProfile.workAuthorization,
    "clearanceStatus",
    patch.workAuthorization.clearanceStatus,
    "workAuthorization.clearanceStatus",
    importedFields
  );

  mergeEducationEntries(nextProfile, patch.education, importedFields);
  mergeExperienceEntries(nextProfile, patch.experience, importedFields);
  mergeProjectEntries(nextProfile, patch.projects, importedFields);
  mergeCertificationEntries(nextProfile, patch.certifications, importedFields);
  mergeTemplateEntries(nextProfile, patch.templates, importedFields);

  if (importedFields.size > 0) {
    nextProfile.updatedAt = new Date().toISOString();
  }

  return {
    profile: nextProfile,
    importedFields: Array.from(importedFields),
    warnings: dedupeStrings(patch.warnings)
  };
}

function buildAiResumePromptPayload(
  resumeText: string,
  profile: ApplicantProfile,
  baselineProfile: ApplicantProfile
) {
  return {
    task:
      "Extract a clean applicant profile from the resume text. Use empty strings or empty arrays when the resume does not provide a field.",
    extractionLimits: {
      educationMax: 4,
      experienceMax: 6,
      projectMax: 4,
      certificationMax: 6,
      skillMax: 36
    },
    currentDraftSnapshot: {
      label: profile.label,
      personal: {
        fullName: profile.personal.fullName,
        preferredName: profile.personal.preferredName,
        headline: profile.personal.headline
      },
      contact: {
        email: profile.contact.email,
        phone: profile.contact.phone
      },
      workAuthorization: {
        authorizedCountries: profile.workAuthorization.authorizedCountries,
        requiresSponsorship: profile.workAuthorization.requiresSponsorship,
        requiresFutureSponsorship:
          profile.workAuthorization.requiresFutureSponsorship,
        willingToRelocate: profile.workAuthorization.willingToRelocate
      }
    },
    localParserHints: {
      personal: baselineProfile.personal,
      contact: {
        email: baselineProfile.contact.email,
        phone: baselineProfile.contact.phone
      },
      links: baselineProfile.links,
      skills: baselineProfile.skills.slice(0, 12),
      education: baselineProfile.education.slice(0, 2),
      experience: baselineProfile.experience.slice(0, 2),
      projects: baselineProfile.projects.slice(0, 2),
      templates: baselineProfile.templates.slice(0, 4).map((template) => ({
        title: template.title,
        category: template.category,
        answer: template.answer
      }))
    },
    resumeText
  };
}

function createAiResumeResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "warnings",
      "personal",
      "contact",
      "links",
      "education",
      "experience",
      "projects",
      "skills",
      "workAuthorization",
      "certifications",
      "templates"
    ],
    properties: {
      summary: { type: "string" },
      warnings: { type: "array", items: { type: "string" } },
      personal: {
        type: "object",
        additionalProperties: false,
        required: [
          "fullName",
          "firstName",
          "lastName",
          "preferredName",
          "headline",
          "summary"
        ],
        properties: stringProperties(
          "fullName",
          "firstName",
          "lastName",
          "preferredName",
          "headline",
          "summary"
        )
      },
      contact: {
        type: "object",
        additionalProperties: false,
        required: [
          "email",
          "phone",
          "addressLine1",
          "city",
          "state",
          "postalCode",
          "country"
        ],
        properties: stringProperties(
          "email",
          "phone",
          "addressLine1",
          "city",
          "state",
          "postalCode",
          "country"
        )
      },
      links: {
        type: "object",
        additionalProperties: false,
        required: ["linkedin", "github", "portfolio", "website"],
        properties: stringProperties("linkedin", "github", "portfolio", "website")
      },
      education: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "school",
            "degree",
            "major",
            "minor",
            "gpa",
            "startDate",
            "endDate",
            "location",
            "currentlyEnrolled",
            "highlights"
          ],
          properties: {
            ...stringProperties(
              "school",
              "degree",
              "major",
              "minor",
              "gpa",
              "startDate",
              "endDate",
              "location"
            ),
            currentlyEnrolled: { type: "boolean" },
            highlights: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      },
      experience: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "company",
            "title",
            "location",
            "employmentType",
            "startDate",
            "endDate",
            "current",
            "description",
            "achievements",
            "technologies"
          ],
          properties: {
            ...stringProperties(
              "company",
              "title",
              "location",
              "employmentType",
              "startDate",
              "endDate",
              "description"
            ),
            current: { type: "boolean" },
            achievements: {
              type: "array",
              items: { type: "string" }
            },
            technologies: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      },
      projects: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "name",
            "role",
            "description",
            "technologies",
            "link",
            "startDate",
            "endDate",
            "highlights"
          ],
          properties: {
            ...stringProperties(
              "name",
              "role",
              "description",
              "link",
              "startDate",
              "endDate"
            ),
            technologies: {
              type: "array",
              items: { type: "string" }
            },
            highlights: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      },
      skills: {
        type: "array",
        items: { type: "string" }
      },
      workAuthorization: {
        type: "object",
        additionalProperties: false,
        required: [
          "authorizedCountries",
          "remoteWorkPreference",
          "clearanceStatus"
        ],
        properties: {
          authorizedCountries: {
            type: "array",
            items: { type: "string" }
          },
          ...stringProperties("remoteWorkPreference", "clearanceStatus")
        }
      },
      certifications: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "name",
            "issuer",
            "issueDate",
            "expirationDate",
            "credentialId",
            "credentialUrl"
          ],
          properties: stringProperties(
            "name",
            "issuer",
            "issueDate",
            "expirationDate",
            "credentialId",
            "credentialUrl"
          )
        }
      },
      templates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "category", "promptHints", "answer"],
          properties: {
            title: { type: "string" },
            category: {
              type: "string",
              enum: [
                "cover-note",
                "motivation",
                "salary",
                "relocation",
                "sponsorship",
                "work-authorization",
                "general"
              ]
            },
            promptHints: {
              type: "array",
              items: { type: "string" }
            },
            answer: { type: "string" }
          }
        }
      }
    }
  };
}

function stringProperties(...keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, { type: "string" }]));
}

function parseStructuredAiResumeResponse(
  raw: Record<string, unknown>
): AiResumeImportResponse {
  const outputText = extractOpenAiOutputText(raw);

  if (!outputText) {
    throw new Error("The AI resume parser returned an empty response.");
  }

  return JSON.parse(outputText) as AiResumeImportResponse;
}

function extractOpenAiOutputText(raw: Record<string, unknown>): string {
  if (typeof raw.output_text === "string" && raw.output_text.trim()) {
    return raw.output_text;
  }

  const output = Array.isArray(raw.output) ? raw.output : [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = Array.isArray((item as { content?: unknown }).content)
      ? ((item as { content: Array<Record<string, unknown>> }).content)
      : [];

    for (const part of content) {
      if (part.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
    }
  }

  return "";
}

function mergeEducationEntries(
  profile: ApplicantProfile,
  entries: AiResumeImportResponse["education"],
  importedFields: Set<string>
) {
  const parsedEntries = entries
    .map((entry, index) => toEducationEntry(entry, profile.education[index]))
    .filter((entry): entry is EducationEntry => entry !== null);

  parsedEntries.forEach((entry, index) => {
    const current = profile.education[index];
    profile.education[index] = entry;

    if (!current || JSON.stringify(current) !== JSON.stringify(entry)) {
      importedFields.add(`education[${index}]`);
    }
  });
}

function mergeExperienceEntries(
  profile: ApplicantProfile,
  entries: AiResumeImportResponse["experience"],
  importedFields: Set<string>
) {
  const parsedEntries = entries
    .map((entry, index) => toExperienceEntry(entry, profile.experience[index]))
    .filter((entry): entry is ExperienceEntry => entry !== null);

  parsedEntries.forEach((entry, index) => {
    const current = profile.experience[index];
    profile.experience[index] = entry;

    if (!current || JSON.stringify(current) !== JSON.stringify(entry)) {
      importedFields.add(`experience[${index}]`);
    }
  });
}

function mergeProjectEntries(
  profile: ApplicantProfile,
  entries: AiResumeImportResponse["projects"],
  importedFields: Set<string>
) {
  const parsedEntries = entries
    .map((entry, index) => toProjectEntry(entry, profile.projects[index]))
    .filter((entry): entry is ProjectEntry => entry !== null);

  parsedEntries.forEach((entry, index) => {
    const current = profile.projects[index];
    profile.projects[index] = entry;

    if (!current || JSON.stringify(current) !== JSON.stringify(entry)) {
      importedFields.add(`projects[${index}]`);
    }
  });
}

function mergeCertificationEntries(
  profile: ApplicantProfile,
  entries: AiResumeImportResponse["certifications"],
  importedFields: Set<string>
) {
  const parsedEntries = entries
    .map((entry, index) => toCertificationEntry(entry, profile.certifications[index]))
    .filter((entry): entry is CertificationEntry => entry !== null);

  parsedEntries.forEach((entry, index) => {
    const current = profile.certifications[index];
    profile.certifications[index] = entry;

    if (!current || JSON.stringify(current) !== JSON.stringify(entry)) {
      importedFields.add(`certifications[${index}]`);
    }
  });
}

function mergeTemplateEntries(
  profile: ApplicantProfile,
  entries: AiResumeImportResponse["templates"],
  importedFields: Set<string>
) {
  entries
    .map((entry) =>
      toTemplateEntry(
        entry,
        profile.templates.find((template) => template.category === entry.category)
      )
    )
    .filter((entry): entry is AnswerTemplate => entry !== null)
    .forEach((entry) => {
      const existingIndex = profile.templates.findIndex(
        (template) => template.category === entry.category
      );

      if (existingIndex === -1) {
        profile.templates.push(entry);
        importedFields.add(`templates.${entry.category}`);
        return;
      }

      const current = profile.templates[existingIndex];

      if (JSON.stringify(current) === JSON.stringify(entry)) {
        return;
      }

      profile.templates[existingIndex] = entry;
      importedFields.add(`templates.${entry.category}`);
    });
}

function toEducationEntry(
  entry: AiResumeImportResponse["education"][number],
  current?: EducationEntry
): EducationEntry | null {
  const normalized: EducationEntry = {
    ...(current ?? createEmptyEducationEntry()),
    id: current?.id ?? createLocalId("edu"),
    school: preferNonEmptyString(current?.school, entry.school),
    degree: preferNonEmptyString(current?.degree, entry.degree),
    major: preferNonEmptyString(current?.major, entry.major),
    minor: preferNonEmptyString(current?.minor, entry.minor),
    gpa: preferNonEmptyString(current?.gpa, entry.gpa),
    startDate: preferNonEmptyString(current?.startDate, entry.startDate),
    endDate: preferNonEmptyString(current?.endDate, entry.endDate),
    location: preferNonEmptyString(current?.location, entry.location),
    currentlyEnrolled: Boolean(current?.currentlyEnrolled || entry.currentlyEnrolled),
    highlights: preferNonEmptyArray(current?.highlights, entry.highlights, 6)
  };

  return hasMeaningfulEducationEntry(normalized)
    ? normalized
    : null;
}

function toExperienceEntry(
  entry: AiResumeImportResponse["experience"][number],
  current?: ExperienceEntry
): ExperienceEntry | null {
  const normalized: ExperienceEntry = {
    ...(current ?? createEmptyExperienceEntry()),
    id: current?.id ?? createLocalId("exp"),
    company: preferNonEmptyString(current?.company, entry.company),
    title: preferNonEmptyString(current?.title, entry.title),
    location: preferNonEmptyString(current?.location, entry.location),
    employmentType: preferNonEmptyString(
      current?.employmentType,
      entry.employmentType
    ),
    startDate: preferNonEmptyString(current?.startDate, entry.startDate),
    endDate: preferNonEmptyString(current?.endDate, entry.endDate),
    current: Boolean(current?.current || entry.current),
    description: preferNonEmptyString(current?.description, entry.description),
    achievements: preferNonEmptyArray(current?.achievements, entry.achievements, 8),
    technologies: preferNonEmptyArray(current?.technologies, entry.technologies, 16)
  };

  return hasMeaningfulExperienceEntry(normalized)
    ? normalized
    : null;
}

function toProjectEntry(
  entry: AiResumeImportResponse["projects"][number],
  current?: ProjectEntry
): ProjectEntry | null {
  const normalized: ProjectEntry = {
    ...(current ?? createEmptyProjectEntry()),
    id: current?.id ?? createLocalId("proj"),
    name: preferNonEmptyString(current?.name, entry.name),
    role: preferNonEmptyString(current?.role, entry.role),
    description: preferNonEmptyString(current?.description, entry.description),
    technologies: preferNonEmptyArray(current?.technologies, entry.technologies, 16),
    link: preferNonEmptyString(current?.link, entry.link),
    startDate: preferNonEmptyString(current?.startDate, entry.startDate),
    endDate: preferNonEmptyString(current?.endDate, entry.endDate),
    highlights: preferNonEmptyArray(current?.highlights, entry.highlights, 8)
  };

  return hasMeaningfulProjectEntry(normalized)
    ? normalized
    : null;
}

function toCertificationEntry(
  entry: AiResumeImportResponse["certifications"][number],
  current?: CertificationEntry
): CertificationEntry | null {
  const normalized: CertificationEntry = {
    ...(current ?? createEmptyCertificationEntry()),
    id: current?.id ?? createLocalId("cert"),
    name: preferNonEmptyString(current?.name, entry.name),
    issuer: preferNonEmptyString(current?.issuer, entry.issuer),
    issueDate: preferNonEmptyString(current?.issueDate, entry.issueDate),
    expirationDate: preferNonEmptyString(
      current?.expirationDate,
      entry.expirationDate
    ),
    credentialId: preferNonEmptyString(current?.credentialId, entry.credentialId),
    credentialUrl: preferNonEmptyString(
      current?.credentialUrl,
      entry.credentialUrl
    )
  };

  return hasMeaningfulCertificationEntry(normalized)
    ? normalized
    : null;
}

function toTemplateEntry(
  entry: AiResumeImportResponse["templates"][number],
  current?: AnswerTemplate
): AnswerTemplate | null {
  const answer = cleanString(entry.answer);
  const title = cleanString(entry.title);
  const category = normalizeTemplateCategory(entry.category);
  const resolvedAnswer = cleanString(current?.answer || "") || answer;

  if (!resolvedAnswer || !category) {
    return null;
  }

  return {
    id: current?.id ?? createLocalId("tmpl"),
    title: current?.title || title || createTemplateTitle(category),
    category,
    promptHints: preferNonEmptyArray(current?.promptHints, entry.promptHints, 8),
    answer: resolvedAnswer
  };
}

function assignStringField<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: string,
  importedField: string,
  importedFields: Set<string>
) {
  const nextValue = cleanString(value);

  if (typeof target[key] !== "string" || !nextValue || target[key] === nextValue) {
    return;
  }

  target[key] = nextValue as T[K];
  importedFields.add(importedField);
}

function cleanString(value: string): string {
  return value.trim();
}

function preferNonEmptyString(current: string | undefined, next: string): string {
  const normalized = cleanString(next);
  return normalized || current || "";
}

function sanitizeStringArray(values: string[], maxLength: number): string[] {
  return dedupeStrings(
    values
      .map((value) => cleanString(value))
      .filter(Boolean)
      .slice(0, maxLength)
  );
}

function preferNonEmptyArray(
  current: string[] | undefined,
  next: string[],
  maxLength: number
): string[] {
  const normalized = sanitizeStringArray(next, maxLength);
  return normalized.length > 0 ? normalized : current ?? [];
}

function dedupeStrings(values: string[]): string[] {
  return values.filter(
    (value, index) => Boolean(value) && values.indexOf(value) === index
  );
}

function sameStringArray(left: string[], right: string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createAiResumeParserLabel(baseLabel: string): string {
  return baseLabel.includes("openai") ? baseLabel : `${baseLabel}+openai`;
}

function normalizeTemplateCategory(
  value: string
): TemplateCategory | null {
  switch (value) {
    case "cover-note":
    case "motivation":
    case "salary":
    case "relocation":
    case "sponsorship":
    case "work-authorization":
    case "general":
      return value;
    default:
      return null;
  }
}

function createTemplateTitle(category: TemplateCategory): string {
  switch (category) {
    case "cover-note":
      return "AI cover note";
    case "motivation":
      return "AI motivation answer";
    case "salary":
      return "AI salary answer";
    case "relocation":
      return "AI relocation answer";
    case "sponsorship":
      return "AI sponsorship answer";
    case "work-authorization":
      return "AI work authorization answer";
    default:
      return "AI general answer";
  }
}

function hasMeaningfulEducationEntry(entry: EducationEntry): boolean {
  return Boolean(entry.school || entry.degree || entry.major || entry.location);
}

function hasMeaningfulExperienceEntry(entry: ExperienceEntry): boolean {
  return Boolean(entry.company || entry.title || entry.description);
}

function hasMeaningfulProjectEntry(entry: ProjectEntry): boolean {
  return Boolean(entry.name || entry.description || entry.link);
}

function hasMeaningfulCertificationEntry(entry: CertificationEntry): boolean {
  return Boolean(entry.name || entry.issuer || entry.credentialId);
}

function createEmptyEducationEntry(): EducationEntry {
  return {
    id: createLocalId("edu"),
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

function createEmptyExperienceEntry(): ExperienceEntry {
  return {
    id: createLocalId("exp"),
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

function createEmptyProjectEntry(): ProjectEntry {
  return {
    id: createLocalId("proj"),
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

function createEmptyCertificationEntry(): CertificationEntry {
  return {
    id: createLocalId("cert"),
    name: "",
    issuer: "",
    issueDate: "",
    expirationDate: "",
    credentialId: "",
    credentialUrl: ""
  };
}

function cloneProfile(profile: ApplicantProfile): ApplicantProfile {
  return JSON.parse(JSON.stringify(profile)) as ApplicantProfile;
}

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch (error) {
    return toErrorMessage(error);
  }
}
