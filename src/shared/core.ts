export type SupportedPlatform =
  | "generic"
  | "greenhouse"
  | "lever"
  | "workday"
  | "dover"
  | "taleo"
  | "smartrecruiters"
  | "icims"
  | "unknown";

export type YesNoUnknown = "yes" | "no" | "unknown";
export type RelocationPreference = "yes" | "no" | "case-by-case";
export type TemplateCategory =
  | "cover-note"
  | "motivation"
  | "salary"
  | "relocation"
  | "sponsorship"
  | "work-authorization"
  | "general";
export type MatchConfidence = "high" | "medium" | "low" | "unmatched";
export type FillMode = "conservative" | "neutral" | "liberal";
export type AiAssistScope = "focused" | "expanded" | "aggressive";
export type FieldElementTag = "input" | "textarea" | "select" | "custom";
export type FillAction = "filled" | "skipped" | "unsupported" | "error";
export type FillSource = "profile" | "ai" | "none";
export type AiAssistStatus =
  | "disabled"
  | "missing_api_key"
  | "no_candidates"
  | "completed"
  | "error";
export type AiVerificationStatus =
  | "unverified"
  | "valid"
  | "invalid"
  | "error";

export const PROFILE_FIELD_KEYS = [
  "personal.fullName",
  "personal.firstName",
  "personal.lastName",
  "personal.preferredName",
  "personal.pronouns",
  "personal.headline",
  "personal.summary",
  "contact.email",
  "contact.phone",
  "contact.addressLine1",
  "contact.addressLine2",
  "contact.city",
  "contact.state",
  "contact.postalCode",
  "contact.country",
  "links.linkedin",
  "links.github",
  "links.portfolio",
  "links.website",
  "education.school",
  "education.degree",
  "education.major",
  "experience.company",
  "experience.title",
  "experience.location",
  "experience.description",
  "projects.name",
  "projects.description",
  "skills.list",
  "workAuthorization.authorizedCountries",
  "workAuthorization.requiresSponsorship",
  "workAuthorization.requiresFutureSponsorship",
  "workAuthorization.willingToRelocate",
  "workAuthorization.veteranStatus",
  "workAuthorization.disabilityStatus",
  "workAuthorization.gender",
  "workAuthorization.ethnicity",
  "workAuthorization.selfIdentificationLanguage",
  "workAuthorization.isAtLeast18",
  "workAuthorization.canVerifyLegalWorkRight",
  "workAuthorization.terminationHistory",
  "workAuthorization.friendsOrRelativesAtCompany",
  "workAuthorization.exportControlCitizenship",
  "workAuthorization.boardDirectorPlans",
  "workAuthorization.availabilityDate",
  "documents.resume",
  "documents.coverLetter",
  "templates.cover-note",
  "templates.motivation",
  "templates.salary",
  "templates.relocation",
  "templates.sponsorship"
] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

export interface FieldMatchBreakdown {
  high: number;
  medium: number;
  low: number;
  unmatched: number;
}

export interface DetectedFieldMatch {
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
  matchedKey: ProfileFieldKey | null;
  matchedLabel: string;
  matchedValuePreview: string;
  hasValue: boolean;
  confidence: MatchConfidence;
  score: number;
  matchedSignals: string[];
}

export interface FilledFieldResult {
  fieldId: string;
  selectorHint: string;
  label: string;
  matchedKey: ProfileFieldKey | null;
  confidence: MatchConfidence;
  action: FillAction;
  fillSource: FillSource;
  valuePreview: string;
  message: string;
}

export interface FillSummary {
  attempted: number;
  filled: number;
  skipped: number;
  unsupported: number;
  errors: number;
  aiFilled: number;
  strategy: FillMode;
  autoSubmitEnabled: boolean;
  autoSubmitted: boolean;
  autoSubmitMessage: string;
  results: FilledFieldResult[];
  filledAt: string;
}

export interface AiFieldSuggestion {
  fieldId: string;
  selectorHint: string;
  label: string;
  suggestedProfileKey: ProfileFieldKey | null;
  suggestedProfileLabel: string;
  suggestedValue: string;
  valuePreview: string;
  confidence: MatchConfidence;
  reason: string;
}

export interface AiAssistSummary {
  enabled: boolean;
  configured: boolean;
  model: string;
  status: AiAssistStatus;
  message: string;
  suggestions: AiFieldSuggestion[];
  generatedAt: string;
}

export interface AiVerificationSummary {
  configured: boolean;
  model: string;
  status: AiVerificationStatus;
  message: string;
  checkedAt: string;
  responseId: string;
}

export interface ScanSummary {
  title: string;
  url: string;
  hostname: string;
  platform: SupportedPlatform;
  adapterLabel: string;
  adapterNotes: string[];
  workflow: ApplicationWorkflowSummary;
  totalFields: number;
  visibleFields: number;
  textInputs: number;
  selects: number;
  textareas: number;
  buttons: number;
  labels: string[];
  jobSignals: string[];
  fieldMatches: DetectedFieldMatch[];
  matchBreakdown: FieldMatchBreakdown;
  aiAssist: AiAssistSummary;
  scannedAt: string;
}

export interface ApplicationWorkflowSummary {
  isMultiStepLikely: boolean;
  currentStep: string;
  detectedSteps: string[];
  nextActions: string[];
}

export interface ResumeImportSummary {
  importedAt: string;
  sourceKind: "pasted-text" | "local-file";
  sourceName: string;
  sourceMimeType: string;
  parserLabel: string;
  sourcePreview: string;
  importedFields: string[];
  warnings: string[];
}

export interface PersonalDetails {
  firstName: string;
  lastName: string;
  fullName: string;
  preferredName: string;
  pronouns: string;
  headline: string;
  summary: string;
}

