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

  it("fills input-based combobox dropdowns like Micron screening questions", async () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <label id="board-directors-label" for="board-directors-combobox">
            Do you have any plans to join the board of directors of a for-profit company prior to starting a job with Micron?
          </label>
          <div class="select-wrapper">
            <input
              id="board-directors-combobox"
              type="text"
              role="combobox"
              aria-labelledby="board-directors-label"
              aria-controls="board-directors-options"
              aria-expanded="false"
              placeholder="Select"
              value=""
            />
          </div>
          <ul id="board-directors-options" role="listbox" hidden>
            <li role="presentation">
              <button type="button" role="option" aria-selected="false">Unknown</button>
            </li>
            <li role="presentation">
              <button type="button" role="option" aria-selected="false">Yes</button>
            </li>
            <li role="presentation">
              <button type="button" role="option" aria-selected="false">No</button>
            </li>
          </ul>
        </fieldset>
        <fieldset>
          <label id="legal-right-label" for="legal-right-combobox">
            If employment is offered, can you submit verification of your legal right to work at a Micron affiliated company in the country to which you have applied?
          </label>
          <div class="select-wrapper">
            <input
              id="legal-right-combobox"
              type="text"
              role="combobox"
              aria-labelledby="legal-right-label"
              aria-controls="legal-right-options"
              aria-expanded="false"
              placeholder="Select"
              value=""
            />
          </div>
          <ul id="legal-right-options" role="listbox" hidden>
            <li role="presentation">
              <button type="button" role="option" aria-selected="false">Unknown</button>
            </li>
            <li role="presentation">
              <button type="button" role="option" aria-selected="false">Yes</button>
            </li>
            <li role="presentation">
              <button type="button" role="option" aria-selected="false">No</button>
            </li>
          </ul>
        </fieldset>
      </form>
    `;

    const registerCombobox = (inputId: string, listId: string) => {
      const input = document.getElementById(inputId) as HTMLInputElement;
      const list = document.getElementById(listId) as HTMLUListElement;
      const options = Array.from(
        list.querySelectorAll<HTMLButtonElement>('[role="option"]')
      );

      const open = () => {
        input.setAttribute("aria-expanded", "true");
        list.hidden = false;
      };

      const close = () => {
        input.setAttribute("aria-expanded", "false");
        list.hidden = true;
      };

      input.addEventListener("click", open);
      input.addEventListener("keydown", open);
      options.forEach((option) => {
        option.addEventListener("click", () => {
          options.forEach((candidate) => {
            candidate.setAttribute(
              "aria-selected",
              candidate === option ? "true" : "false"
            );
          });
          input.value = option.textContent?.trim() ?? "";
          input.setAttribute("aria-activedescendant", option.id || "");
          close();
        });
      });
    };

    registerCombobox("board-directors-combobox", "board-directors-options");
    registerCombobox("legal-right-combobox", "legal-right-options");

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.boardDirectorPlans = "unknown";
    profile.workAuthorization.canVerifyLegalWorkRight = "unknown";

    const result = await fillPage(profile, {
      href: "https://careers.micron.com/careers/apply?pid=39953835",
      title: "Micron Screening"
    });

    expect(
      (document.getElementById("board-directors-combobox") as HTMLInputElement).value
    ).toBe("No");
    expect(
      (document.getElementById("legal-right-combobox") as HTMLInputElement).value
    ).toBe("Yes");
    expect(result.fill.filled).toBeGreaterThanOrEqual(2);
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

  it("fills Dover-style yes/no button groups and GitHub URL fields", async () => {
    document.body.innerHTML = `
      <form data-testid="dover-application-form">
        <div data-testid="github-field">
          <p>GitHub URL</p>
          <input type="url" name="githubProfileUrl" />
        </div>
        <div data-testid="sponsorship-question">
          <p>Will you require sponsorship now or in the future to work in the United States?</p>
          <div class="button-row">
            <button type="button" id="dover-sponsorship-yes" aria-pressed="false">Yes</button>
            <button type="button" id="dover-sponsorship-no" aria-pressed="false">No</button>
          </div>
        </div>
      </form>
    `;

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".button-row button"));
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        buttons.forEach((candidate) => {
          candidate.setAttribute("aria-pressed", candidate === button ? "true" : "false");
          candidate.setAttribute("data-state", candidate === button ? "checked" : "unchecked");
        });
      });
    });

    const profile = createDefaultApplicantProfile();
    profile.links.github = "https://github.com/taylor-applicant";
    profile.workAuthorization.requiresFutureSponsorship = "no";

    const result = await fillPage(profile, {
      href: "https://app.dover.com/apply/acme/123",
      title: "Dover Application"
    });

    expect(
      (document.querySelector('input[name=\"githubProfileUrl\"]') as HTMLInputElement).value
    ).toBe("https://github.com/taylor-applicant");
    expect(
      document.getElementById("dover-sponsorship-no")?.getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      document.getElementById("dover-sponsorship-yes")?.getAttribute("aria-pressed")
    ).toBe("false");
    expect(result.fill.filled).toBeGreaterThanOrEqual(2);
  });

  it("auto-selects ethnicity dropdown fields", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Ethnicity
          <select name="ethnicity">
            <option value="">Select one</option>
            <option value="latino">Hispanic or Latino</option>
            <option value="not-listed">Not Hispanic or Latino</option>
            <option value="decline">Prefer not to answer</option>
          </select>
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.ethnicity = "Prefer not to self-identify";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/ethnicity-select",
      title: "Ethnicity Select"
    });

    const select = document.querySelector('select[name="ethnicity"]') as HTMLSelectElement;
    expect(select.value).toBe("decline");
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("auto-clicks ethnicity radio requests", async () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Please identify your ethnicity</legend>
          <label>
            <input type="radio" name="ethnicity-request" value="Hispanic or Latino" />
            Hispanic or Latino
          </label>
          <label>
            <input type="radio" name="ethnicity-request" value="Not Hispanic or Latino" />
            Not Hispanic or Latino
          </label>
          <label>
            <input type="radio" name="ethnicity-request" value="Prefer not to answer" />
            Prefer not to answer
          </label>
        </fieldset>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.ethnicity = "Prefer not to self-identify";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/ethnicity-radio",
      title: "Ethnicity Radio"
    });

    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="ethnicity-request"]')
    );
    expect(radios.find((radio) => radio.value === "Prefer not to answer")?.checked).toBe(true);
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("maps prefer-not-to-self-identify answers onto declined-to-state ethnicity radios", async () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Ethnicity</legend>
          <label>
            <input type="radio" name="ethnicity-request" value="tmr" />
            Two or More Races
          </label>
          <label>
            <input type="radio" name="ethnicity-request" value="declined" />
            Declined to state
          </label>
          <label>
            <input type="radio" name="ethnicity-request" value="white" />
            White
          </label>
        </fieldset>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.ethnicity = "Prefer not to self-identify";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/ethnicity-radio-declined",
      title: "Ethnicity Radio Declined"
    });

    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="ethnicity-request"]')
    );
    expect(radios.find((radio) => radio.value === "declined")?.checked).toBe(true);
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("fills Micron-style screening dropdowns even when option values are coded", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Self Identification Language
          <select name="self_identification_language">
            <option value="">Select</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
          </select>
        </label>
        <label>
          Are you at least 18 years old?
          <select name="age_requirement">
            <option value="">Select</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </label>
        <label>
          If employment is offered, can you submit verification of your legal right to work at a Micron affiliated company in the country to which you have applied?
          <select name="legal_right_to_work">
            <option value="">Select</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </label>
        <label>
          Have you ever been terminated or asked to resign by any former employer for the following reasons:
          <select name="termination_history">
            <option value="">Select</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </label>
        <label>
          Do you have any friends/relatives presently employed by Micron?
          <select name="friends_or_relatives">
            <option value="">Select</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </label>
        <label>
          All Micron sites must observe U.S. export control rules that control information that may be provided to persons from Cuba, Iran, North Korea, and Syria. Are you a citizen of, or do you hold dual citizenship with any of these countries?
          <select name="export_control_citizenship">
            <option value="">Select</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </label>
        <label>
          Do you have any plans to join the board of directors of a for-profit company prior to starting a job with Micron?
          <select name="board_of_directors">
            <option value="">Select</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.selfIdentificationLanguage = "English";
    profile.workAuthorization.isAtLeast18 = "yes";
    profile.workAuthorization.canVerifyLegalWorkRight = "yes";
    profile.workAuthorization.terminationHistory = "no";
    profile.workAuthorization.friendsOrRelativesAtCompany = "no";
    profile.workAuthorization.exportControlCitizenship = "no";
    profile.workAuthorization.boardDirectorPlans = "no";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/micron-screening",
      title: "Micron Screening"
    });

    expect(
      (document.querySelector(
        'select[name="self_identification_language"]'
      ) as HTMLSelectElement).value
    ).toBe("en");
    expect(
      (document.querySelector('select[name="age_requirement"]') as HTMLSelectElement)
        .value
    ).toBe("N");
    expect(
      (document.querySelector(
        'select[name="legal_right_to_work"]'
      ) as HTMLSelectElement).value
    ).toBe("Y");
    expect(
      (document.querySelector(
        'select[name="termination_history"]'
      ) as HTMLSelectElement).value
    ).toBe("N");
    expect(
      (document.querySelector(
        'select[name="friends_or_relatives"]'
      ) as HTMLSelectElement).value
    ).toBe("N");
    expect(
      (document.querySelector(
        'select[name="export_control_citizenship"]'
      ) as HTMLSelectElement).value
    ).toBe("N");
    expect(
      (document.querySelector(
        'select[name="board_of_directors"]'
      ) as HTMLSelectElement).value
    ).toBe("N");
    expect(result.fill.filled).toBeGreaterThanOrEqual(7);
  });

  it("defaults unknown yes-no screening dropdowns to no", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Have you signed a restrictive covenant that could affect this role?
          <select name="restrictive_covenant">
            <option value="">Select</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/generic-yes-no-dropdown",
      title: "Generic Yes No Dropdown"
    });

    expect(
      (document.querySelector(
        'select[name="restrictive_covenant"]'
      ) as HTMLSelectElement).value
    ).toBe("N");
    expect(result.fill.results[0]?.message).toContain("default yes/no policy");
  });

  it("overrides unknown defaults on matched screening dropdowns and still picks no", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Do you have any plans to join the board of directors of a for-profit company prior to starting a job with Micron?
          <select name="board_of_directors">
            <option value="U">Unknown</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </label>
        <label>
          All Micron sites must observe U.S. export control rules that control information that may be provided to persons from Cuba, Iran, North Korea, and Syria. Are you a citizen of, or do you hold dual citizenship with any of these countries?
          <select name="export_control_citizenship">
            <option value="U">Unknown</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.boardDirectorPlans = "unknown";
    profile.workAuthorization.exportControlCitizenship = "unknown";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/unknown-defaults",
      title: "Unknown Default Screening"
    });

    expect(
      (document.querySelector(
        'select[name="board_of_directors"]'
      ) as HTMLSelectElement).value
    ).toBe("N");
    expect(
      (document.querySelector(
        'select[name="export_control_citizenship"]'
      ) as HTMLSelectElement).value
    ).toBe("N");
    expect(result.fill.filled).toBeGreaterThanOrEqual(2);
  });

  it("defaults authorization-style yes-no questions to yes", async () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Are you legally authorized to work in the United States?</legend>
          <label>
            <input type="radio" name="us_work_authorization" value="Yes" />
            Yes
          </label>
          <label>
            <input type="radio" name="us_work_authorization" value="No" />
            No
          </label>
        </fieldset>
      </form>
    `;

    const profile = createDefaultApplicantProfile();

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/work-authorization-yes-no",
      title: "Work Authorization Yes No"
    });

    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="us_work_authorization"]')
    );
    expect(radios.find((radio) => radio.value === "Yes")?.checked).toBe(true);
    expect(result.fill.results[0]?.message).toContain("default yes/no policy");
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

  it("dispatches wrapper upload events for dropzone-style resume fields", async () => {
    document.body.innerHTML = `
      <form>
        <div class="resume-dropzone" data-testid="resume-dropzone">
          <span>Upload resume</span>
          <input type="file" name="resumeUpload" style="display: none;" />
        </div>
      </form>
    `;

    const dropzone = document.querySelector(".resume-dropzone") as HTMLDivElement;
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    let sawDrop = false;
    let sawChange = false;

    dropzone.addEventListener("drop", (event) => {
      const maybeTransfer = (event as DragEvent & { dataTransfer?: DataTransfer }).dataTransfer;
      sawDrop = (maybeTransfer?.files?.length ?? 0) > 0;
    });
    input.addEventListener("change", () => {
      sawChange = (input.files?.length ?? 0) > 0;
    });

    const profile = createDefaultApplicantProfile();
    profile.documents.resume = {
      id: "resume-2",
      name: "Resume PDF",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      source: "local",
      sizeBytes: 12,
      dataBase64: "cmVzdW1lIGRhdGE=",
      lastUpdatedAt: new Date().toISOString()
    };

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/resume-dropzone",
      title: "Resume Dropzone"
    });

    expect(input.files?.length).toBe(1);
    expect(sawChange).toBe(true);
    expect(sawDrop).toBe(true);
    expect(result.fill.results[0]?.action).toBe("filled");
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
