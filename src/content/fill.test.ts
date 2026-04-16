import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultApplicantProfile, createDefaultSettings } from "../shared/core";
import { fillPage } from "./index";

describe("fillPage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "<title>Fixture</title>";
    installDataTransferPolyfill();
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

  it("fills a contenteditable textbox using a template-backed answer", async () => {
    document.body.innerHTML = `
      <form>
        <label id="motivation-label">Why are you interested in this role?</label>
        <div
          id="motivation-answer"
          role="textbox"
          contenteditable="true"
          aria-labelledby="motivation-label"
        ></div>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const motivationTemplate = profile.templates.find(
      (template) => template.category === "motivation"
    );

    if (motivationTemplate) {
      motivationTemplate.answer =
        "I enjoy improving hiring workflows, and this role is a strong match for that work.";
    }

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/contenteditable",
      title: "Contenteditable Motivation"
    });

    expect(
      (document.getElementById("motivation-answer") as HTMLDivElement).textContent
    ).toContain("improving hiring workflows");
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("fills a custom ARIA combobox by selecting a matching option", async () => {
    document.body.innerHTML = `
      <form>
        <label id="country-label">Country of residence</label>
        <div
          id="country-combobox"
          role="combobox"
          tabindex="0"
          aria-labelledby="country-label"
          aria-controls="country-options"
        ></div>
        <div id="country-options" role="listbox" hidden>
          <div id="country-option-us" role="option">United States</div>
          <div id="country-option-ca" role="option">Canada</div>
        </div>
      </form>
    `;

    const combobox = document.getElementById("country-combobox") as HTMLDivElement;
    const listbox = document.getElementById("country-options") as HTMLDivElement;
    const options = Array.from(
      listbox.querySelectorAll<HTMLElement>('[role="option"]')
    );

    const openListbox = () => {
      listbox.hidden = false;
    };

    combobox.addEventListener("click", openListbox);
    combobox.addEventListener("keydown", openListbox);
    options.forEach((option) => {
      option.addEventListener("click", () => {
        options.forEach((candidate) => {
          candidate.setAttribute("aria-selected", candidate === option ? "true" : "false");
        });
        combobox.textContent = option.textContent;
        combobox.setAttribute("data-value", option.textContent ?? "");
        combobox.setAttribute("aria-activedescendant", option.id);
        listbox.hidden = true;
      });
    });

    const profile = createDefaultApplicantProfile();
    profile.contact.country = "United States";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/custom-combobox",
      title: "Custom Combobox"
    });

    expect(combobox.textContent).toContain("United States");
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("fills a single affirmative checkbox from a yes/no profile value", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          <input type="checkbox" name="relocate" />
          I am willing to relocate
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.willingToRelocate = "yes";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/relocate-checkbox",
      title: "Relocate Checkbox"
    });

    expect(
      (document.querySelector('input[name="relocate"]') as HTMLInputElement).checked
    ).toBe(true);
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("fills a custom ARIA radio group", async () => {
    document.body.innerHTML = `
      <form>
        <div role="radiogroup" id="future-sponsorship-group" aria-labelledby="future-sponsorship-label">
          <div id="future-sponsorship-label">Will you require sponsorship in the future?</div>
          <div role="radio" id="future-sponsorship-yes" aria-checked="false" tabindex="0">Yes</div>
          <div role="radio" id="future-sponsorship-no" aria-checked="false" tabindex="0">No</div>
        </div>
      </form>
    `;

    const radios = Array.from(
      document.querySelectorAll<HTMLElement>('[role="radio"]')
    );

    radios.forEach((radio) => {
      radio.addEventListener("click", () => {
        radios.forEach((candidate) => {
          candidate.setAttribute("aria-checked", candidate === radio ? "true" : "false");
        });
      });
    });

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.requiresFutureSponsorship = "no";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/custom-radio",
      title: "Custom Radio"
    });

    expect(
      document.getElementById("future-sponsorship-no")?.getAttribute("aria-checked")
    ).toBe("true");
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("fills a custom checkbox group with multiple matching answers", async () => {
    document.body.innerHTML = `
      <form>
        <div role="group" id="skills-group" aria-labelledby="skills-label">
          <div id="skills-label">Skills</div>
          <div role="checkbox" id="skill-typescript" aria-checked="false" tabindex="0">TypeScript</div>
          <div role="checkbox" id="skill-react" aria-checked="false" tabindex="0">React</div>
          <div role="checkbox" id="skill-go" aria-checked="false" tabindex="0">Go</div>
        </div>
      </form>
    `;

    const checkboxes = Array.from(
      document.querySelectorAll<HTMLElement>('[role="checkbox"]')
    );

    checkboxes.forEach((checkbox) => {
      checkbox.addEventListener("click", () => {
        const nextValue = checkbox.getAttribute("aria-checked") === "true" ? "false" : "true";
        checkbox.setAttribute("aria-checked", nextValue);
      });
    });

    const profile = createDefaultApplicantProfile();
    profile.skills = ["TypeScript", "React"];

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/custom-checkboxes",
      title: "Custom Checkboxes"
    });

    expect(
      document.getElementById("skill-typescript")?.getAttribute("aria-checked")
    ).toBe("true");
    expect(
      document.getElementById("skill-react")?.getAttribute("aria-checked")
    ).toBe("true");
    expect(
      document.getElementById("skill-go")?.getAttribute("aria-checked")
    ).toBe("false");
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("fills radio and checkbox controls inside a shadow root", async () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <form>
        <div role="radiogroup" id="shadow-sponsorship-group" aria-labelledby="shadow-sponsorship-label">
          <div id="shadow-sponsorship-label">Will you require sponsorship in the future?</div>
          <div role="radio" id="shadow-sponsorship-yes" aria-checked="false" tabindex="0">Yes</div>
          <div role="radio" id="shadow-sponsorship-no" aria-checked="false" tabindex="0">No</div>
        </div>
        <div role="group" id="shadow-skills-group" aria-labelledby="shadow-skills-label">
          <div id="shadow-skills-label">Skills</div>
          <div role="checkbox" id="shadow-skill-typescript" aria-checked="false" tabindex="0">TypeScript</div>
          <div role="checkbox" id="shadow-skill-react" aria-checked="false" tabindex="0">React</div>
        </div>
      </form>
    `;

    const radios = Array.from(
      shadow.querySelectorAll<HTMLElement>('[role="radio"]')
    );
    radios.forEach((radio) => {
      radio.addEventListener("click", () => {
        radios.forEach((candidate) => {
          candidate.setAttribute("aria-checked", candidate === radio ? "true" : "false");
        });
      });
    });

    shadow.querySelectorAll<HTMLElement>('[role="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener("click", () => {
        checkbox.setAttribute(
          "aria-checked",
          checkbox.getAttribute("aria-checked") === "true" ? "false" : "true"
        );
      });
    });

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.requiresFutureSponsorship = "no";
    profile.skills = ["TypeScript"];

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/shadow-choice-controls",
      title: "Shadow Choice Controls"
    });

    expect(
      shadow.getElementById("shadow-sponsorship-no")?.getAttribute("aria-checked")
    ).toBe("true");
    expect(
      shadow.getElementById("shadow-skill-typescript")?.getAttribute("aria-checked")
    ).toBe("true");
    expect(
      shadow.getElementById("shadow-skill-react")?.getAttribute("aria-checked")
    ).toBe("false");
    expect(result.fill.filled).toBeGreaterThanOrEqual(2);
  });

  it("fills a hidden native radio group through visible labels", async () => {
    document.body.innerHTML = `
      <form>
        <div class="question">
          <div>Will you require sponsorship in the future?</div>
          <input type="radio" id="future-hidden-yes" name="future-sponsorship" style="display: none;" />
          <label for="future-hidden-yes">Yes</label>
          <input type="radio" id="future-hidden-no" name="future-sponsorship" style="display: none;" />
          <label for="future-hidden-no">No</label>
        </div>
      </form>
    `;

    const yesInput = document.getElementById("future-hidden-yes") as HTMLInputElement;
    const noInput = document.getElementById("future-hidden-no") as HTMLInputElement;
    document.querySelectorAll<HTMLLabelElement>('label[for]').forEach((label) => {
      label.addEventListener("click", () => {
        if (label.htmlFor === "future-hidden-yes") {
          yesInput.checked = true;
          noInput.checked = false;
        } else if (label.htmlFor === "future-hidden-no") {
          yesInput.checked = false;
          noInput.checked = true;
        }
      });
    });

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.requiresFutureSponsorship = "no";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/hidden-radio",
      title: "Hidden Radio"
    });

    expect(noInput.checked).toBe(true);
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("clicks visible wrappers for hidden native radio groups without labels", async () => {
    document.body.innerHTML = `
      <form>
        <div class="question">
          <div>Will you require sponsorship in the future?</div>
          <div class="choice-wrapper" id="wrapper-future-yes">
            <input type="radio" id="future-wrapper-yes" name="future-wrapper" value="Yes" style="display: none;" />
            <span>Yes</span>
          </div>
          <div class="choice-wrapper" id="wrapper-future-no">
            <input type="radio" id="future-wrapper-no" name="future-wrapper" value="No" style="display: none;" />
            <span>No</span>
          </div>
        </div>
      </form>
    `;

    const yesInput = document.getElementById("future-wrapper-yes") as HTMLInputElement;
    const noInput = document.getElementById("future-wrapper-no") as HTMLInputElement;
    let wrapperActivated = false;

    document.querySelectorAll<HTMLElement>(".choice-wrapper").forEach((wrapper) => {
      wrapper.addEventListener("click", () => {
        wrapperActivated = true;
        const chooseNo = wrapper.id === "wrapper-future-no";
        yesInput.checked = !chooseNo;
        noInput.checked = chooseNo;
      });
    });

    [yesInput, noInput].forEach((input) => {
      input.addEventListener("change", () => {
        if (!wrapperActivated) {
          yesInput.checked = false;
          noInput.checked = false;
        }

        wrapperActivated = false;
      });
    });

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.requiresFutureSponsorship = "no";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/wrapper-radio",
      title: "Wrapper Radio"
    });

    expect(noInput.checked).toBe(true);
    expect(yesInput.checked).toBe(false);
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("fills checkbox groups even when the profile has more values than the page exposes", async () => {
    document.body.innerHTML = `
      <form>
        <div class="question">
          <div>Skills</div>
          <input type="checkbox" id="skills-hidden-typescript" name="skills" style="display: none;" />
          <label for="skills-hidden-typescript">TypeScript</label>
          <input type="checkbox" id="skills-hidden-react" name="skills" style="display: none;" />
          <label for="skills-hidden-react">React</label>
          <input type="checkbox" id="skills-hidden-go" name="skills" style="display: none;" />
          <label for="skills-hidden-go">Go</label>
        </div>
      </form>
    `;

    document.querySelectorAll<HTMLLabelElement>('label[for]').forEach((label) => {
      label.addEventListener("click", () => {
        const input = document.getElementById(label.htmlFor) as HTMLInputElement | null;

        if (input) {
          input.checked = !input.checked;
        }
      });
    });

    const profile = createDefaultApplicantProfile();
    profile.skills = ["TypeScript", "React", "Node.js", "Playwright"];

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/hidden-checkboxes",
      title: "Hidden Checkboxes"
    });

    expect(
      (document.getElementById("skills-hidden-typescript") as HTMLInputElement).checked
    ).toBe(true);
    expect(
      (document.getElementById("skills-hidden-react") as HTMLInputElement).checked
    ).toBe(true);
    expect(
      (document.getElementById("skills-hidden-go") as HTMLInputElement).checked
    ).toBe(false);
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("retries a text fill when the page clears the first attempt", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Email
          <input type="email" name="email" />
        </label>
      </form>
    `;

    const emailField = document.querySelector('input[name="email"]') as HTMLInputElement;
    let clearCount = 0;

    emailField.addEventListener("input", () => {
      if (clearCount > 0) {
        return;
      }

      clearCount += 1;
      window.setTimeout(() => {
        emailField.value = "";
      }, 20);
    });

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/retry-email",
      title: "Retry Email"
    });

    expect(emailField.value).toBe(profile.contact.email);
    expect(result.fill.results[0]?.action).toBe("filled");
  });

  it("uploads a saved resume file into a detected resume file input", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Upload resume
          <input type="file" name="resume" style="display: none;" />
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    profile.documents.resume = {
      id: "resume-1",
      name: "Resume PDF",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      source: "local",
      sizeBytes: 12,
      dataBase64: "cmVzdW1lIGRhdGE=",
      lastUpdatedAt: new Date().toISOString()
    };

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/resume-upload",
      title: "Resume Upload"
    });

    const resumeInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    expect(resumeInput.files?.length).toBe(1);
    expect(resumeInput.files?.[0]?.name).toBe("resume.pdf");
    expect(result.fill.results[0]?.action).toBe("filled");
    expect(result.fill.results[0]?.fillSource).toBe("profile");
  });
});

function installDataTransferPolyfill() {
  if (typeof DataTransfer !== "undefined") {
    return;
  }

  class FakeDataTransfer {
    private readonly filesStore: File[] = [];

    readonly items = {
      add: (file: File) => {
        this.filesStore.push(file);
      }
    };

    get files(): FileList {
      const fileList = {
        length: this.filesStore.length,
        item: (index: number) => this.filesStore[index] ?? null
      } as Record<number | "length" | "item", File | number | ((index: number) => File | null)>;

      this.filesStore.forEach((file, index) => {
        fileList[index] = file;
      });

      return fileList as unknown as FileList;
    }
  }

  Object.defineProperty(globalThis, "DataTransfer", {
    configurable: true,
    writable: true,
    value: FakeDataTransfer
  });
}

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