export interface ContactDetails {
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface LinkDetails {
  linkedin: string;
  github: string;
  portfolio: string;
  website: string;
}

export interface EducationEntry {
  id: string;
  school: string;
  degree: string;
  major: string;
  minor: string;
  gpa: string;
  startDate: string;
  endDate: string;
  location: string;
  currentlyEnrolled: boolean;
  highlights: string[];
}

export interface ExperienceEntry {
  id: string;
  company: string;
  title: string;
  location: string;
  employmentType: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
  achievements: string[];
  technologies: string[];
}

export interface ProjectEntry {
  id: string;
  name: string;
  role: string;
  description: string;
  technologies: string[];
  link: string;
  startDate: string;
  endDate: string;
  highlights: string[];
}

export interface CertificationEntry {
  id: string;
  name: string;
  issuer: string;
  issueDate: string;
  expirationDate: string;
  credentialId: string;
  credentialUrl: string;
}

export interface DocumentReference {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  source: "local" | "imported" | "generated";
  sizeBytes: number;
  dataBase64: string;
  lastUpdatedAt: string;
}

export interface WorkAuthorizationDetails {
  authorizedCountries: string[];
  requiresSponsorship: YesNoUnknown;
  requiresFutureSponsorship: YesNoUnknown;
  willingToRelocate: RelocationPreference;
  remoteWorkPreference: string;
  veteranStatus: string;
  disabilityStatus: string;
  gender: string;
  ethnicity: string;
  selfIdentificationLanguage: string;
  isAtLeast18: YesNoUnknown;
  canVerifyLegalWorkRight: YesNoUnknown;
  terminationHistory: YesNoUnknown;
  friendsOrRelativesAtCompany: YesNoUnknown;
  exportControlCitizenship: YesNoUnknown;
  boardDirectorPlans: YesNoUnknown;
  availabilityDate: string;
  clearanceStatus: string;
}

export interface AnswerTemplate {
  id: string;
  title: string;
  category: TemplateCategory;
  promptHints: string[];
  answer: string;
}

export interface ExtensionSettings {
  darkMode: boolean;
  fillMode: FillMode;
  autoSubmit: boolean;
  fullyAutoEnabled: boolean;
  aiAssistEnabled: boolean;
  aiAssistScope: AiAssistScope;
  aiPreferGeneratedValues: boolean;
  openAiApiKey: string;
  aiAssistModel: string;
  aiCustomInstructions: string;
}

export interface ApplicantProfile {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  personal: PersonalDetails;
  contact: ContactDetails;
  links: LinkDetails;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  skills: string[];
  certifications: CertificationEntry[];
  workAuthorization: WorkAuthorizationDetails;
  documents: {
    resume: DocumentReference | null;
    coverLetter: DocumentReference | null;
    additional: DocumentReference[];
  };
  templates: AnswerTemplate[];
}

export interface ApplicantProfileSummary {
  label: string;
  filledCoreFields: number;
  totalCoreFields: number;
  educationEntries: number;
  experienceEntries: number;
  projectEntries: number;
  skillCount: number;
  certificationCount: number;
  templateCount: number;
}

export interface StoredState {
  schemaVersion: number;
  profiles: ApplicantProfile[];
  activeProfileId: string;
  settings: ExtensionSettings;
  lastScan: ScanSummary | null;
  lastFill: FillSummary | null;
  lastResumeImport: ResumeImportSummary | null;
  lastAiVerification: AiVerificationSummary | null;
  debugMode: boolean;
  lastUpdatedAt: string;
}

export interface ResumeImportRequestPayload {
  profile: ApplicantProfile;
  resumeText: string;
  sourceKind: ResumeImportSummary["sourceKind"];
  sourceName: string;
  sourceMimeType: string;
  parserLabel: string;
  warnings: string[];
  documentReference?: Partial<DocumentReference>;
  settingsOverride?: Partial<
    Pick<ExtensionSettings, "openAiApiKey" | "aiAssistModel" | "aiCustomInstructions">
  >;
}

export interface RuntimeResumeImportPayload {
  profile: ApplicantProfile;
  summary: ResumeImportSummary;
}

export type RuntimeRequest =
  | { type: "GET_STATE" }
  | { type: "SCAN_ACTIVE_TAB" }
  | { type: "FILL_ACTIVE_TAB" }
  | { type: "UPDATE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | {
      type: "VERIFY_OPENAI_KEY";
      settingsOverride?: Partial<
        Pick<ExtensionSettings, "openAiApiKey" | "aiAssistModel">
      >;
    }
  | { type: "AI_PARSE_RESUME"; payload: ResumeImportRequestPayload }
  | { type: "SET_ACTIVE_PROFILE"; profileId: string }
  | { type: "DUPLICATE_ACTIVE_PROFILE"; label?: string }
  | { type: "RESET_STATE" };

export type RuntimeResponse =
  | {
      ok: true;
      state?: StoredState;
      scan?: ScanSummary;
      fill?: FillSummary;
      resumeImport?: RuntimeResumeImportPayload;
      aiVerification?: AiVerificationSummary;
    }
  | { ok: false; error: string };

export type ContentRequest = {
  type: "JOB_APP_SCAN_PAGE";
  profile: ApplicantProfile;
  settings: ExtensionSettings;
} | {
  type: "JOB_APP_FILL_PAGE";
  profile: ApplicantProfile;
  settings: ExtensionSettings;
  aiSuggestions?: AiFieldSuggestion[];
};

export type ContentResponse =
  | { ok: true; scan?: ScanSummary; fill?: FillSummary }
  | { ok: false; error: string };

export const STORAGE_KEY = "autojobapp.state.v1";
export const CURRENT_SCHEMA_VERSION = 16;
export const DEFAULT_PROFILE_ID = "primary-profile";
export const DEFAULT_AI_ASSIST_MODEL = "gpt-4.1-mini";

export const defaultState: StoredState = createDefaultState();

export function createDefaultState(): StoredState {
  const profile = createDefaultApplicantProfile();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profiles: [profile],
    activeProfileId: profile.id,
    settings: createDefaultSettings(),
    lastScan: null,
    lastFill: null,
    lastResumeImport: null,
    lastAiVerification: null,
    debugMode: true,
    lastUpdatedAt: profile.updatedAt
  };
}

export function createDefaultSettings(): ExtensionSettings {
  return {
    darkMode: false,
    fillMode: "neutral",
    autoSubmit: false,
    fullyAutoEnabled: false,
    aiAssistEnabled: false,
    aiAssistScope: "focused",
    aiPreferGeneratedValues: false,
    openAiApiKey: "",
    aiAssistModel: DEFAULT_AI_ASSIST_MODEL,
    aiCustomInstructions: ""
  };
}

export function createDefaultAiAssistSummary(
  overrides: Partial<AiAssistSummary> = {}
): AiAssistSummary {
  return {
    enabled: false,
    configured: false,
    model: DEFAULT_AI_ASSIST_MODEL,
    status: "disabled",
    message: "AI-assisted autofill is disabled.",
    suggestions: [],
    generatedAt: createTimestamp(),
    ...overrides
  };
}

export function createDefaultAiVerificationSummary(
  overrides: Partial<AiVerificationSummary> = {}
): AiVerificationSummary {
  return {
    configured: false,
    model: DEFAULT_AI_ASSIST_MODEL,
    status: "unverified",
    message: "OpenAI API key has not been verified yet.",
    checkedAt: createTimestamp(),
    responseId: "",
    ...overrides
  };
}

