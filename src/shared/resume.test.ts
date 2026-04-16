import { describe, expect, it } from "vitest";
import { createDefaultApplicantProfile } from "./core";
import { importResumeTextIntoProfile } from "./resume";
import { loadFixture } from "../test/fixture-loader";

describe("importResumeTextIntoProfile", () => {
  it("imports structured resume text into the draft profile", () => {
    const profile = createDefaultApplicantProfile();
    const fixture = loadFixture("resume-sample.txt");

    const result = importResumeTextIntoProfile(profile, fixture);

    expect(result.profile.personal.fullName).toBe("Taylor Applicant");
    expect(result.profile.contact.email).toBe("taylor.applicant@example.com");
    expect(result.profile.contact.phone).toContain("555-0100");
    expect(result.profile.links.linkedin).toContain("linkedin.com");
    expect(result.profile.skills).toContain("TypeScript");
    expect(result.profile.experience[0]?.title).toBe("Software Engineer");
    expect(result.profile.experience[0]?.company).toBe("Northwind Labs");
    expect(result.profile.education[0]?.school).toBe("State University");
    expect(result.profile.projects[0]?.name).toBe("AutoApply Tracker");
    expect(result.profile.documents.resume?.source).toBe("imported");
    expect(result.summary.importedFields).toContain("experience[0]");
    expect(result.summary.importedFields).toContain("documents.resume");
  });

  it("returns a warning when no resume text is provided", () => {
    const profile = createDefaultApplicantProfile();

    const result = importResumeTextIntoProfile(profile, "");

    expect(result.summary.importedFields).toHaveLength(0);
    expect(result.summary.warnings).toContain(
      "Paste resume text before running import."
    );
  });

  it("preserves local file metadata when imported text came from a resume file", () => {
    const profile = createDefaultApplicantProfile();
    const fixture = loadFixture("resume-sample.txt");

    const result = importResumeTextIntoProfile(profile, fixture, {
      sourceKind: "local-file",
      sourceName: "resume.docx",
      sourceMimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      parserLabel: "docx-xml",
      documentReference: {
        name: "resume.docx",
        fileName: "resume.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        source: "local"
      }
    });

    expect(result.summary.sourceKind).toBe("local-file");
    expect(result.summary.sourceName).toBe("resume.docx");
    expect(result.summary.parserLabel).toBe("docx-xml");
    expect(result.profile.documents.resume?.fileName).toBe("resume.docx");
    expect(result.profile.documents.resume?.source).toBe("local");
  });
});
