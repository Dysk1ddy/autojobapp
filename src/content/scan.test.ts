import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultApplicantProfile } from "../shared/core";
import { renderFixture, loadFixture } from "../test/fixture-loader";
import { scanPage } from "./index";

describe("scanPage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "<title>Fixture</title>";
  });

  it("detects generic multi-step workflow and template-backed questions", () => {
    renderFixture(loadFixture("generic-application.html"));
    const profile = createDefaultApplicantProfile();

    const scan = scanPage(profile, {
      href: "https://jobs.example.com/apply/123",
      title: "Generic Application"
    });

    expect(scan.platform).toBe("generic");
    expect(scan.workflow.isMultiStepLikely).toBe(true);
    expect(scan.workflow.currentStep).toContain("Contact");
    expect(scan.workflow.nextActions).toContain("Save and Continue");
    expect(
      scan.fieldMatches.some(
        (match) => match.matchedKey === "templates.motivation" && match.hasValue
      )
    ).toBe(true);
  });

  it("uses the Greenhouse adapter to enrich question metadata", () => {
    renderFixture(loadFixture("greenhouse-application.html"));
    const profile = createDefaultApplicantProfile();

    const scan = scanPage(profile, {
      href: "https://boards.greenhouse.io/acme/jobs/123",
      title: "Greenhouse Application"
    });

    expect(scan.platform).toBe("greenhouse");
    expect(scan.adapterLabel).toBe("Greenhouse adapter");
    expect(scan.adapterNotes.length).toBeGreaterThan(0);
    expect(
      scan.fieldMatches.some(
        (match) =>
          match.matchedKey === "contact.email" && match.confidence === "high"
      )
    ).toBe(true);

    const sponsorshipMatch = scan.fieldMatches.find((match) =>
      match.adapterSignals.some((signal) => signal.includes("future_sponsorship"))
    );

    expect(sponsorshipMatch).toBeDefined();
  });

  it("uses the Lever adapter for relocation and LinkedIn fields", () => {
    renderFixture(loadFixture("lever-application.html"));
    const profile = createDefaultApplicantProfile();

    const scan = scanPage(profile, {
      href: "https://jobs.lever.co/acme/123",
      title: "Lever Application"
    });

    expect(scan.platform).toBe("lever");
    expect(scan.adapterLabel).toBe("Lever adapter");
    expect(
      scan.fieldMatches.some(
        (match) => match.matchedKey === "links.linkedin"
      )
    ).toBe(true);
    expect(
      scan.fieldMatches.some(
        (match) =>
          match.matchedKey === "templates.relocation" ||
          match.matchedKey === "workAuthorization.willingToRelocate"
      )
    ).toBe(true);
  });

  it("uses the Handshake adapter on Handshake job search pages", () => {
    document.body.innerHTML = `
      <main>
        <h1>Software Intern</h1>
        <button>Apply</button>
        <button>Apply Externally</button>
        <div role="dialog">
          <label>
            Resume
            <input type="file" name="resume" />
          </label>
          <button>Submit Application</button>
        </div>
      </main>
    `;
    const profile = createDefaultApplicantProfile();

    const scan = scanPage(profile, {
      href: "https://app.joinhandshake.com/job-search/10966600?page=1&per_page=25",
      title: "Handshake Job Search"
    });

    expect(scan.platform).toBe("handshake");
    expect(scan.adapterLabel).toBe("Handshake adapter");
    expect(scan.jobSignals).toContain("apply externally");
    expect(scan.jobSignals).toContain("submit application");
  });

  it("uses the Workday adapter and detects workflow progress", () => {
    renderFixture(loadFixture("workday-application.html"));
    const profile = createDefaultApplicantProfile();

    const scan = scanPage(profile, {
      href: "https://acme.myworkdayjobs.com/en-US/careers/job/123",
      title: "Workday Application"
    });

    expect(scan.platform).toBe("workday");
    expect(scan.adapterLabel).toBe("Workday adapter");
    expect(scan.workflow.isMultiStepLikely).toBe(true);
    expect(scan.workflow.currentStep).toContain("Work Experience");
    expect(scan.workflow.nextActions).toContain("Continue to Next Step");
    expect(
      scan.fieldMatches.some(
        (match) =>
          match.matchedKey === "experience.company" && match.confidence === "high"
      )
    ).toBe(true);
    expect(
      scan.fieldMatches.some(
        (match) => match.matchedKey === "templates.salary" && match.hasValue
      )
    ).toBe(true);
  });

  it("detects custom ARIA textbox and combobox controls in generic forms", () => {
    document.body.innerHTML = `
      <form>
        <section>
          <h2>Profile</h2>
          <label id="motivation-label">Why are you interested in this role?</label>
          <div
            id="motivation-answer"
            role="textbox"
            contenteditable="true"
            aria-labelledby="motivation-label"
          ></div>
          <label id="country-label">Country of residence</label>
          <div
            id="country-combobox"
            role="combobox"
            tabindex="0"
            aria-labelledby="country-label"
            aria-controls="country-options"
          ></div>
          <div id="country-options" role="listbox">
            <div role="option">United States</div>
            <div role="option">Canada</div>
          </div>
        </section>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const scan = scanPage(profile, {
      href: "https://jobs.example.com/apply/custom-controls",
      title: "Custom Controls"
    });

    expect(
      scan.fieldMatches.some(
        (match) =>
          match.fieldId === "div:motivation-answer" &&
          match.elementTag === "custom" &&
          match.inputType === "textbox" &&
          match.matchedKey === "templates.motivation"
      )
    ).toBe(true);
    expect(
      scan.fieldMatches.some(
        (match) =>
          match.fieldId === "div:country-combobox" &&
          match.inputType === "combobox" &&
          match.optionLabels.includes("United States")
      )
    ).toBe(true);
  });

  it("detects input-based ARIA combobox controls as selection fields", () => {
    document.body.innerHTML = `
      <form>
        <section>
          <label id="language-label" for="language-combobox">
            Self Identification Language
          </label>
          <div class="select-wrapper">
            <input
              id="language-combobox"
              type="text"
              role="combobox"
              aria-labelledby="language-label"
              aria-controls="language-options"
              aria-expanded="false"
              placeholder="Select"
            />
          </div>
          <ul id="language-options" role="listbox">
            <li role="presentation">
              <button type="button" role="option" aria-selected="false">
                English
              </button>
            </li>
            <li role="presentation">
              <button type="button" role="option" aria-selected="false">
                Spanish
              </button>
            </li>
          </ul>
        </section>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const scan = scanPage(profile, {
      href: "https://jobs.example.com/apply/input-combobox",
      title: "Input Combobox"
    });

    expect(
      scan.fieldMatches.some(
        (match) =>
          match.fieldId === "input:language-combobox" &&
          match.inputType === "combobox" &&
          match.matchedKey === "workAuthorization.selfIdentificationLanguage" &&
          match.optionLabels.includes("English")
      )
    ).toBe(true);
  });

  it("detects custom radio and checkbox groups in generic forms", () => {
    document.body.innerHTML = `
      <form>
        <div role="radiogroup" id="future-sponsorship-group" aria-labelledby="future-sponsorship-label">
          <div id="future-sponsorship-label">Will you require sponsorship in the future?</div>
          <div role="radio" id="future-sponsorship-yes" aria-checked="false">Yes</div>
          <div role="radio" id="future-sponsorship-no" aria-checked="false">No</div>
        </div>
        <div role="group" id="skills-group" aria-labelledby="skills-label">
          <div id="skills-label">Skills</div>
          <div role="checkbox" id="skill-typescript" aria-checked="false">TypeScript</div>
          <div role="checkbox" id="skill-react" aria-checked="false">React</div>
        </div>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const scan = scanPage(profile, {
      href: "https://jobs.example.com/apply/custom-choice-controls",
      title: "Custom Choice Controls"
    });

    expect(
      scan.fieldMatches.some(
        (match) =>
          match.inputType === "radio" &&
          match.label.includes("Will you require sponsorship in the future") &&
          match.optionLabels.includes("Yes") &&
          match.optionLabels.includes("No")
      )
    ).toBe(true);
    expect(
      scan.fieldMatches.some(
        (match) =>
          match.inputType === "checkbox" &&
          match.matchedKey === "skills.list" &&
          match.optionLabels.includes("TypeScript") &&
          match.optionLabels.includes("React")
      )
    ).toBe(true);
  });

  it("detects choice controls inside a shadow root", () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <form>
        <div role="radiogroup" id="shadow-sponsorship-group" aria-labelledby="shadow-sponsorship-label">
          <div id="shadow-sponsorship-label">Will you require sponsorship in the future?</div>
          <div role="radio" id="shadow-sponsorship-yes" aria-checked="false">Yes</div>
          <div role="radio" id="shadow-sponsorship-no" aria-checked="false">No</div>
        </div>
        <div role="group" id="shadow-skills-group" aria-labelledby="shadow-skills-label">
          <div id="shadow-skills-label">Skills</div>
          <div role="checkbox" id="shadow-skill-typescript" aria-checked="false">TypeScript</div>
          <div role="checkbox" id="shadow-skill-react" aria-checked="false">React</div>
        </div>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const scan = scanPage(profile, {
      href: "https://jobs.example.com/apply/shadow-choice-controls",
      title: "Shadow Choice Controls"
    });

    expect(
      scan.fieldMatches.some(
        (match) =>
          match.inputType === "radio" &&
          match.label.includes("Will you require sponsorship in the future") &&
          match.optionLabels.includes("Yes") &&
          match.optionLabels.includes("No")
      )
    ).toBe(true);
    expect(
      scan.fieldMatches.some(
        (match) =>
          match.inputType === "checkbox" &&
          match.matchedKey === "skills.list" &&
          match.optionLabels.includes("TypeScript")
      )
    ).toBe(true);
  });

  it("uses the Dover adapter for GitHub fields and yes/no button groups", () => {
    document.body.innerHTML = `
      <form data-testid="dover-application-form">
        <div data-testid="github-field">
          <p>GitHub URL</p>
          <input type="url" name="githubProfileUrl" />
        </div>
        <div data-testid="sponsorship-question">
          <p>Will you require sponsorship now or in the future to work in the United States?</p>
          <div class="button-row">
            <button type="button" aria-pressed="false">Yes</button>
            <button type="button" aria-pressed="false">No</button>
          </div>
        </div>
      </form>
    `;

    const profile = createDefaultApplicantProfile();
    const scan = scanPage(profile, {
      href: "https://app.dover.com/apply/acme/123",
      title: "Dover Application"
    });

    expect(scan.platform).toBe("dover");
    expect(scan.adapterLabel).toBe("Dover adapter");
    expect(
      scan.fieldMatches.some(
        (match) =>
          match.matchedKey === "links.github" &&
          match.label.toLowerCase().includes("github")
      )
    ).toBe(true);
    expect(
      scan.fieldMatches.some(
        (match) =>
          match.inputType === "radio" &&
          match.label.toLowerCase().includes("sponsorship")
      )
    ).toBe(true);
  });
});