export function createDefaultApplicantProfile(
  id = DEFAULT_PROFILE_ID,
  label = "Primary software profile"
): ApplicantProfile {
  const now = createTimestamp();

  return {
    id,
    label,
    createdAt: now,
    updatedAt: now,
    personal: {
      firstName: "Taylor",
      lastName: "Applicant",
      fullName: "Taylor Applicant",
      preferredName: "Taylor",
      pronouns: "they/them",
      headline: "Full-stack software engineer",
      summary:
        "Product-minded engineer with experience shipping internal tools, automation workflows, and candidate-facing web experiences."
    },
    contact: {
      email: "taylor.applicant@example.com",
      phone: "415-555-1234",
      addressLine1: "123 Example Street",
      addressLine2: "Apartment 5B",
      city: "New York",
      state: "NY",
      postalCode: "10001",
      country: "United States"
    },
    links: {
      linkedin: "https://www.linkedin.com/in/example",
      github: "https://github.com/example",
      portfolio: "https://portfolio.example.com",
      website: "https://example.com"
    },
    education: [
      {
        id: "edu-1",
        school: "State University",
        degree: "Bachelor of Science",
        major: "Computer Science",
        minor: "Mathematics",
        gpa: "3.8/4.0",
        startDate: "2019-08",
        endDate: "2023-05",
        location: "New York, NY",
        currentlyEnrolled: false,
        highlights: [
          "Relevant coursework: algorithms, operating systems, and human-computer interaction",
          "Teaching assistant for introductory programming"
        ]
      }
    ],
    experience: [
      {
        id: "exp-1",
        company: "Northwind Labs",
        title: "Software Engineer",
        location: "Remote",
        employmentType: "Full-time",
        startDate: "2023-06",
        endDate: "",
        current: true,
        description:
          "Built internal recruiting and analytics tools used by operations, recruiting, and engineering teams.",
        achievements: [
          "Reduced repetitive recruiter data entry by automating intake workflows",
          "Shipped React and TypeScript dashboards for applicant review operations"
        ],
        technologies: ["TypeScript", "React", "Node.js", "PostgreSQL"]
      }
    ],
    projects: [
      {
        id: "proj-1",
        name: "AutoApply Tracker",
        role: "Creator",
        description:
          "A personal project for organizing applications, documents, and outreach across multiple job boards.",
        technologies: ["TypeScript", "Chrome Extensions", "Vite"],
        link: "https://github.com/example/autoapply-tracker",
        startDate: "2025-01",
        endDate: "",
        highlights: [
          "Designed reusable profile and document metadata models",
          "Explored browser extension workflows for repetitive application tasks"
        ]
      }
    ],
    skills: [
      "TypeScript",
      "React",
      "Chrome Extensions",
      "Node.js",
      "REST APIs",
      "PostgreSQL",
      "Playwright",
      "Accessibility",
      "Automation",
      "Product Thinking"
    ],
    certifications: [
      {
        id: "cert-1",
        name: "AWS Certified Cloud Practitioner",
        issuer: "Amazon Web Services",
        issueDate: "2024-03",
        expirationDate: "2027-03",
        credentialId: "ABC123EXAMPLE",
        credentialUrl: "https://www.credly.com/example"
      }
    ],
    workAuthorization: {
      authorizedCountries: ["United States"],
      requiresSponsorship: "no",
      requiresFutureSponsorship: "no",
      willingToRelocate: "case-by-case",
      remoteWorkPreference: "Hybrid or remote",
      veteranStatus: "Prefer not to say",
      disabilityStatus: "Prefer not to say",
      gender: "Prefer not to self-identify",
      ethnicity: "Prefer not to self-identify",
      selfIdentificationLanguage: "",
      isAtLeast18: "unknown",
      canVerifyLegalWorkRight: "unknown",
      terminationHistory: "unknown",
      friendsOrRelativesAtCompany: "unknown",
      exportControlCitizenship: "unknown",
      boardDirectorPlans: "unknown",
      availabilityDate: "",
      clearanceStatus: "None"
    },
    documents: {
      resume: null,
      coverLetter: null,
      additional: []
    },
    templates: [
      {
        id: "tmpl-1",
        title: "Short cover note",
        category: "cover-note",
        promptHints: ["cover letter", "introduction", "short note"],
        answer:
          "I am excited to apply because this role blends product thinking, technical execution, and user empathy, which matches how I like to build."
      },
      {
        id: "tmpl-2",
        title: "Sponsorship answer",
        category: "sponsorship",
        promptHints: ["sponsorship", "visa", "work authorization"],
        answer:
          "I am currently authorized to work in the United States and do not require sponsorship."
      },
      {
        id: "tmpl-3",
        title: "Relocation answer",
        category: "relocation",
        promptHints: ["relocate", "relocation", "move"],
        answer:
          "I am open to relocation depending on the role scope, team, and location."
      },
      {
        id: "tmpl-4",
        title: "Salary answer",
        category: "salary",
        promptHints: ["salary", "compensation", "pay expectation"],
        answer:
          "I am open to discussing compensation based on the total package, responsibilities, and location."
      },
      {
        id: "tmpl-5",
        title: "Motivation answer",
        category: "motivation",
        promptHints: ["why this role", "why us", "motivation"],
        answer:
          "I am motivated by opportunities to remove friction from complex workflows and build tools that make people more effective."
      }
    ]
  };
}

export async function readState(): Promise<StoredState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeStoredState(stored[STORAGE_KEY]);
}

export async function writeState(state: StoredState): Promise<StoredState> {
  const normalized = normalizeStoredState(state);

  await chrome.storage.local.set({
    [STORAGE_KEY]: normalized
  });

  return normalized;
}

export async function ensureState(): Promise<StoredState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);

  if (!stored[STORAGE_KEY]) {
    return writeState(createDefaultState());
  }

  return writeState(normalizeStoredState(stored[STORAGE_KEY]));
}

export async function resetStoredState(): Promise<StoredState> {
  return writeState(createDefaultState());
}

export async function updateStoredState(
  updater: (state: StoredState) => StoredState
): Promise<StoredState> {
  const state = await readState();
  return writeState(updater(state));
}

export async function updateActiveProfileInStorage(
  updater: (profile: ApplicantProfile) => ApplicantProfile
): Promise<StoredState> {
  return updateStoredState((state) => {
    const activeProfile = getActiveProfile(state);
    const updatedProfile = touchProfile(updater(activeProfile));

    return touchState(invalidateProfileDerivedState({
      ...state,
      activeProfileId: updatedProfile.id,
      profiles: replaceProfile(state.profiles, updatedProfile)
    }));
  });
}

