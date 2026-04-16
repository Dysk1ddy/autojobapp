import {
  ApplicantProfile,
  DocumentReference,
  ExperienceEntry,
  ProjectEntry,
  ResumeImportSummary
} from "./core";

export interface ResumeImportResult {
  profile: ApplicantProfile;
  summary: ResumeImportSummary;
}

export interface ResumeImportOptions {
  sourceKind?: ResumeImportSummary["sourceKind"];
  sourceName?: string;
  sourceMimeType?: string;
  parserLabel?: string;
  warnings?: string[];
  documentReference?: Partial<DocumentReference>;
}

export function importResumeTextIntoProfile(
  profile: ApplicantProfile,
  rawText: string,
  options: ResumeImportOptions = {}
): ResumeImportResult {
  const text = normalizeWhitespace(rawText);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sections = indexSections(lines);
  const importedFields: string[] = [];
  const warnings: string[] = [];

  if (!text.trim()) {
    return {
      profile,
      summary: {
        importedAt: new Date().toISOString(),
        sourceKind: options.sourceKind ?? "pasted-text",
        sourceName: options.sourceName ?? "Pasted resume text",
        sourceMimeType: options.sourceMimeType ?? "text/plain",
        parserLabel: options.parserLabel ?? "plain-text",
        sourcePreview: "",
        importedFields: [],
        warnings: dedupe([
          "Paste resume text before running import.",
          ...(options.warnings ?? [])
        ])
      }
    };
  }

  let nextProfile = cloneProfile(profile);

  const contact = extractContacts(lines);
  const inferredName = extractName(lines);
  const summary = extractSummary(lines, sections);
  const skills = extractSkills(lines, sections);
  const experience = extractExperience(lines, sections);
  const education = extractEducation(lines, sections);
  const project = extractProject(lines, sections);

  if (inferredName) {
    const [firstName, ...rest] = inferredName.split(" ");
    nextProfile.personal.fullName = inferredName;
    nextProfile.personal.firstName = firstName ?? nextProfile.personal.firstName;
    nextProfile.personal.lastName = rest.join(" ");
    importedFields.push("personal.fullName", "personal.firstName", "personal.lastName");
  }

  if (contact.email) {
    nextProfile.contact.email = contact.email;
    importedFields.push("contact.email");
  }

  if (contact.phone) {
    nextProfile.contact.phone = contact.phone;
    importedFields.push("contact.phone");
  }

  if (contact.linkedin) {
    nextProfile.links.linkedin = contact.linkedin;
    importedFields.push("links.linkedin");
  }

  if (contact.github) {
    nextProfile.links.github = contact.github;
    importedFields.push("links.github");
  }

  if (contact.website) {
    nextProfile.links.website = contact.website;
    importedFields.push("links.website");
  }

  if (summary) {
    nextProfile.personal.summary = summary;
    importedFields.push("personal.summary");
  }

  if (skills.length > 0) {
    nextProfile.skills = dedupe(skills);
    importedFields.push("skills");
  }

  if (education.school || education.degree || education.major) {
    nextProfile.education = [
      {
        ...nextProfile.education[0],
        id: nextProfile.education[0]?.id ?? createLocalId("edu"),
        school: education.school || nextProfile.education[0]?.school || "",
        degree: education.degree || nextProfile.education[0]?.degree || "",
        major: education.major || nextProfile.education[0]?.major || "",
        highlights:
          education.highlights.length > 0
            ? education.highlights
            : nextProfile.education[0]?.highlights || []
      }
    ];
    importedFields.push("education[0]");
  } else {
    warnings.push("Education details were not confidently extracted from the pasted resume text.");
  }

  if (experience.title || experience.company || experience.description) {
    nextProfile.experience = [
      {
        ...nextProfile.experience[0],
        id: nextProfile.experience[0]?.id ?? createLocalId("exp"),
        company: experience.company || nextProfile.experience[0]?.company || "",
        title: experience.title || nextProfile.experience[0]?.title || "",
        description:
          experience.description || nextProfile.experience[0]?.description || "",
        achievements:
          experience.achievements.length > 0
            ? experience.achievements
            : nextProfile.experience[0]?.achievements || []
      }
    ];
    importedFields.push("experience[0]");
  } else {
    warnings.push("Experience details were not confidently extracted from the pasted resume text.");
  }

  if (project.name || project.description) {
    nextProfile.projects = [
      {
        ...nextProfile.projects[0],
        id: nextProfile.projects[0]?.id ?? createLocalId("proj"),
        name: project.name || nextProfile.projects[0]?.name || "",
        description:
          project.description || nextProfile.projects[0]?.description || "",
        technologies:
          project.technologies.length > 0
            ? project.technologies
            : nextProfile.projects[0]?.technologies || []
      }
    ];
    importedFields.push("projects[0]");
  }

  nextProfile.documents.resume = {
    id:
      options.documentReference?.id ??
      nextProfile.documents.resume?.id ??
      createLocalId("resume"),
    name: options.documentReference?.name ?? options.sourceName ?? "Imported resume text",
    fileName:
      options.documentReference?.fileName ??
      (options.sourceKind === "local-file" ? options.sourceName ?? "resume-file" : "resume-paste.txt"),
    mimeType:
      options.documentReference?.mimeType ??
      options.sourceMimeType ??
      "text/plain",
    source:
      options.documentReference?.source ??
      (options.sourceKind === "local-file" ? "local" : "imported"),
    lastUpdatedAt:
      options.documentReference?.lastUpdatedAt ?? new Date().toISOString()
  };
  importedFields.push("documents.resume");

  nextProfile.updatedAt = new Date().toISOString();

  if (importedFields.length === 1 && importedFields[0] === "documents.resume") {
    warnings.unshift("No structured profile fields were confidently extracted. Review the pasted format and try again.");
  }

  return {
    profile: nextProfile,
    summary: {
      importedAt: new Date().toISOString(),
      sourceKind: options.sourceKind ?? "pasted-text",
      sourceName: options.sourceName ?? "Pasted resume text",
      sourceMimeType: options.sourceMimeType ?? "text/plain",
      parserLabel: options.parserLabel ?? "plain-text",
      sourcePreview: text.slice(0, 160),
      importedFields: dedupe(importedFields),
      warnings: dedupe([...warnings, ...(options.warnings ?? [])])
    }
  };
}

