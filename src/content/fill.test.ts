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

  it("fills US phone fields without forcing the +1 country prefix", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Phone number
          <input type="tel" name="phone" autocomplete="tel" />
        </label>
      </form>
    `;

    const phoneInput = document.querySelector('input[name="phone"]') as HTMLInputElement;

    phoneInput.addEventListener("change", () => {
      if (phoneInput.value.includes("+")) {
        phoneInput.value = "";
      }
    });

    const profile = createDefaultApplicantProfile();
    profile.contact.country = "United States";
    profile.contact.phone = "+1 (415) 555-1234";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/phone",
      title: "Phone Number"
    });

    expect(phoneInput.value).toBe("4155551234");
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("fills standard identity and address fields in conservative mode", async () => {
    document.body.innerHTML = `
      <form>
        <div class="field-row">
          <span class="field-label">First Name</span>
          <input data-testid="candidate-first-name" />
        </div>
        <div class="field-row">
          <span class="field-label">Last Name</span>
          <input data-testid="candidate-last-name" />
        </div>
        <div class="field-row">
          <span class="field-label">Address Line 1</span>
          <input data-testid="candidate-address-line-1" />
        </div>
        <div class="field-row">
          <span class="field-label">City</span>
          <input data-testid="candidate-city" />
        </div>
        <div class="field-row">
          <span class="field-label">Postal Code</span>
          <input data-testid="candidate-postal-code" />
        </div>
        <div class="field-row">
          <span class="field-label">State</span>
          <select data-testid="candidate-state">
            <option value="">Select</option>
            <option value="CA">California</option>
            <option value="NY">NY</option>
          </select>
        </div>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/basic-profile",
      title: "Basic Profile",
      settings: {
        ...createDefaultSettings(),
        fillMode: "conservative"
      }
    });

    expect(
      (document.querySelector('[data-testid="candidate-first-name"]') as HTMLInputElement)
        .value
    ).toBe(profile.personal.firstName);
    expect(
      (document.querySelector('[data-testid="candidate-last-name"]') as HTMLInputElement)
        .value
    ).toBe(profile.personal.lastName);
    expect(
      (document.querySelector(
        '[data-testid="candidate-address-line-1"]'
      ) as HTMLInputElement).value
    ).toBe(profile.contact.addressLine1);
    expect(
      (document.querySelector('[data-testid="candidate-city"]') as HTMLInputElement)
        .value
    ).toBe(profile.contact.city);
    expect(
      (document.querySelector('[data-testid="candidate-postal-code"]') as HTMLInputElement)
        .value
    ).toBe(profile.contact.postalCode);
    expect(
      (document.querySelector('[data-testid="candidate-state"]') as HTMLSelectElement)
        .value
    ).toBe(profile.contact.state);
    expect(result.fill.filled).toBeGreaterThanOrEqual(6);
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

  it("prefers the mainland United States option over +1 territory partial matches", async () => {
    document.body.innerHTML = `
      <form>
        <label id="country-priority-label">Country</label>
        <div
          id="country-priority-combobox"
          role="combobox"
          tabindex="0"
          aria-labelledby="country-priority-label"
          aria-controls="country-priority-options"
          data-value="+1 United States Minor Outlying Islands"
        >+1 United States Minor Outlying Islands</div>
        <div id="country-priority-options" role="listbox" hidden>
          <div id="country-option-um" role="option">+1 United States Minor Outlying Islands</div>
          <div id="country-option-us" role="option">+1 United States</div>
        </div>
      </form>
    `;

    const combobox = document.getElementById(
      "country-priority-combobox"
    ) as HTMLDivElement;
    const listbox = document.getElementById(
      "country-priority-options"
    ) as HTMLDivElement;
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
      href: "https://jobs.example.com/apply/country-priority",
      title: "Country Priority"
    });

    expect(combobox.textContent).toBe("+1 United States");
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

  it("waits for async input-based combobox options before applying the no policy", async () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <label id="export-label" for="export-control-combobox">
            All Micron sites must observe U.S. export control rules. Are you a citizen of, or do you hold dual citizenship with any of these countries?
          </label>
          <input
            id="export-control-combobox"
            type="text"
            role="combobox"
            aria-labelledby="export-label"
            aria-controls="export-control-options"
            aria-expanded="false"
            placeholder="Select"
            value="Select"
          />
          <ul id="export-control-options" role="listbox" hidden></ul>
        </fieldset>
      </form>
    `;

    const input = document.getElementById("export-control-combobox") as HTMLInputElement;
    const list = document.getElementById("export-control-options") as HTMLUListElement;

    input.addEventListener("click", () => {
      input.setAttribute("aria-expanded", "true");
      window.setTimeout(() => {
        list.hidden = false;
        list.innerHTML = `
          <li role="presentation"><button type="button" role="option">Unknown</button></li>
          <li role="presentation"><button type="button" role="option">Yes</button></li>
          <li role="presentation"><button type="button" role="option">No</button></li>
        `;

        Array.from(list.querySelectorAll<HTMLButtonElement>("[role='option']")).forEach(
          (option) => {
            option.addEventListener("click", () => {
              input.dataset.committed = "true";
              input.value = option.textContent?.trim() ?? "";
              list.hidden = true;
              input.setAttribute("aria-expanded", "false");
            });
          }
        );
      }, 70);
    });
    input.addEventListener("blur", () => {
      if (input.dataset.committed !== "true") {
        input.value = "Select";
      }
    });

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.exportControlCitizenship = "unknown";

    const result = await fillPage(profile, {
      href: "https://careers.micron.com/careers/apply?pid=39953835",
      title: "Micron Async Combobox"
    });

    expect(input.value).toBe("No");
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("selects no for long immigration sponsorship combobox questions rendered in a portal", async () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <label id="sponsorship-benefit-label" for="sponsorship-benefit-combobox">
            Will you now or in the future require sponsorship for an immigration-related employment benefit? For purposes of this question, sponsorship for an immigration-related employment benefit means an H-1B visa petition, F-1 visa, an O-1 visa petition, an E-3 visa petition, TN status and job flexibility benefits.
          </label>
          <input
            id="sponsorship-benefit-combobox"
            type="text"
            aria-labelledby="sponsorship-benefit-label"
            aria-expanded="false"
            placeholder="Select"
            value="Select"
          />
        </fieldset>
        <div id="floating-root"></div>
      </form>
    `;

    const input = document.getElementById("sponsorship-benefit-combobox") as HTMLInputElement;
    const floatingRoot = document.getElementById("floating-root") as HTMLDivElement;

    input.addEventListener("click", () => {
      input.setAttribute("aria-expanded", "true");
      floatingRoot.innerHTML = `
        <ul role="listbox">
          <li role="presentation"><button type="button" role="option">Yes</button></li>
          <li role="presentation"><button type="button" role="option">No</button></li>
        </ul>
      `;

      Array.from(floatingRoot.querySelectorAll<HTMLButtonElement>("[role='option']")).forEach(
        (option) => {
          option.addEventListener("click", () => {
            input.value = option.textContent?.trim() ?? "";
            input.dataset.committed = "true";
            input.setAttribute("aria-expanded", "false");
            floatingRoot.innerHTML = "";
          });
        }
      );
    });

    input.addEventListener("blur", () => {
      if (input.dataset.committed !== "true") {
        input.value = "Select";
      }
    });

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.requiresFutureSponsorship = "unknown";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/immigration-sponsorship",
      title: "Immigration Sponsorship"
    });

    expect(input.value).toBe("No");
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("syncs hidden backing values for button-triggered custom dropdowns", async () => {
    document.body.innerHTML = `
      <form>
        <div class="field" data-testid="availability-field">
          <label id="availability-label">When would you be available if an offer was accepted?</label>
          <button
            type="button"
            id="availability-trigger"
            aria-labelledby="availability-label availability-value"
            aria-haspopup="listbox"
            aria-controls="availability-options"
            aria-expanded="false"
          >
            <span id="availability-value">Select</span>
          </button>
          <input type="hidden" name="availability_hidden" required value="" />
          <ul id="availability-options" role="listbox" hidden>
            <li role="option" data-value="immediately">Immediately</li>
            <li role="option" data-value="2weeks">2 weeks after offer</li>
            <li role="option" data-value="1month">1 month after offer</li>
          </ul>
        </div>
      </form>
    `;

    const trigger = document.getElementById("availability-trigger") as HTMLButtonElement;
    const valueLabel = document.getElementById("availability-value") as HTMLSpanElement;
    const hiddenInput = document.querySelector(
      'input[name="availability_hidden"]'
    ) as HTMLInputElement;
    const listbox = document.getElementById("availability-options") as HTMLUListElement;

    trigger.addEventListener("click", () => {
      trigger.setAttribute("aria-expanded", "true");
      listbox.hidden = false;
    });

    listbox.querySelectorAll<HTMLElement>('[role="option"]').forEach((option) => {
      option.addEventListener("click", () => {
        valueLabel.textContent = option.textContent ?? "";
        trigger.setAttribute("aria-valuetext", option.textContent ?? "");
        trigger.setAttribute("aria-expanded", "false");
        listbox.hidden = true;
      });
    });

    trigger.addEventListener("blur", () => {
      if (!hiddenInput.value) {
        valueLabel.textContent = "Select";
        trigger.setAttribute("aria-valuetext", "Select");
      }
    });

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.availabilityDate = "2 weeks after offer";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/button-dropdown-backing",
      title: "Button Dropdown Backing"
    });

    expect(valueLabel.textContent).toBe("2 weeks after offer");
    expect(hiddenInput.value).toBe("2weeks");
    expect(trigger.getAttribute("data-value")).toBe("2weeks");
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("waits for delayed portal options in button-triggered dropdowns", async () => {
    document.body.innerHTML = `
      <form>
        <div class="field" data-testid="language-field">
          <label id="language-label">Self Identification Language</label>
          <button
            type="button"
            id="language-trigger"
            aria-labelledby="language-label language-value"
            aria-haspopup="listbox"
            aria-expanded="false"
          >
            <span id="language-value">Select</span>
          </button>
          <input type="hidden" name="self_identification_language" value="" />
        </div>
        <div id="language-portal"></div>
      </form>
    `;

    const trigger = document.getElementById("language-trigger") as HTMLButtonElement;
    const valueLabel = document.getElementById("language-value") as HTMLSpanElement;
    const hiddenInput = document.querySelector(
      'input[name="self_identification_language"]'
    ) as HTMLInputElement;
    const portal = document.getElementById("language-portal") as HTMLDivElement;

    trigger.addEventListener("click", () => {
      trigger.setAttribute("aria-expanded", "true");

      window.setTimeout(() => {
        portal.innerHTML = `
          <ul role="listbox">
            <li role="option" data-value="spanish">Spanish</li>
            <li role="option" data-value="english">English</li>
          </ul>
        `;

        portal.querySelectorAll<HTMLElement>('[role="option"]').forEach((option) => {
          option.addEventListener("click", () => {
            valueLabel.textContent = option.textContent ?? "";
            hiddenInput.value = option.dataset.value ?? "";
            trigger.setAttribute("aria-valuetext", option.textContent ?? "");
            trigger.setAttribute("data-value", option.dataset.value ?? "");
            trigger.setAttribute("aria-expanded", "false");
            portal.innerHTML = "";
          });
        });
      }, 220);
    });

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.selfIdentificationLanguage = "English";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/button-dropdown-portal",
      title: "Button Dropdown Portal"
    });

    expect(valueLabel.textContent).toBe("English");
    expect(hiddenInput.value).toBe("english");
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("fills availability after offer fields from the saved profile value", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          When would you be available if an offer was accepted?
          <select name="offer_availability">
            <option value="">Select</option>
            <option>Immediately</option>
            <option>2 weeks after offer</option>
            <option>1 month after offer</option>
          </select>
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.availabilityDate = "2 weeks after offer";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/availability",
      title: "Offer Availability"
    });

    expect(
      (document.querySelector('select[name="offer_availability"]') as HTMLSelectElement)
        .value
    ).toBe("2 weeks after offer");
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

  it("does not fill generic Dover text questions when internal names are reused", async () => {
    document.body.innerHTML = `
      <form data-testid="dover-application-form">
        <label>
          Github URL *
          <input id="dover-github-url" type="text" name="name" />
        </label>
        <label>
          AI Tools you use everyday *
          <input id="dover-ai-tools" type="text" name="name" />
        </label>
        <label>
          Why Machine &amp; Minds *
          <input id="dover-why-company" type="text" name="name" />
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    profile.links.github = "https://github.com/taylor-applicant";

    const result = await fillPage(profile, {
      href: "https://app.dover.com/apply/Machine%20&%20Minds/123",
      title: "Dover Machine & Minds"
    });

    expect(
      (document.getElementById("dover-github-url") as HTMLInputElement).value
    ).toBe("https://github.com/taylor-applicant");
    expect((document.getElementById("dover-ai-tools") as HTMLInputElement).value).toBe(
      ""
    );
    expect(
      (document.getElementById("dover-why-company") as HTMLInputElement).value
    ).toBe("");
    expect(result.fill.filled).toBe(1);
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

  it("fills disability self-identification radios and required signature name", async () => {
    document.body.innerHTML = `
      <form>
        <section>
          <h2>Voluntary Self-Identification of Disability Form CC-305</h2>
          <fieldset>
            <legend>Disability Status</legend>
            <label>
              <input type="radio" name="disability_status" value="yes" />
              Yes, I have a disability, or have had one in the past
            </label>
            <label>
              <input type="radio" name="disability_status" value="no" />
              No, I do not have a disability and have not had one in the past
            </label>
            <label>
              <input type="radio" name="disability_status" value="decline" />
              I do not want to answer
            </label>
          </fieldset>
          <label>
            Name
            <input name="disability_signature_name" required />
          </label>
        </section>
      </form>
    `;

    let nameChanged = false;
    const nameInput = document.querySelector(
      'input[name="disability_signature_name"]'
    ) as HTMLInputElement;
    nameInput.addEventListener("change", () => {
      nameChanged = true;
    });

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.disabilityStatus = "Prefer not to say";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/disability-self-id",
      title: "Disability Self ID"
    });

    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="disability_status"]')
    );

    expect(radios.find((radio) => radio.value === "decline")?.checked).toBe(true);
    expect(nameInput.value).toBe(profile.personal.fullName);
    expect(nameChanged).toBe(true);
    expect(result.fill.filled).toBeGreaterThanOrEqual(2);
  });

  it("fills nested disability signature name fields using broader section context", async () => {
    document.body.innerHTML = `
      <form>
        <section>
          <div class="intro">
            <h2>Voluntary Self-Identification Form</h2>
            <p>Standard Form CC-305 collects disability status information.</p>
          </div>
          <div class="signature-shell">
            <div class="signature-row">
              <label for="disability_signature_name_nested">Name</label>
              <div class="input-shell">
                <input id="disability_signature_name_nested" name="disability_signature_name_nested" required />
              </div>
              <div role="alert">Name cannot be left blank.</div>
            </div>
          </div>
        </section>
      </form>
    `;

    let nameBlurred = false;
    const nameInput = document.querySelector(
      'input[name="disability_signature_name_nested"]'
    ) as HTMLInputElement;
    nameInput.addEventListener("blur", () => {
      nameBlurred = true;
    });

    const profile = createDefaultApplicantProfile();
    profile.personal.fullName = "";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/disability-signature-nested",
      title: "Disability Signature Nested"
    });

    expect(nameInput.value).toBe(
      `${profile.personal.firstName} ${profile.personal.lastName}`
    );
    expect(nameBlurred).toBe(true);
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("fills disability self-identification dropdowns with the configured profile value", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Voluntary self-identification of disability
          <select name="disability_status" required>
            <option value="">Select a value</option>
            <option value="yes">Yes, I have a disability, or have had one in the past</option>
            <option value="no">No, I do not have a disability and have not had one in the past</option>
            <option value="decline">I do not want to answer</option>
          </select>
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.disabilityStatus = "No";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/disability-dropdown",
      title: "Disability Dropdown"
    });

    expect(
      (document.querySelector('select[name="disability_status"]') as HTMLSelectElement)
        .value
    ).toBe("no");
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
          Veteran Status
          <select name="veteran_status">
            <option value="">Select</option>
            <option value="not-veteran">I am not a veteran</option>
            <option value="protected-veteran">I identify as one or more classifications of protected veteran</option>
            <option value="decline">I do not wish to answer</option>
          </select>
        </label>
        <label>
          When would you be available if an offer was accepted?
          <select name="offer_availability">
            <option value="">Select</option>
            <option value="immediate">Immediately</option>
            <option value="two-weeks">2 weeks after offer</option>
          </select>
        </label>
        <label>
          Will you now or in the future require sponsorship for an immigration-related employment benefit?
          <select name="immigration_sponsorship">
            <option value="">Select</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </label>
        <label>
          Have you applied on any previous occasions for employment in any capacity with Micron?
          <select name="previous_micron_application">
            <option value="">Select</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
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
      (document.querySelector('select[name="veteran_status"]') as HTMLSelectElement)
        .value
    ).toBe("not-veteran");
    expect(
      (document.querySelector('select[name="offer_availability"]') as HTMLSelectElement)
        .value
    ).toBe("immediate");
    expect(
      (document.querySelector(
        'select[name="immigration_sponsorship"]'
      ) as HTMLSelectElement).value
    ).toBe("N");
    expect(
      (document.querySelector(
        'select[name="previous_micron_application"]'
      ) as HTMLSelectElement).value
    ).toBe("N");
    expect(
      (document.querySelector('select[name="age_requirement"]') as HTMLSelectElement)
        .value
    ).toBe("Y");
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
    expect(result.fill.filled).toBeGreaterThanOrEqual(11);
  });

  it("fills custom Micron-style dropdowns with plain option elements", async () => {
    document.body.innerHTML = `
      <form>
        <label id="veteran-label" for="veteran-combobox">
          Veteran Status
          If you believe you belong to any of the categories of protected veterans listed above, please indicate by selecting the appropriate box below.
        </label>
        <input
          id="veteran-combobox"
          type="text"
          aria-labelledby="veteran-label"
          aria-controls="veteran-options"
          aria-expanded="false"
          placeholder="Select"
          value="Select"
        />
        <ul id="veteran-options" hidden>
          <li data-value="decline">I do not wish to answer</li>
          <li data-value="not-veteran">I am not a veteran</li>
          <li data-value="protected-veteran">I identify as one or more classifications of protected veteran</li>
        </ul>

        <label id="language-label" for="language-combobox">
          Self Identification Language
        </label>
        <input
          id="language-combobox"
          type="text"
          aria-labelledby="language-label"
          aria-controls="language-options"
          aria-expanded="false"
          placeholder="Select"
          value="Select"
        />
        <div id="language-options" hidden>
          <button type="button" data-value="es">Spanish</button>
          <button type="button" data-value="en">English</button>
        </div>
      </form>
    `;

    const registerPlainCombobox = (inputId: string, optionsId: string) => {
      const input = document.getElementById(inputId) as HTMLInputElement;
      const options = document.getElementById(optionsId) as HTMLElement;

      input.addEventListener("click", () => {
        input.setAttribute("aria-expanded", "true");
        options.hidden = false;
      });

      Array.from(options.children).forEach((option) => {
        option.addEventListener("click", () => {
          input.value = option.textContent?.trim() ?? "";
          input.dataset.committed = "true";
          input.setAttribute("aria-expanded", "false");
          options.hidden = true;
        });
      });
    };

    registerPlainCombobox("veteran-combobox", "veteran-options");
    registerPlainCombobox("language-combobox", "language-options");

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/micron-custom-dropdowns",
      title: "Micron Custom Dropdowns"
    });

    expect((document.getElementById("veteran-combobox") as HTMLInputElement).value).toBe(
      "I am not a veteran"
    );
    expect((document.getElementById("language-combobox") as HTMLInputElement).value).toBe(
      "English"
    );
    expect(result.fill.filled).toBeGreaterThanOrEqual(2);
  });

  it("randomly fills native how-did-you-hear-about-us dropdowns", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          How did you hear about us?
          <select name="source">
            <option value="">Select</option>
            <option value="linkedin">LinkedIn</option>
            <option value="handshake">Handshake</option>
            <option value="company-site">Company website</option>
          </select>
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/source-native",
      title: "Referral Source Native"
    });

    const select = document.querySelector('select[name="source"]') as HTMLSelectElement;
    expect(["linkedin", "handshake", "company-site"]).toContain(select.value);
    expect(result.fill.results[0]?.fillSource).toBe("random");
    expect(result.fill.results[0]?.message).toContain("Randomly selected");
  });

  it("randomly fills custom how-did-you-hear-about-us dropdowns", async () => {
    document.body.innerHTML = `
      <form>
        <label id="source-label" for="source-combobox">How did you hear about us?</label>
        <input
          id="source-combobox"
          type="text"
          aria-labelledby="source-label"
          aria-controls="source-options"
          aria-expanded="false"
          placeholder="Select"
          value="Select"
        />
        <div id="source-options" hidden>
          <button type="button" data-value="linkedin">LinkedIn</button>
          <button type="button" data-value="handshake">Handshake</button>
          <button type="button" data-value="company-site">Company website</button>
        </div>
      </form>
    `;

    const input = document.getElementById("source-combobox") as HTMLInputElement;
    const options = document.getElementById("source-options") as HTMLElement;

    input.addEventListener("click", () => {
      input.setAttribute("aria-expanded", "true");
      options.hidden = false;
    });

    Array.from(options.children).forEach((option) => {
      option.addEventListener("click", () => {
        input.value = option.textContent?.trim() ?? "";
        input.dataset.value = (option as HTMLElement).dataset.value ?? "";
        input.setAttribute("aria-expanded", "false");
        options.hidden = true;
      });
    });

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/source-custom",
      title: "Referral Source Custom"
    });

    expect(["LinkedIn", "Handshake", "Company website"]).toContain(input.value);
    expect(result.fill.results[0]?.fillSource).toBe("random");
    expect(result.fill.results[0]?.message).toContain("Randomly selected");
  });

  it("accepts terms and conditions fields across checkboxes, radios, selects, and text inputs", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          <input type="checkbox" name="terms_checkbox" />
          I agree to the Terms and Conditions
        </label>

        <fieldset>
          <legend>Please accept the privacy policy</legend>
          <label>
            <input type="radio" name="privacy_policy" value="no" />
            No
          </label>
          <label>
            <input type="radio" name="privacy_policy" value="yes" />
            Yes
          </label>
        </fieldset>

        <label>
          Terms and Conditions
          <select name="terms_select" required>
            <option value="">Select</option>
            <option value="disagree">I do not agree</option>
            <option value="agree">I agree</option>
          </select>
        </label>

        <label>
          Type I agree to accept the terms of use
          <input type="text" name="terms_text" required />
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/terms-controls",
      title: "Terms Controls"
    });

    expect(
      (document.querySelector('input[name="terms_checkbox"]') as HTMLInputElement)
        .checked
    ).toBe(true);
    expect(
      (document.querySelector(
        'input[name="privacy_policy"][value="yes"]'
      ) as HTMLInputElement).checked
    ).toBe(true);
    expect(
      (document.querySelector('select[name="terms_select"]') as HTMLSelectElement)
        .value
    ).toBe("agree");
    expect(
      (document.querySelector('input[name="terms_text"]') as HTMLInputElement).value
    ).toBe("I agree");
    expect(result.fill.filled).toBeGreaterThanOrEqual(4);
  });

  it("accepts custom terms acknowledgement dropdowns", async () => {
    document.body.innerHTML = `
      <form>
        <label id="privacy-label" for="privacy-combobox">
          I acknowledge the candidate privacy notice
        </label>
        <input
          id="privacy-combobox"
          type="text"
          aria-labelledby="privacy-label"
          aria-controls="privacy-options"
          aria-expanded="false"
          placeholder="Select"
          value="Select"
        />
        <div id="privacy-options" hidden>
          <button type="button" data-value="reject">I do not accept</button>
          <button type="button" data-value="accept">I accept</button>
        </div>
      </form>
    `;

    const input = document.getElementById("privacy-combobox") as HTMLInputElement;
    const options = document.getElementById("privacy-options") as HTMLElement;

    input.addEventListener("click", () => {
      input.setAttribute("aria-expanded", "true");
      options.hidden = false;
    });

    Array.from(options.children).forEach((option) => {
      option.addEventListener("click", () => {
        input.value = option.textContent?.trim() ?? "";
        input.dataset.value = (option as HTMLElement).dataset.value ?? "";
        input.setAttribute("aria-expanded", "false");
        options.hidden = true;
      });
    });

    const profile = createDefaultApplicantProfile();
    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/privacy-custom",
      title: "Privacy Custom"
    });

    expect(input.value).toBe("I accept");
    expect(result.fill.filled).toBeGreaterThanOrEqual(1);
  });

  it("answers age eligibility radio and text questions with yes", async () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Are you 18 or older?</legend>
          <label>
            <input type="radio" name="age_eligible" value="Yes" />
            Yes
          </label>
          <label>
            <input type="radio" name="age_eligible" value="No" />
            No
          </label>
        </fieldset>
        <label>
          Are you at least 18 years of age?
          <input type="text" name="age_text" />
        </label>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    profile.workAuthorization.isAtLeast18 = "unknown";

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/age-eligibility",
      title: "Age Eligibility"
    });

    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="age_eligible"]')
    );

    expect(radios.find((radio) => radio.value === "Yes")?.checked).toBe(true);
    expect(
      (document.querySelector('input[name="age_text"]') as HTMLInputElement).value
    ).toBe("Yes");
    expect(result.fill.filled).toBeGreaterThanOrEqual(2);
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

  it("accepts agreement popups shown after resume upload", async () => {
    document.body.innerHTML = `
      <form>
        <label>
          Upload resume
          <input type="file" name="resume" style="display: none;" />
        </label>
      </form>
      <div role="dialog" id="upload-agreement-dialog" hidden>
        <p>Please accept the upload terms before continuing.</p>
        <button type="button" id="upload-agree-button">I agree</button>
      </div>
    `;

    const dialog = document.getElementById(
      "upload-agreement-dialog"
    ) as HTMLElement;
    const agreeButton = document.getElementById(
      "upload-agree-button"
    ) as HTMLButtonElement;
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    let agreed = false;

    input.addEventListener("change", () => {
      dialog.hidden = false;
    });
    agreeButton.addEventListener("click", () => {
      agreed = true;
      dialog.hidden = true;
    });

    const profile = createDefaultApplicantProfile();
    profile.documents.resume = {
      id: "resume-with-agreement",
      name: "Resume PDF",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      source: "local",
      sizeBytes: 12,
      dataBase64: "cmVzdW1lIGRhdGE=",
      lastUpdatedAt: new Date().toISOString()
    };

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/resume-upload-agreement",
      title: "Resume Upload Agreement"
    });

    expect(input.files?.length).toBe(1);
    expect(agreed).toBe(true);
    expect(dialog.hidden).toBe(true);
    expect(result.fill.results[0]?.action).toBe("filled");
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

  it("uploads a saved resume when a hidden file input is paired with a detached resume dropzone", async () => {
    document.body.innerHTML = `
      <form>
        <div style="display: none;">
          <input type="file" name="file" accept=".pdf,.doc,.docx" />
        </div>
        <div class="resume-dropzone" data-testid="resume-upload-target">
          <strong>Resume/CV upload</strong>
          <button type="button">Choose file</button>
        </div>
      </form>
    `;

    const dropzone = document.querySelector(".resume-dropzone") as HTMLDivElement;
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    let sawDrop = false;

    dropzone.addEventListener("drop", (event) => {
      const maybeTransfer = (event as DragEvent & { dataTransfer?: DataTransfer }).dataTransfer;
      sawDrop = (maybeTransfer?.files?.length ?? 0) > 0;
    });

    const profile = createDefaultApplicantProfile();
    profile.documents.resume = {
      id: "resume-3",
      name: "Resume PDF",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      source: "local",
      sizeBytes: 12,
      dataBase64: "cmVzdW1lIGRhdGE=",
      lastUpdatedAt: new Date().toISOString()
    };

    const result = await fillPage(profile, {
      href: "https://jobs.example.com/apply/resume-detached-dropzone",
      title: "Detached Resume Dropzone"
    });

    expect(input.files?.length).toBe(1);
    expect(input.files?.[0]?.name).toBe("resume.pdf");
    expect(sawDrop).toBe(true);
    expect(result.fill.results.some((field) => field.action === "filled")).toBe(true);
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