export async function saveActiveProfileAndSettingsInStorage(
  profile: ApplicantProfile,
  settings: ExtensionSettings
): Promise<StoredState> {
  return updateStoredState((state) => {
    const updatedProfile = touchProfile(profile);

    return touchState(invalidateProfileDerivedState({
      ...state,
      activeProfileId: updatedProfile.id,
      settings: normalizeExtensionSettings(settings, state.settings),
      profiles: replaceProfile(state.profiles, updatedProfile)
    }));
  });
}

export async function updateExtensionSettingsInStorage(
  updater: (settings: ExtensionSettings) => ExtensionSettings
): Promise<StoredState> {
  return updateStoredState((state) =>
    touchState({
      ...state,
      settings: normalizeExtensionSettings(updater(state.settings), state.settings)
    })
  );
}

export async function setActiveProfileInStorage(
  profileId: string
): Promise<StoredState> {
  return updateStoredState((state) => {
    if (!state.profiles.some((profile) => profile.id === profileId)) {
      return state;
    }

    return touchState(
      invalidateProfileDerivedState({
        ...state,
        activeProfileId: profileId
      })
    );
  });
}

export async function duplicateActiveProfileInStorage(
  label?: string
): Promise<StoredState> {
  return updateStoredState((state) => {
    const duplicatedProfile = duplicateApplicantProfile(
      getActiveProfile(state),
      label
    );

    return touchState(
      invalidateProfileDerivedState({
        ...state,
        activeProfileId: duplicatedProfile.id,
        profiles: [...state.profiles, duplicatedProfile]
      })
    );
  });
}

export function normalizeStoredState(raw: unknown): StoredState {
  const record = asRecord(raw);

  if (!record) {
    return createDefaultState();
  }

  if ("profileSeed" in record) {
    return migrateLegacyState(record);
  }

  const fallbackState = createDefaultState();
  const profiles = normalizeProfiles(record.profiles, fallbackState.profiles);
  const preferredActiveProfileId =
    readString(record.activeProfileId, profiles[0]?.id ?? DEFAULT_PROFILE_ID) ||
    profiles[0]?.id ||
    DEFAULT_PROFILE_ID;
  const activeProfileId = profiles.some(
    (profile) => profile.id === preferredActiveProfileId
  )
    ? preferredActiveProfileId
    : (profiles[0]?.id ?? DEFAULT_PROFILE_ID);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profiles,
    activeProfileId,
    settings: normalizeExtensionSettings(record.settings, fallbackState.settings),
    lastScan: normalizeScanSummary(record.lastScan),
    lastFill: normalizeFillSummary(record.lastFill),
    lastResumeImport: normalizeResumeImportSummary(record.lastResumeImport),
    lastAiVerification: normalizeAiVerificationSummary(record.lastAiVerification),
    debugMode: readBoolean(record.debugMode, fallbackState.debugMode),
    lastUpdatedAt: readString(
      record.lastUpdatedAt,
      profiles[0]?.updatedAt ?? fallbackState.lastUpdatedAt
    )
  };
}

export function getActiveProfile(state: StoredState): ApplicantProfile {
  return (
    state.profiles.find((profile) => profile.id === state.activeProfileId) ??
    state.profiles[0] ??
    createDefaultApplicantProfile()
  );
}

export function parseApplicantProfileJson(
  jsonText: string,
  fallback: ApplicantProfile = createDefaultApplicantProfile()
): ApplicantProfile {
  const parsed = JSON.parse(jsonText) as unknown;
  return normalizeImportedApplicantProfile(parsed, fallback);
}

export function normalizeImportedApplicantProfile(
  raw: unknown,
  fallback: ApplicantProfile = createDefaultApplicantProfile()
): ApplicantProfile {
  const record = asRecord(raw);

  if (record) {
    if ("profile" in record) {
      return normalizeApplicantProfile(record.profile, fallback);
    }

    if ("profiles" in record) {
      return getActiveProfile(normalizeStoredState(record));
    }
  }

  return normalizeApplicantProfile(raw, fallback);
}

export function serializeApplicantProfile(profile: ApplicantProfile): string {
  const normalized = normalizeApplicantProfile(
    profile,
    createDefaultApplicantProfile(profile.id, profile.label || "Imported profile")
  );

  return JSON.stringify(normalized, null, 2);
}

export function getFillModeLabel(fillMode: FillMode): string {
  switch (fillMode) {
    case "neutral":
      return "Neutral";
    case "liberal":
      return "Liberal";
    default:
      return "Conservative";
  }
}

export function getFillModeDescription(fillMode: FillMode): string {
  switch (fillMode) {
    case "neutral":
      return "Fills high and medium-confidence matches.";
    case "liberal":
      return "Fills high, medium, and low-confidence matches.";
    default:
      return "Only fills high-confidence matches.";
  }
}

export function getAiAssistScopeLabel(scope: AiAssistScope): string {
  switch (scope) {
    case "expanded":
      return "Expanded";
    case "aggressive":
      return "Aggressive";
    default:
      return "Focused";
  }
}

export function getAiAssistScopeDescription(scope: AiAssistScope): string {
  switch (scope) {
    case "expanded":
      return "AI can suggest values for any supported blank field, not just ambiguous ones.";
    case "aggressive":
      return "AI can suggest values across nearly all supported non-sensitive fields, including fields the profile matcher already understands.";
    default:
      return "AI only targets ambiguous or incomplete fields.";
  }
}

export function shouldFillConfidence(
  confidence: MatchConfidence,
  fillMode: FillMode
): boolean {
  switch (fillMode) {
    case "liberal":
      return confidence === "high" || confidence === "medium" || confidence === "low";
    case "neutral":
      return confidence === "high" || confidence === "medium";
    default:
      return confidence === "high";
  }
}

export function summarizeApplicantProfile(
  profile: ApplicantProfile
): ApplicantProfileSummary {
  const coreFields = [
    profile.personal.firstName,
    profile.personal.lastName,
    profile.personal.fullName,
    profile.personal.summary,
    profile.contact.email,
    profile.contact.phone,
    profile.contact.city,
    profile.contact.country,
    profile.links.linkedin,
    profile.links.github,
    profile.links.portfolio
  ];

  return {
    label: profile.label,
    filledCoreFields: coreFields.filter(Boolean).length,
    totalCoreFields: coreFields.length,
    educationEntries: profile.education.length,
    experienceEntries: profile.experience.length,
    projectEntries: profile.projects.length,
    skillCount: profile.skills.length,
    certificationCount: profile.certifications.length,
    templateCount: profile.templates.length
  };
}

