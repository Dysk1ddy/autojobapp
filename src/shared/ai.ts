import {
  AiAssistScope,
  AiAssistSummary,
  AiFieldSuggestion,
  ApplicantProfile,
  DEFAULT_AI_ASSIST_MODEL,
  DetectedFieldMatch,
  ExtensionSettings,
  MatchConfidence,
  PROFILE_FIELD_KEYS,
  ProfileFieldKey,
  ScanSummary,
  createDefaultAiAssistSummary,
  toErrorMessage
} from "./core";
import { getProfileFieldLabel } from "./matching";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const AI_ASSIST_FIELD_LIMIT = 12;
const BLOCKED_AI_LABEL_PATTERNS = [
  "equal opportunity",
  "equal employment",
  "eeoc",
  "demographic",
  "disability",
  "veteran",
  "ethnicity",
  "race",
  "gender identity",
  "self identify",
  "self-identify",
  "date of birth",
  "social security",
  "ssn"
];

interface AiAssistCandidate {
  fieldId: string;
  selectorHint: string;
  label: string;
  elementTag: DetectedFieldMatch["elementTag"];
  inputType: string;
  placeholder: string;
  ariaLabel: string;
  sectionHeading: string;
  nearbyText: string;
  optionLabels: string[];
  required: boolean;
  currentMatch: {
    key: string;
    label: string;
    confidence: MatchConfidence;
    hasValue: boolean;
    valuePreview: string;
  };
}

interface RawAiResponse {
  summary?: string;
  suggestions?: Array<{
    fieldId?: string;
    confidence?: string;
    reason?: string;
    suggestedProfileKey?: string;
    suggestedValue?: string;
  }>;
}

export async function generateAiAssistSummary(
  scan: ScanSummary,
  profile: ApplicantProfile,
  settings: ExtensionSettings
): Promise<AiAssistSummary> {
  const model = settings.aiAssistModel.trim() || DEFAULT_AI_ASSIST_MODEL;
  const apiKey = settings.openAiApiKey.trim();
  const customInstructions = settings.aiCustomInstructions.trim();

  if (!settings.aiAssistEnabled) {
    return createDefaultAiAssistSummary({
      model,
      configured: Boolean(apiKey)
    });
  }

  if (!apiKey) {
    return createDefaultAiAssistSummary({
      enabled: true,
      configured: false,
      model,
      status: "missing_api_key",
      message: "AI assist is enabled, but no OpenAI API key is saved yet."
    });
  }

  const candidates = selectAiAssistCandidates(
    scan.fieldMatches,
    settings.aiAssistScope
  );

  if (candidates.length === 0) {
    return createDefaultAiAssistSummary({
      enabled: true,
      configured: true,
      model,
      status: "no_candidates",
      message: getNoCandidateMessage(settings.aiAssistScope)
    });
  }

  try {
    const requestInput = [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You help a user autofill job application forms. Suggest values only when the applicant profile and field context support them. Do not fabricate protected-class, EEO, disability, veteran, race, ethnicity, social security, or date-of-birth answers. If a field is too ambiguous, omit it. When option labels are present, suggestedValue should match one of the options as closely as possible. Keep open-ended answers concise and grounded in the provided templates, profile summary, experience, and skills."
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
            text: `Additional user instructions for AI autofill: ${customInstructions}`
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
            buildAiAssistPromptPayload(scan, profile, candidates, settings)
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
        max_output_tokens: 1400,
        input: requestInput,
        text: {
          format: {
            type: "json_schema",
            name: "job_application_ai_suggestions",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["summary", "suggestions"],
              properties: {
                summary: {
                  type: "string",
                  description: "A short summary of what was or was not suggested."
                },
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "fieldId",
                      "confidence",
                      "reason",
                      "suggestedProfileKey",
                      "suggestedValue"
                    ],
                    properties: {
                      fieldId: {
                        type: "string"
                      },
                      confidence: {
                        type: "string",
                        enum: ["high", "medium", "low"]
                      },
                      reason: {
                        type: "string"
                      },
                      suggestedProfileKey: {
                        type: "string"
                      },
                      suggestedValue: {
                        type: "string"
                      }
                    }
                  }
                }
              }
            }
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
    const parsed = parseStructuredAiResponse(rawResponse);
    const suggestions = normalizeAiSuggestions(
      parsed.suggestions ?? [],
      candidates
    );

    return createDefaultAiAssistSummary({
      enabled: true,
      configured: true,
      model,
      status: "completed",
      message:
        parsed.summary?.trim() ||
        (suggestions.length > 0
          ? `Generated ${suggestions.length} AI suggestion${suggestions.length === 1 ? "" : "s"}.`
          : "The AI model did not return any actionable suggestions."),
      suggestions
    });
  } catch (error) {
    return createDefaultAiAssistSummary({
      enabled: true,
      configured: true,
      model,
      status: "error",
      message: `AI assist failed: ${toErrorMessage(error)}`
    });
  }
}

