import { describe, expect, it } from "vitest";
import { createDefaultApplicantProfile } from "./core";
import { AiResumeImportResponse, mergeAiResumePatch } from "./resume-ai";

describe("mergeAiResumePatch", () => {
  it("maps structured AI resume data into the applicant profile", () => {
    const profile = createDefaultApplicantProfile();
    profile.templates[0].answer = "";
    const patch: AiResumeImportResponse = {
      summary: "Extracted core resume details.",
      warnings: [],
      personal: {
        fullName: "Taylor Applicant",
        firstName: "Taylor",
        lastName: "Applicant",
        preferredName: "Taylor",
        headline: "Full-stack engineer",
        summary: "Builds reliable products across frontend and backend systems."
      },
      contact: {
        email: "taylor.applicant@example.com",
        phone: "+1 555 0100",
        addressLine1: "",
        city: "Boston",
        state: "MA",
        postalCode: "",
        country: "United States"
      },
      links: {
        linkedin: "https://www.linkedin.com/in/taylor-applicant",
        github: "https://github.com/taylor-applicant",
        portfolio: "https://taylor.dev",
        website: ""
      },
      education: [
        {
          school: "State University",
          degree: "B.S. Computer Science",
          major: "Computer Science",
          minor: "",
          gpa: "",
          startDate: "2019",
          endDate: "2023",
          location: "Boston, MA",
          currentlyEnrolled: false,
          highlights: ["Dean's List"]
        }
      ],
      experience: [
        {
          company: "Northwind Labs",
          title: "Software Engineer",
          location: "Remote",
          employmentType: "Full-time",
          startDate: "2023",
          endDate: "Present",
          current: true,
          description: "Builds internal tools and hiring workflow automation.",
          achievements: ["Reduced manual application review time by 40%."],
          technologies: ["TypeScript", "React", "Node.js"]
        }
      ],
      projects: [
        {
          name: "AutoApply Tracker",
          role: "Creator",
          description: "A job application workflow dashboard.",
          technologies: ["React", "Supabase"],
          link: "https://autoapply.example.com",
          startDate: "2024",
          endDate: "",
          highlights: ["Tracked applications across multiple ATS systems."]
        }
      ],
      skills: ["TypeScript", "React", "Node.js"],
      workAuthorization: {
        authorizedCountries: ["United States"],
        remoteWorkPreference: "Remote or hybrid",
        clearanceStatus: ""
      },
      certifications: [
        {
          name: "AWS Certified Cloud Practitioner",
          issuer: "Amazon Web Services",
          issueDate: "2024",
          expirationDate: "",
          credentialId: "AWS-123",
          credentialUrl: "https://verify.example.com/aws-123"
        }
      ],
      templates: [
        {
          title: "AI cover note",
          category: "cover-note",
          promptHints: ["cover note", "introduction"],
          answer: "I build reliable application workflows and candidate-facing tools."
        }
      ]
    };

    const result = mergeAiResumePatch(profile, patch);

    expect(result.profile.personal.fullName).toBe("Taylor Applicant");
    expect(result.profile.contact.email).toBe("taylor.applicant@example.com");
    expect(result.profile.contact.city).toBe("Boston");
    expect(result.profile.links.github).toContain("github.com");
    expect(result.profile.education[0]?.school).toBe("State University");
    expect(result.profile.experience[0]?.company).toBe("Northwind Labs");
    expect(result.profile.projects[0]?.name).toBe("AutoApply Tracker");
    expect(result.profile.certifications[0]?.name).toBe(
      "AWS Certified Cloud Practitioner"
    );
    expect(result.profile.workAuthorization.remoteWorkPreference).toBe(
      "Remote or hybrid"
    );
    expect(result.profile.templates[0]?.answer).toContain("candidate-facing tools");
    expect(result.profile.skills).toContain("TypeScript");
    expect(result.importedFields).toContain("personal.headline");
    expect(result.importedFields).toContain("experience[0]");
    expect(result.importedFields).toContain("certifications[0]");
    expect(result.importedFields).toContain("templates.cover-note");
  });

  it("ignores empty AI array entries so blank filler objects do not wipe the draft", () => {
    const profile = createDefaultApplicantProfile();
    profile.experience[0].company = "Existing Co";

    const result = mergeAiResumePatch(profile, {
      summary: "",
      warnings: ["No strong project extraction."],
      personal: {
        fullName: "",
        firstName: "",
        lastName: "",
        preferredName: "",
        headline: "",
        summary: ""
      },
      contact: {
        email: "",
        phone: "",
        addressLine1: "",
        city: "",
        state: "",
        postalCode: "",
        country: ""
      },
      links: {
        linkedin: "",
        github: "",
        portfolio: "",
        website: ""
      },
      education: [],
      experience: [
        {
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
        }
      ],
      projects: [],
      skills: [],
      workAuthorization: {
        authorizedCountries: [],
        remoteWorkPreference: "",
        clearanceStatus: ""
      },
      certifications: [],
      templates: []
    });

    expect(result.profile.experience[0]?.company).toBe("Existing Co");
    expect(result.importedFields).not.toContain("experience[0]");
    expect(result.warnings).toContain("No strong project extraction.");
  });
});