export function detectPlatformFromHostname(hostname: string): SupportedPlatform {
  const host = hostname.toLowerCase();

  if (host.includes("greenhouse")) {
    return "greenhouse";
  }

  if (host.includes("lever")) {
    return "lever";
  }

  if (host.includes("myworkday") || host.includes("workday")) {
    return "workday";
  }

  if (host.includes("app.dover.com") || host.includes("dover.com")) {
    return "dover";
  }

  if (host.includes("taleo")) {
    return "taleo";
  }

  if (host.includes("smartrecruiters")) {
    return "smartrecruiters";
  }

  if (host.includes("icims")) {
    return "icims";
  }

  return host ? "generic" : "unknown";
}

export function isScannableUrl(url?: string): boolean {
  if (!url) {
    return false;
  }

  return url.startsWith("http://") || url.startsWith("https://");
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function sendRuntimeMessage(
  request: RuntimeRequest
): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(request) as Promise<RuntimeResponse>;
}

function migrateLegacyState(record: Record<string, unknown>): StoredState {
  const fallbackState = createDefaultState();
  const migratedProfile = migrateLegacyProfile(record.profileSeed);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profiles: [migratedProfile],
    activeProfileId: migratedProfile.id,
    settings: fallbackState.settings,
    lastScan: normalizeScanSummary(record.lastScan),
    lastFill: null,
    lastResumeImport: null,
    lastAiVerification: null,
    debugMode: readBoolean(record.debugMode, fallbackState.debugMode),
    lastUpdatedAt: migratedProfile.updatedAt
  };
}

function migrateLegacyProfile(raw: unknown): ApplicantProfile {
  const fallback = createDefaultApplicantProfile();
  const record = asRecord(raw);

  if (!record) {
    return fallback;
  }

  const personal = asRecord(record.personal);
  const links = asRecord(record.links);
  const workAuthorization = asRecord(record.workAuthorization);
  const templates = asRecord(record.templates);

  return {
    ...fallback,
    personal: {
      ...fallback.personal,
      firstName: readString(personal?.firstName, fallback.personal.firstName),
      lastName: readString(personal?.lastName, fallback.personal.lastName),
      fullName: readString(personal?.fullName, fallback.personal.fullName)
    },
    contact: {
      ...fallback.contact,
      email: readString(personal?.email, fallback.contact.email),
      phone: readString(personal?.phone, fallback.contact.phone),
      city: readString(personal?.city, fallback.contact.city),
      state: readString(personal?.state, fallback.contact.state),
      country: readString(personal?.country, fallback.contact.country)
    },
    links: {
      ...fallback.links,
      linkedin: readString(links?.linkedin, fallback.links.linkedin),
      github: readString(links?.github, fallback.links.github),
      portfolio: readString(links?.portfolio, fallback.links.portfolio)
    },
    workAuthorization: {
      ...fallback.workAuthorization,
      authorizedCountries: [
        readString(
          workAuthorization?.authorizedCountry,
          fallback.workAuthorization.authorizedCountries[0]
        )
      ],
      requiresSponsorship: normalizeYesNoUnknown(
        workAuthorization?.sponsorshipRequired,
        fallback.workAuthorization.requiresSponsorship
      )
    },
    templates: [
      ...fallback.templates.filter(
        (template) =>
          template.category !== "sponsorship" &&
          template.category !== "relocation"
      ),
      {
        id: "tmpl-legacy-sponsorship",
        title: "Sponsorship answer",
        category: "sponsorship",
        promptHints: ["sponsorship", "visa", "work authorization"],
        answer: readString(
          templates?.sponsorshipAnswer,
          getTemplateAnswer(fallback.templates, "sponsorship")
        )
      },
      {
        id: "tmpl-legacy-relocation",
        title: "Relocation answer",
        category: "relocation",
        promptHints: ["relocate", "relocation", "move"],
        answer: readString(
          templates?.relocationAnswer,
          getTemplateAnswer(fallback.templates, "relocation")
        )
      }
    ],
    updatedAt: createTimestamp()
  };
}

function normalizeProfiles(
  raw: unknown,
  fallbackProfiles: ApplicantProfile[]
): ApplicantProfile[] {
  if (!Array.isArray(raw)) {
    return fallbackProfiles;
  }

  const profiles = raw
    .map((item, index) =>
      normalizeApplicantProfile(
        item,
        createDefaultApplicantProfile(
          `${DEFAULT_PROFILE_ID}-${index + 1}`,
          `Profile ${index + 1}`
        )
      )
    )
    .filter(Boolean);

  return profiles.length > 0 ? profiles : fallbackProfiles;
}

function normalizeApplicantProfile(
  raw: unknown,
  fallback: ApplicantProfile
): ApplicantProfile {
  const record = asRecord(raw);

  if (!record) {
    return fallback;
  }

  return {
    id: readString(record.id, fallback.id),
    label: readString(record.label, fallback.label),
    createdAt: readString(record.createdAt, fallback.createdAt),
    updatedAt: readString(record.updatedAt, fallback.updatedAt),
    personal: normalizePersonalDetails(record.personal, fallback.personal),
    contact: normalizeContactDetails(record.contact, fallback.contact),
    links: normalizeLinkDetails(record.links, fallback.links),
    education: normalizeEducationEntries(record.education),
    experience: normalizeExperienceEntries(record.experience),
    projects: normalizeProjectEntries(record.projects),
    skills: readStringArray(record.skills),
    certifications: normalizeCertificationEntries(record.certifications),
    workAuthorization: normalizeWorkAuthorization(
      record.workAuthorization,
      fallback.workAuthorization
    ),
    documents: normalizeDocuments(record.documents),
    templates: normalizeTemplates(record.templates)
  };
}

function normalizePersonalDetails(
  raw: unknown,
  fallback: PersonalDetails
): PersonalDetails {
  const record = asRecord(raw);

  return {
    firstName: readString(record?.firstName, fallback.firstName),
    lastName: readString(record?.lastName, fallback.lastName),
    fullName: readString(record?.fullName, fallback.fullName),
    preferredName: readString(record?.preferredName, fallback.preferredName),
    pronouns: readString(record?.pronouns, fallback.pronouns),
    headline: readString(record?.headline, fallback.headline),
    summary: readString(record?.summary, fallback.summary)
  };
}

function normalizeContactDetails(
  raw: unknown,
  fallback: ContactDetails
): ContactDetails {
  const record = asRecord(raw);

  return {
    email: readString(record?.email, fallback.email),
    phone: readString(record?.phone, fallback.phone),
    addressLine1: readString(record?.addressLine1, fallback.addressLine1),
    addressLine2: readString(record?.addressLine2, fallback.addressLine2),
    city: readString(record?.city, fallback.city),
    state: readString(record?.state, fallback.state),
    postalCode: readString(record?.postalCode, fallback.postalCode),
    country: readString(record?.country, fallback.country)
  };
}

