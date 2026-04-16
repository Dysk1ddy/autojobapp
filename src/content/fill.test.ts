import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultApplicantProfile, createDefaultSettings } from "../shared/core";
import { fillPage } from "./index";

describe("fillPage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "<title>Fixture</title>";
  });

  it("fills repeated experience fields with sequential profile entries", async () => {
    renderVisibleRepeatedExperienceForm();
    const profile = createProfileWithRepeatedExperience();

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/repeated",
      title: "Repeated Experience"
    });

    const companyFields = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name^="experience_company_"]')
    );
    const titleFields = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name^="experience_title_"]')
    );
    const descriptionFields = Array.from(
      document.querySelectorAll<HTMLTextAreaElement>(
        'textarea[name^="experience_description_"]'
      )
    );

    expect(companyFields.map((field) => field.value)).toEqual([
      "Northwind Labs",
      "Fabrikam Analytics"
    ]);
    expect(titleFields.map((field) => field.value)).toEqual([
      "Software Engineer",
      "Senior Platform Engineer"
    ]);
    expect(descriptionFields[1]?.value).toContain("workflow");
    expect(result.fill.filled).toBeGreaterThanOrEqual(6);
  });

  it("expands repeated sections before filling when an add button is available", async () => {
    renderExpandableExperienceForm();
    const profile = createProfileWithRepeatedExperience();

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/expandable",
      title: "Expandable Experience"
    });

    const blocks = document.querySelectorAll(".experience-block");
    const companyFields = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name^="experience_company_"]')
    );

    expect(blocks).toHaveLength(2);
    expect(companyFields.map((field) => field.value)).toEqual([
      "Northwind Labs",
      "Fabrikam Analytics"
    ]);
    expect(result.fill.filled).toBeGreaterThanOrEqual(6);
  });

  it("auto-submits when enabled and a final submit control is detected", async () => {
    let submitted = false;
    document.body.innerHTML = `
      <form>
        <section>
          <h2>Review</h2>
          <label>
            Email
            <input type="email" name="email" />
          </label>
        </section>
        <button type="submit" id="submit-application">Submit Application</button>
      </form>
    `;
    document
      .getElementById("submit-application")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        submitted = true;
      });

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/review",
      title: "Review Application",
      settings: {
        ...createDefaultSettings(),
        autoSubmit: true
      }
    });

    expect(
      (document.querySelector('input[name="email"]') as HTMLInputElement).value
    ).toBe(profile.contact.email);
    expect(submitted).toBe(true);
    expect(result.fill.autoSubmitEnabled).toBe(true);
    expect(result.fill.autoSubmitted).toBe(true);
  });

  it("fills ambiguous blanks with an AI suggestion when enabled", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Short personal note
          <textarea name="personal_note"></textarea>
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/ai-note",
      title: "AI Note",
      settings: {
        ...createDefaultSettings(),
        fillMode: "neutral"
      },
      aiSuggestions: [
        {
          fieldId: "textarea:personal_note",
          selectorHint: 'textarea[name="personal_note"]',
          label: "Short personal note",
          suggestedProfileKey: null,
          suggestedProfileLabel: "",
          suggestedValue:
            "I enjoy building tools that remove friction from complex workflows and would be excited to bring that approach to this team.",
          valuePreview:
            "I enjoy building tools that remove friction from complex workflows...",
          confidence: "medium",
          reason: "The field is open-ended and the applicant profile emphasizes workflow automation."
        }
      ]
    });

    expect(
      (document.querySelector('textarea[name="personal_note"]') as HTMLTextAreaElement)
        .value
    ).toContain("remove friction");
    expect(result.fill.aiFilled).toBe(1);
    expect(result.fill.results[0]?.fillSource).toBe("ai");
  });

  it("keeps AI-assisted fills review-first when fully auto is off", async () => {
    let submitted = false;
    document.body.innerHTML = `
      <form>
        <label>
          Short personal note
          <textarea name="personal_note"></textarea>
        </label>
        <button type="submit" id="submit-application">Submit Application</button>
      </form>
    `;
    document
      .getElementById("submit-application")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        submitted = true;
      });

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/ai-review",
      title: "AI Review Step",
      settings: {
        ...createDefaultSettings(),
        fillMode: "neutral",
        autoSubmit: true
      },
      aiSuggestions: [
        {
          fieldId: "textarea:personal_note",
          selectorHint: 'textarea[name="personal_note"]',
          label: "Short personal note",
          suggestedProfileKey: null,
          suggestedProfileLabel: "",
          suggestedValue:
            "I enjoy building tools that remove friction from complex workflows and would be excited to bring that approach to this team.",
          valuePreview:
            "I enjoy building tools that remove friction from complex workflows...",
          confidence: "medium",
          reason:
            "The field is open-ended and the applicant profile emphasizes workflow automation."
        }
      ]
    });

    expect(submitted).toBe(false);
    expect(result.fill.autoSubmitted).toBe(false);
    expect(result.fill.autoSubmitMessage).toContain("unless fully auto is enabled");
  });

  it("auto-submits AI-assisted fills when fully auto is enabled", async () => {
    let submitted = false;
    document.body.innerHTML = `
      <form>
        <label>
          Short personal note
          <textarea name="personal_note"></textarea>
        </label>
        <button type="submit" id="submit-application">Submit Application</button>
      </form>
    `;
    document
      .getElementById("submit-application")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        submitted = true;
      });

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/ai-fully-auto",
      title: "AI Fully Auto Step",
      settings: {
        ...createDefaultSettings(),
        fillMode: "neutral",
        autoSubmit: true,
        fullyAutoEnabled: true
      },
      aiSuggestions: [
        {
          fieldId: "textarea:personal_note",
          selectorHint: 'textarea[name="personal_note"]',
          label: "Short personal note",
          suggestedProfileKey: null,
          suggestedProfileLabel: "",
          suggestedValue:
            "I enjoy building tools that remove friction from complex workflows and would be excited to bring that approach to this team.",
          valuePreview:
            "I enjoy building tools that remove friction from complex workflows...",
          confidence: "medium",
          reason:
            "The field is open-ended and the applicant profile emphasizes workflow automation."
        }
      ]
    });

    expect(submitted).toBe(true);
    expect(result.fill.autoSubmitted).toBe(true);
    expect(result.fill.aiFilled).toBe(1);
  });

  it("keeps saved profile values first when AI priority is off", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Email
          <input type="email" name="email" />
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/linkedin-profile",
      title: "LinkedIn Profile",
      settings: {
        ...createDefaultSettings(),
        fillMode: "neutral"
      },
      aiSuggestions: [
        {
          fieldId: "input:email",
          selectorHint: 'input[name="email"]',
          label: "Email",
          suggestedProfileKey: "contact.email",
          suggestedProfileLabel: "Email",
          suggestedValue: "ai-generated@example.com",
          valuePreview: "ai-generated@example.com",
          confidence: "high",
          reason: "The field clearly maps to the applicant's email address."
        }
      ]
    });

    expect(
      (document.querySelector('input[name="email"]') as HTMLInputElement).value
    ).toBe(profile.contact.email);
    expect(result.fill.results[0]?.fillSource).toBe("profile");
  });

  it("can prefer AI-generated values when that setting is enabled", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Email
          <input type="email" name="email" />
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/linkedin-ai-priority",
      title: "LinkedIn AI Priority",
      settings: {
        ...createDefaultSettings(),
        fillMode: "neutral",
        aiPreferGeneratedValues: true
      },
      aiSuggestions: [
        {
          fieldId: "input:email",
          selectorHint: 'input[name="email"]',
          label: "Email",
          suggestedProfileKey: "contact.email",
          suggestedProfileLabel: "Email",
          suggestedValue: "ai-generated@example.com",
          valuePreview: "ai-generated@example.com",
          confidence: "high",
          reason: "The field clearly maps to the applicant's email address."
        }
      ]
    });

    expect(
      (document.querySelector('input[name="email"]') as HTMLInputElement).value
    ).toBe("ai-generated@example.com");
    expect(result.fill.results[0]?.fillSource).toBe("ai");
  });
});