type ContactExtraction = {
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  website: string;
};

type EducationExtraction = {
  school: string;
  degree: string;
  major: string;
  highlights: string[];
};

function extractContacts(lines: string[]): ContactExtraction {
  const joined = lines.join("\n");
  const urls = joined.match(/https?:\/\/[^\s)]+/gi) ?? [];

  return {
    email: joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "",
    phone:
      joined.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.replace(/\s+/g, " ").trim() ??
      "",
    linkedin: urls.find((url) => /linkedin\.com/i.test(url)) ?? "",
    github: urls.find((url) => /github\.com/i.test(url)) ?? "",
    website:
      urls.find(
        (url) => !/linkedin\.com|github\.com/i.test(url)
      ) ?? ""
  };
}

function extractName(lines: string[]): string {
  for (const line of lines.slice(0, 4)) {
    if (
      line.length > 3 &&
      line.length < 60 &&
      !/@|http|www\.|\d{3}/i.test(line) &&
      line.split(" ").length <= 4
    ) {
      return line;
    }
  }

  return "";
}

function extractSummary(
  lines: string[],
  sections: Map<string, string[]>
): string {
  const summaryLines =
    sections.get("summary") ??
    sections.get("profile") ??
    sections.get("about");

  if (summaryLines && summaryLines.length > 0) {
    return truncate(summaryLines.join(" "), 280);
  }

  const fallback = lines.slice(1, 4).filter((line) => line.length > 40);
  return fallback.length > 0 ? truncate(fallback.join(" "), 280) : "";
}

function extractSkills(
  lines: string[],
  sections: Map<string, string[]>
): string[] {
  const skillLines =
    sections.get("skills") ??
    sections.get("technical skills") ??
    sections.get("technologies");

  if (!skillLines || skillLines.length === 0) {
    return [];
  }

  const raw = skillLines.join("\n");
  const values = raw
    .split(/[\n,|]/)
    .map((value) => value.replace(/^[-*\u2022]\s*/, "").trim())
    .filter((value) => value.length > 1 && value.length < 40);

  return dedupe(values).slice(0, 24);
}