function normalizeLinkDetails(
  raw: unknown,
  fallback: LinkDetails
): LinkDetails {
  const record = asRecord(raw);

  return {
    linkedin: readString(record?.linkedin, fallback.linkedin),
    github: readString(record?.github, fallback.github),
    portfolio: readString(record?.portfolio, fallback.portfolio),
    website: readString(record?.website, fallback.website)
  };
}

function normalizeEducationEntries(raw: unknown): EducationEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((item, index) => {
    const record = asRecord(item);

    return {
      id: readString(record?.id, `edu-${index + 1}`),
      school: readString(record?.school),
      degree: readString(record?.degree),
      major: readString(record?.major),
      minor: readString(record?.minor),
      gpa: readString(record?.gpa),
      startDate: readString(record?.startDate),
      endDate: readString(record?.endDate),
      location: readString(record?.location),
      currentlyEnrolled: readBoolean(record?.currentlyEnrolled, false),
      highlights: readStringArray(record?.highlights)
    };
  });
}

function normalizeExperienceEntries(raw: unknown): ExperienceEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((item, index) => {
    const record = asRecord(item);

    return {
      id: readString(record?.id, `exp-${index + 1}`),
      company: readString(record?.company),
      title: readString(record?.title),
      location: readString(record?.location),
      employmentType: readString(record?.employmentType),
      startDate: readString(record?.startDate),
      endDate: readString(record?.endDate),
      current: readBoolean(record?.current, false),
      description: readString(record?.description),
      achievements: readStringArray(record?.achievements),
      technologies: readStringArray(record?.technologies)
    };
  });
}

function normalizeProjectEntries(raw: unknown): ProjectEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((item, index) => {
    const record = asRecord(item);

    return {
      id: readString(record?.id, `proj-${index + 1}`),
      name: readString(record?.name),
      role: readString(record?.role),
      description: readString(record?.description),
      technologies: readStringArray(record?.technologies),
      link: readString(record?.link),
      startDate: readString(record?.startDate),
      endDate: readString(record?.endDate),
      highlights: readStringArray(record?.highlights)
    };
  });
}

function normalizeCertificationEntries(raw: unknown): CertificationEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((item, index) => {
    const record = asRecord(item);

    return {
      id: readString(record?.id, `cert-${index + 1}`),
      name: readString(record?.name),
      issuer: readString(record?.issuer),
      issueDate: readString(record?.issueDate),
      expirationDate: readString(record?.expirationDate),
      credentialId: readString(record?.credentialId),
      credentialUrl: readString(record?.credentialUrl)
    };
  });
}

function normalizeWorkAuthorization(
  raw: unknown,
  fallback: WorkAuthorizationDetails
): WorkAuthorizationDetails {
  const record = asRecord(raw);

  return {
    authorizedCountries:
      readStringArray(record?.authorizedCountries).length > 0
        ? readStringArray(record?.authorizedCountries)
        : fallback.authorizedCountries,
    requiresSponsorship: normalizeYesNoUnknown(
      record?.requiresSponsorship,
      fallback.requiresSponsorship
    ),
    requiresFutureSponsorship: normalizeYesNoUnknown(
      record?.requiresFutureSponsorship,
      fallback.requiresFutureSponsorship
    ),
    willingToRelocate: normalizeRelocationPreference(
      record?.willingToRelocate,
      fallback.willingToRelocate
    ),
    remoteWorkPreference: readString(
      record?.remoteWorkPreference,
      fallback.remoteWorkPreference
    ),
    veteranStatus: readString(record?.veteranStatus, fallback.veteranStatus),
    disabilityStatus: readString(
      record?.disabilityStatus,
      fallback.disabilityStatus
    ),
    gender: readString(record?.gender, fallback.gender),
    ethnicity: readString(record?.ethnicity, fallback.ethnicity),
    selfIdentificationLanguage: readString(
      record?.selfIdentificationLanguage,
      fallback.selfIdentificationLanguage
    ),
    isAtLeast18: normalizeYesNoUnknown(
      record?.isAtLeast18,
      fallback.isAtLeast18
    ),
    canVerifyLegalWorkRight: normalizeYesNoUnknown(
      record?.canVerifyLegalWorkRight,
      fallback.canVerifyLegalWorkRight
    ),
    terminationHistory: normalizeYesNoUnknown(
      record?.terminationHistory,
      fallback.terminationHistory
    ),
    friendsOrRelativesAtCompany: normalizeYesNoUnknown(
      record?.friendsOrRelativesAtCompany,
      fallback.friendsOrRelativesAtCompany
    ),
    exportControlCitizenship: normalizeYesNoUnknown(
      record?.exportControlCitizenship,
      fallback.exportControlCitizenship
    ),
    boardDirectorPlans: normalizeYesNoUnknown(
      record?.boardDirectorPlans,
      fallback.boardDirectorPlans
    ),
    availabilityDate: readString(
      record?.availabilityDate,
      fallback.availabilityDate
    ),
    clearanceStatus: readString(
      record?.clearanceStatus,
      fallback.clearanceStatus
    )
  };
}

function normalizeDocuments(raw: unknown): ApplicantProfile["documents"] {
  const record = asRecord(raw);
  const additional = record?.additional;

  return {
    resume: normalizeDocumentReference(record?.resume),
    coverLetter: normalizeDocumentReference(record?.coverLetter),
    additional: Array.isArray(additional)
      ? additional
          .map((item) => normalizeDocumentReference(item))
          .filter(
            (item): item is DocumentReference => item !== null
          )
      : []
  };
}

function normalizeDocumentReference(raw: unknown): DocumentReference | null {
  const record = asRecord(raw);

  if (!record) {
    return null;
  }

  return {
    id: readString(record.id, "doc"),
    name: readString(record.name),
    fileName: readString(record.fileName),
    mimeType: readString(record.mimeType),
    source: normalizeDocumentSource(record.source),
    sizeBytes: readNumber(record.sizeBytes, 0),
    dataBase64: readString(record.dataBase64),
    lastUpdatedAt: readString(record.lastUpdatedAt, createTimestamp())
  };
}

function normalizeTemplates(raw: unknown): AnswerTemplate[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((item, index) => {
    const record = asRecord(item);

    return {
      id: readString(record?.id, `tmpl-${index + 1}`),
      title: readString(record?.title, `Template ${index + 1}`),
      category: normalizeTemplateCategory(record?.category),
      promptHints: readStringArray(record?.promptHints),
      answer: readString(record?.answer)
    };
  });
}