function createProfileWithRepeatedExperience() {
  const profile = createDefaultApplicantProfile();

  profile.experience = [
    {
      ...profile.experience[0],
      id: "exp-1",
      company: "Northwind Labs",
      title: "Software Engineer",
      description:
        "Built internal recruiting and analytics tools used across operations."
    },
    {
      ...profile.experience[0],
      id: "exp-2",
      company: "Fabrikam Analytics",
      title: "Senior Platform Engineer",
      description:
        "Led workflow automation and observability improvements for hiring systems."
    }
  ];

  return profile;
}

function renderVisibleRepeatedExperienceForm() {
  document.body.innerHTML = `
    <form>
      <section>
        <h2>Work Experience</h2>
        ${createExperienceBlockHtml(1)}
        ${createExperienceBlockHtml(2)}
      </section>
    </form>
  `;
}

function renderExpandableExperienceForm() {
  document.body.innerHTML = `
    <form>
      <section>
        <h2>Work Experience</h2>
        <div id="experience-list">
          ${createExperienceBlockHtml(1)}
        </div>
        <button type="button" id="add-experience">Add another experience</button>
      </section>
    </form>
  `;

  const list = document.getElementById("experience-list");
  const button = document.getElementById("add-experience");

  button?.addEventListener("click", () => {
    if (!list) {
      return;
    }

    const nextIndex = list.querySelectorAll(".experience-block").length + 1;
    const template = document.createElement("div");
    template.innerHTML = createExperienceBlockHtml(nextIndex);
    list.appendChild(template.firstElementChild as HTMLElement);
  });
}

function createExperienceBlockHtml(index: number): string {
  return `
    <div class="experience-block">
      <label>
        Company
        <input type="text" name="experience_company_${index}" />
      </label>
      <label>
        Job title
        <input type="text" name="experience_title_${index}" />
      </label>
      <label>
        Responsibilities
        <textarea name="experience_description_${index}"></textarea>
      </label>
    </div>
  `;
}