function extractExperience(
  lines: string[],
  sections: Map<string, string[]>
): Pick<ExperienceEntry, "company" | "title" | "description" | "achievements"> {
  const experienceLines =
    sections.get("experience") ??
    sections.get("work experience") ??
    sections.get("professional experience") ??
    [];

  const sourceLines = experienceLines.length > 0 ? experienceLines : lines;
  const roleLineIndex = sourceLines.findIndex(
    (line) => !looksLikeDateLine(line) && !/^[-*\u2022]/.test(line)
  );

  if (roleLineIndex === -1) {
    return {
      company: "",
      title: "",
      description: "",
      achievements: []
    };
  }

  const firstLine = sourceLines[roleLineIndex];
  const [left, right] = splitRoleLine(firstLine);
  const detailLines = sourceLines
    .slice(roleLineIndex + 1)
    .filter((line) => !looksLikeSectionHeading(line));
  const bulletLines = detailLines
    .filter((line) => /^[-*\u2022]/.test(line))
    .map((line) => line.replace(/^[-*\u2022]\s*/, "").trim());

  return {
    company: right,
    title: left,
    description: truncate(
      detailLines.filter((line) => !looksLikeDateLine(line)).join(" "),
      360
    ),
    achievements: bulletLines.slice(0, 4)
  };
}

function extractEducation(
  lines: string[],
  sections: Map<string, string[]>
): EducationExtraction {
  const educationLines = sections.get("education") ?? [];
  const block = splitIntoBlocks(educationLines.length > 0 ? educationLines : lines)[0] ?? [];

  if (block.length === 0) {
    return {
      school: "",
      degree: "",
      major: "",
      highlights: []
    };
  }

  const school = block[0];
  const degreeLine = block.slice(1).find((line) => /bachelor|master|phd|degree|science|arts|engineering|mba/i.test(line)) ?? "";
  const majorMatch = degreeLine.match(/in\s+(.+)/i);

  return {
    school,
    degree: degreeLine,
    major: majorMatch?.[1]?.trim() ?? "",
    highlights: block.slice(2).slice(0, 3)
  };
}

function extractProject(
  lines: string[],
  sections: Map<string, string[]>
): Pick<ProjectEntry, "name" | "description" | "technologies"> {
  const projectLines =
    sections.get("projects") ??
    sections.get("project experience") ??
    [];
  const block = splitIntoBlocks(projectLines.length > 0 ? projectLines : lines)[0] ?? [];

  if (block.length === 0) {
    return {
      name: "",
      description: "",
      technologies: []
    };
  }

  return {
    name: block[0],
    description: truncate(block.slice(1).join(" "), 260),
    technologies: dedupe(
      block
        .join(" ")
        .split(/[,|]/)
        .map((part) => part.trim())
        .filter((part) => /^[A-Za-z][A-Za-z0-9+.#/\- ]{1,25}$/.test(part))
    ).slice(0, 10)
  };
}

function indexSections(lines: string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let currentKey = "root";
  let currentLines: string[] = [];

  for (const line of lines) {
    const heading = normalizeHeading(line);

    if (heading) {
      if (currentLines.length > 0) {
        sections.set(currentKey, currentLines);
      }

      currentKey = heading;
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    sections.set(currentKey, currentLines);
  }

  return sections;
}

function normalizeHeading(line: string): string {
  const normalized = line.toLowerCase().replace(/[:|]/g, "").trim();
  const headings = [
    "summary",
    "profile",
    "about",
    "skills",
    "technical skills",
    "technologies",
    "experience",
    "work experience",
    "professional experience",
    "education",
    "projects",
    "project experience"
  ];

  return headings.includes(normalized) ? normalized : "";
}

function splitIntoBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  lines.forEach((line) => {
    if (!line.trim()) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      return;
    }

    if (looksLikeNewEntry(line, current)) {
      if (current.length > 0) {
        blocks.push(current);
      }
      current = [line];
      return;
    }

    current.push(line);
  });

  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks;
}

function looksLikeNewEntry(line: string, current: string[]): boolean {
  if (current.length === 0) {
    return true;
  }

  return looksLikeDateLine(line) || (/ at | \| | - /.test(line) && line.length < 90);
}

function looksLikeDateLine(line: string): boolean {
  return /(?:19|20)\d{2}|present|current|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(
    line
  );
}

function looksLikeSectionHeading(line: string): boolean {
  return Boolean(normalizeHeading(line));
}

function splitRoleLine(line: string): [string, string] {
  const separators = [" at ", " | ", " - ", " — "];

  for (const separator of separators) {
    if (line.includes(separator)) {
      const [left, right] = line.split(separator, 2);
      return [left.trim(), right.trim()];
    }
  }

  return [line.trim(), ""];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00A0/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (!value) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function dedupe(values: string[]): string[] {
  return values.filter(
    (value, index) => Boolean(value) && values.indexOf(value) === index
  );
}

function cloneProfile(profile: ApplicantProfile): ApplicantProfile {
  return JSON.parse(JSON.stringify(profile)) as ApplicantProfile;
}

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