function normalizeScanSummary(raw: unknown): ScanSummary | null {
  const record = asRecord(raw);

  if (!record) {
    return null;
  }

  return {
    title: readString(record.title),
    url: readString(record.url),
    hostname: readString(record.hostname),
    platform: normalizeSupportedPlatform(record.platform),
    adapterLabel: readString(record.adapterLabel, "Generic adapter"),
    adapterNotes: readStringArray(record.adapterNotes),
    workflow: normalizeWorkflowSummary(record.workflow),
    totalFields: readNumber(record.totalFields),
    visibleFields: readNumber(record.visibleFields),
    textInputs: readNumber(record.textInputs),
    selects: readNumber(record.selects),
    textareas: readNumber(record.textareas),
    buttons: readNumber(record.buttons),
    labels: readStringArray(record.labels),
    jobSignals: readStringArray(record.jobSignals),
    fieldMatches: normalizeDetectedFieldMatches(record.fieldMatches),
    matchBreakdown: normalizeFieldMatchBreakdown(record.matchBreakdown),
    aiAssist: normalizeAiAssistSummary(record.aiAssist),
    scannedAt: readString(record.scannedAt, createTimestamp())
  };
}

function normalizeWorkflowSummary(raw: unknown): ApplicationWorkflowSummary {
  const record = asRecord(raw);

  return {
    isMultiStepLikely: readBoolean(record?.isMultiStepLikely, false),
    currentStep: readString(record?.currentStep),
    detectedSteps: readStringArray(record?.detectedSteps),
    nextActions: readStringArray(record?.nextActions)
  };
}

function normalizeDetectedFieldMatches(raw: unknown): DetectedFieldMatch[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((item, index) => {
    const record = asRecord(item);

    return {
      fieldId: readString(record?.fieldId, `field-${index + 1}`),
      selectorHint: readString(record?.selectorHint),
      label: readString(record?.label),
      elementTag: normalizeFieldElementTag(record?.elementTag),
      inputType: readString(record?.inputType, "text"),
      name: readString(record?.name),
      elementId: readString(record?.elementId),
      placeholder: readString(record?.placeholder),
      ariaLabel: readString(record?.ariaLabel),
      autocomplete: readString(record?.autocomplete),
      sectionHeading: readString(record?.sectionHeading),
      nearbyText: readString(record?.nearbyText),
      optionLabels: readStringArray(record?.optionLabels),
      adapterSignals: readStringArray(record?.adapterSignals),
      required: readBoolean(record?.required, false),
      matchedKey: normalizeProfileFieldKey(record?.matchedKey),
      matchedLabel: readString(record?.matchedLabel),
      matchedValuePreview: readString(record?.matchedValuePreview),
      hasValue: readBoolean(record?.hasValue, false),
      confidence: normalizeMatchConfidence(record?.confidence),
      score: readNumber(record?.score),
      matchedSignals: readStringArray(record?.matchedSignals)
    };
  });
}

function normalizeFieldMatchBreakdown(raw: unknown): FieldMatchBreakdown {
  const record = asRecord(raw);

  return {
    high: readNumber(record?.high),
    medium: readNumber(record?.medium),
    low: readNumber(record?.low),
    unmatched: readNumber(record?.unmatched)
  };
}

function normalizeFillSummary(raw: unknown): FillSummary | null {
  const record = asRecord(raw);

  if (!record) {
    return null;
  }

  return {
    attempted: readNumber(record.attempted),
    filled: readNumber(record.filled),
    skipped: readNumber(record.skipped),
    unsupported: readNumber(record.unsupported),
    errors: readNumber(record.errors),
    aiFilled: readNumber(record.aiFilled),
    strategy: normalizeFillMode(record.strategy),
    autoSubmitEnabled: readBoolean(record.autoSubmitEnabled, false),
    autoSubmitted: readBoolean(record.autoSubmitted, false),
    autoSubmitMessage: readString(record.autoSubmitMessage),
    results: normalizeFilledFieldResults(record.results),
    filledAt: readString(record.filledAt, createTimestamp())
  };
}

function normalizeExtensionSettings(
  raw: unknown,
  fallback: ExtensionSettings = createDefaultSettings()
): ExtensionSettings {
  const record = asRecord(raw);

  return {
    darkMode: readBoolean(record?.darkMode, fallback.darkMode),
    fillMode: normalizeFillMode(record?.fillMode, fallback.fillMode),
    autoSubmit: readBoolean(record?.autoSubmit, fallback.autoSubmit),
    fullyAutoEnabled: readBoolean(
      record?.fullyAutoEnabled,
      fallback.fullyAutoEnabled
    ),
    aiAssistEnabled: readBoolean(
      record?.aiAssistEnabled,
      fallback.aiAssistEnabled
    ),
    aiAssistScope: normalizeAiAssistScope(
      record?.aiAssistScope,
      fallback.aiAssistScope
    ),
    aiPreferGeneratedValues: readBoolean(
      record?.aiPreferGeneratedValues,
      fallback.aiPreferGeneratedValues
    ),
    openAiApiKey: readString(record?.openAiApiKey, fallback.openAiApiKey),
    aiAssistModel: readString(record?.aiAssistModel, fallback.aiAssistModel),
    aiCustomInstructions: readString(
      record?.aiCustomInstructions,
      fallback.aiCustomInstructions
    )
  };
}

function normalizeResumeImportSummary(raw: unknown): ResumeImportSummary | null {
  const record = asRecord(raw);

  if (!record) {
    return null;
  }

  return {
    importedAt: readString(record.importedAt, createTimestamp()),
    sourceKind: record.sourceKind === "local-file" ? "local-file" : "pasted-text",
    sourceName: readString(record.sourceName, "Resume import"),
    sourceMimeType: readString(record.sourceMimeType, "text/plain"),
    parserLabel: readString(record.parserLabel, "plain-text"),
    sourcePreview: readString(record.sourcePreview),
    importedFields: readStringArray(record.importedFields),
    warnings: readStringArray(record.warnings)
  };
}

function normalizeAiAssistSummary(raw: unknown): AiAssistSummary {
  const record = asRecord(raw);
  const fallback = createDefaultAiAssistSummary();

  return {
    enabled: readBoolean(record?.enabled, fallback.enabled),
    configured: readBoolean(record?.configured, fallback.configured),
    model: readString(record?.model, fallback.model),
    status: normalizeAiAssistStatus(record?.status),
    message: readString(record?.message, fallback.message),
    suggestions: normalizeAiFieldSuggestions(record?.suggestions),
    generatedAt: readString(record?.generatedAt, createTimestamp())
  };
}