function buildAiAssistPromptPayload(
  scan: ScanSummary,
  profile: ApplicantProfile,
  candidates: AiAssistCandidate[],
  settings: ExtensionSettings
) {
  return {
    application: {
      title: scan.title,
      platform: scan.platform,
      workflow: scan.workflow,
      jobSignals: scan.jobSignals
    },
    applicantProfile: {
      personal: profile.personal,
      contact: {
        email: profile.contact.email,
        phone: profile.contact.phone,
        city: profile.contact.city,
        state: profile.contact.state,
        country: profile.contact.country
      },
      links: profile.links,
      education: profile.education.slice(0, 3).map((entry) => ({
        school: entry.school,
        degree: entry.degree,
        major: entry.major,
        location: entry.location
      })),
      experience: profile.experience.slice(0, 4).map((entry) => ({
        company: entry.company,
        title: entry.title,
        location: entry.location,
        description: entry.description,
        achievements: entry.achievements.slice(0, 3),
        technologies: entry.technologies.slice(0, 8)
      })),
      projects: profile.projects.slice(0, 3).map((entry) => ({
        name: entry.name,
        role: entry.role,
        description: entry.description,
        technologies: entry.technologies.slice(0, 8)
      })),
      skills: profile.skills.slice(0, 24),
      workAuthorization: profile.workAuthorization,
      templates: profile.templates.map((template) => ({
        title: template.title,
        category: template.category,
        answer: template.answer
      }))
    },
    allowedProfileKeys: PROFILE_FIELD_KEYS,
    aiControl: {
      scope: settings.aiAssistScope,
      preferGeneratedValues: settings.aiPreferGeneratedValues
    },
    candidates
  };
}

function selectAiAssistCandidates(
  fieldMatches: DetectedFieldMatch[],
  scope: AiAssistScope
): AiAssistCandidate[] {
  return fieldMatches
    .filter((match) => !isBlockedAiField(match))
    .filter((match) => match.inputType !== "file")
    .filter((match) => shouldIncludeInAiScope(match, scope))
    .slice(0, AI_ASSIST_FIELD_LIMIT)
    .map((match) => ({
      fieldId: match.fieldId,
      selectorHint: match.selectorHint,
      label: match.label,
      elementTag: match.elementTag,
      inputType: match.inputType,
      placeholder: match.placeholder,
      ariaLabel: match.ariaLabel,
      sectionHeading: match.sectionHeading,
      nearbyText: match.nearbyText,
      optionLabels: match.optionLabels,
      required: match.required,
      currentMatch: {
        key: match.matchedKey ?? "",
        label: match.matchedLabel,
        confidence: match.confidence,
        hasValue: match.hasValue,
        valuePreview: match.matchedValuePreview
      }
    }));
}

function shouldIncludeInAiScope(
  match: DetectedFieldMatch,
  scope: AiAssistScope
): boolean {
  switch (scope) {
    case "aggressive":
      return true;
    case "expanded":
      return (
        match.elementTag === "textarea" ||
        isTextLikeAiField(match.inputType) ||
        !match.hasValue ||
        match.confidence !== "high"
      );
    default:
      return match.confidence !== "high" || !match.hasValue;
  }
}

function isTextLikeAiField(inputType: string): boolean {
  return !["checkbox", "radio", "file", "hidden", "submit"].includes(inputType);
}

function getNoCandidateMessage(scope: AiAssistScope): string {
  switch (scope) {
    case "aggressive":
      return "No supported non-sensitive fields were eligible for aggressive AI assistance on this page.";
    case "expanded":
      return "No supported blank or review-needed fields were eligible for expanded AI assistance on this page.";
    default:
      return "No ambiguous blank fields were strong candidates for AI assistance.";
  }
}

function isBlockedAiField(match: DetectedFieldMatch): boolean {
  const searchable = normalizeSearchText(
    [
      match.label,
      match.sectionHeading,
      match.nearbyText,
      match.placeholder,
      match.ariaLabel
    ].join(" ")
  );

  return BLOCKED_AI_LABEL_PATTERNS.some((pattern) =>
    searchable.includes(normalizeSearchText(pattern))
  );
}

function normalizeAiSuggestions(
  suggestions: NonNullable<RawAiResponse["suggestions"]>,
  candidates: AiAssistCandidate[]
): AiFieldSuggestion[] {
  const candidateByFieldId = new Map(
    candidates.map((candidate) => [candidate.fieldId, candidate])
  );

  return suggestions
    .map((suggestion) => {
      const candidate = candidateByFieldId.get((suggestion.fieldId ?? "").trim());
      const suggestedValue = (suggestion.suggestedValue ?? "").trim();

      if (!candidate || !suggestedValue) {
        return null;
      }

      const suggestedProfileKey = normalizeSuggestedProfileKey(
        suggestion.suggestedProfileKey
      );

      return {
        fieldId: candidate.fieldId,
        selectorHint: candidate.selectorHint,
        label: candidate.label || candidate.selectorHint,
        suggestedProfileKey,
        suggestedProfileLabel: suggestedProfileKey
          ? getProfileFieldLabel(suggestedProfileKey)
          : "",
        suggestedValue,
        valuePreview: truncatePreview(suggestedValue),
        confidence: normalizeAiConfidence(suggestion.confidence),
        reason: (suggestion.reason ?? "").trim()
      } satisfies AiFieldSuggestion;
    })
    .filter((suggestion): suggestion is AiFieldSuggestion => suggestion !== null);
}

function normalizeSuggestedProfileKey(
  value: string | undefined
): ProfileFieldKey | null {
  return typeof value === "string" &&
    PROFILE_FIELD_KEYS.includes(value as ProfileFieldKey)
    ? (value as ProfileFieldKey)
    : null;
}

function normalizeAiConfidence(value: string | undefined): MatchConfidence {
  switch (value) {
    case "high":
    case "medium":
    case "low":
      return value;
    default:
      return "low";
  }
}

function parseStructuredAiResponse(raw: Record<string, unknown>): RawAiResponse {
  const outputText = extractOpenAiOutputText(raw);

  if (!outputText) {
    return {};
  }

  return JSON.parse(outputText) as RawAiResponse;
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

function truncatePreview(value: string, maxLength = 96): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}