function normalizeAiVerificationSummary(raw: unknown): AiVerificationSummary | null {
  const record = asRecord(raw);

  if (!record) {
    return null;
  }

  const fallback = createDefaultAiVerificationSummary();

  return {
    configured: readBoolean(record.configured, fallback.configured),
    model: readString(record.model, fallback.model),
    status: normalizeAiVerificationStatus(record.status),
    message: readString(record.message, fallback.message),
    checkedAt: readString(record.checkedAt, fallback.checkedAt),
    responseId: readString(record.responseId)
  };
}

function normalizeAiFieldSuggestions(raw: unknown): AiFieldSuggestion[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((item, index) => {
    const record = asRecord(item);

    return {
      fieldId: readString(record?.fieldId, `ai-field-${index + 1}`),
      selectorHint: readString(record?.selectorHint),
      label: readString(record?.label),
      suggestedProfileKey: normalizeProfileFieldKey(record?.suggestedProfileKey),
      suggestedProfileLabel: readString(record?.suggestedProfileLabel),
      suggestedValue: readString(record?.suggestedValue),
      valuePreview: readString(record?.valuePreview),
      confidence: normalizeMatchConfidence(record?.confidence),
      reason: readString(record?.reason)
    };
  });
}

function normalizeAiVerificationStatus(
  value: unknown,
  fallback: AiVerificationStatus = "unverified"
): AiVerificationStatus {
  switch (value) {
    case "valid":
    case "invalid":
    case "error":
    case "unverified":
      return value;
    default:
      return fallback;
  }
}

function normalizeFilledFieldResults(raw: unknown): FilledFieldResult[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((item, index) => {
    const record = asRecord(item);

    return {
      fieldId: readString(record?.fieldId, `filled-field-${index + 1}`),
      selectorHint: readString(record?.selectorHint),
      label: readString(record?.label),
      matchedKey: normalizeProfileFieldKey(record?.matchedKey),
      confidence: normalizeMatchConfidence(record?.confidence),
      action: normalizeFillAction(record?.action),
      fillSource: normalizeFillSource(record?.fillSource),
      valuePreview: readString(record?.valuePreview),
      message: readString(record?.message)
    };
  });
}

function replaceProfile(
  profiles: ApplicantProfile[],
  updatedProfile: ApplicantProfile
): ApplicantProfile[] {
  const existingIndex = profiles.findIndex(
    (profile) => profile.id === updatedProfile.id
  );

  if (existingIndex === -1) {
    return [...profiles, updatedProfile];
  }

  return profiles.map((profile) =>
    profile.id === updatedProfile.id ? updatedProfile : profile
  );
}

function duplicateApplicantProfile(
  profile: ApplicantProfile,
  label?: string
): ApplicantProfile {
  const duplicate = JSON.parse(JSON.stringify(profile)) as ApplicantProfile;
  const now = createTimestamp();

  return {
    ...duplicate,
    id: createProfileId(),
    label: label?.trim() || createDuplicateProfileLabel(profile.label),
    createdAt: now,
    updatedAt: now
  };
}

function createDuplicateProfileLabel(label: string): string {
  const trimmedLabel = label.trim() || "Profile";
  return trimmedLabel.toLowerCase().endsWith(" copy")
    ? `${trimmedLabel} 2`
    : `${trimmedLabel} copy`;
}

function invalidateProfileDerivedState(state: StoredState): StoredState {
  return {
    ...state,
    lastScan: null,
    lastFill: null
  };
}

function touchProfile(profile: ApplicantProfile): ApplicantProfile {
  return {
    ...profile,
    updatedAt: createTimestamp()
  };
}

function touchState(state: StoredState): StoredState {
  return {
    ...state,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    lastUpdatedAt: createTimestamp()
  };
}

function getTemplateAnswer(
  templates: AnswerTemplate[],
  category: TemplateCategory
): string {
  return templates.find((template) => template.category === category)?.answer ?? "";
}

function normalizeYesNoUnknown(
  value: unknown,
  fallback: YesNoUnknown = "unknown"
): YesNoUnknown {
  return value === "yes" || value === "no" || value === "unknown"
    ? value
    : fallback;
}

function normalizeRelocationPreference(
  value: unknown,
  fallback: RelocationPreference = "case-by-case"
): RelocationPreference {
  return value === "yes" || value === "no" || value === "case-by-case"
    ? value
    : fallback;
}

function normalizeTemplateCategory(value: unknown): TemplateCategory {
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
      return "general";
  }
}

function normalizeDocumentSource(
  value: unknown
): DocumentReference["source"] {
  return value === "local" || value === "imported" || value === "generated"
    ? value
    : "local";
}

function normalizeFillMode(
  value: unknown,
  fallback: FillMode = "conservative"
): FillMode {
  return value === "conservative" || value === "neutral" || value === "liberal"
    ? value
    : fallback;
}

function normalizeAiAssistScope(
  value: unknown,
  fallback: AiAssistScope = "focused"
): AiAssistScope {
  return value === "focused" || value === "expanded" || value === "aggressive"
    ? value
    : fallback;
}

function normalizeSupportedPlatform(value: unknown): SupportedPlatform {
  switch (value) {
    case "generic":
    case "greenhouse":
    case "lever":
    case "workday":
    case "taleo":
    case "smartrecruiters":
    case "icims":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function normalizeMatchConfidence(value: unknown): MatchConfidence {
  switch (value) {
    case "high":
    case "medium":
    case "low":
    case "unmatched":
      return value;
    default:
      return "unmatched";
  }
}

function normalizeFieldElementTag(value: unknown): FieldElementTag {
  return value === "input" || value === "textarea" || value === "select"
    ? value
    : "input";
}

function normalizeFillAction(value: unknown): FillAction {
  switch (value) {
    case "filled":
    case "skipped":
    case "unsupported":
    case "error":
      return value;
    default:
      return "skipped";
  }
}

function normalizeFillSource(value: unknown): FillSource {
  switch (value) {
    case "profile":
    case "ai":
    case "none":
      return value;
    default:
      return "none";
  }
}

function normalizeAiAssistStatus(value: unknown): AiAssistStatus {
  switch (value) {
    case "disabled":
    case "missing_api_key":
    case "no_candidates":
    case "completed":
    case "error":
      return value;
    default:
      return "disabled";
  }
}

function normalizeProfileFieldKey(value: unknown): ProfileFieldKey | null {
  return typeof value === "string" &&
    PROFILE_FIELD_KEYS.includes(value as ProfileFieldKey)
    ? (value as ProfileFieldKey)
    : null;
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function createProfileId(): string {
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
