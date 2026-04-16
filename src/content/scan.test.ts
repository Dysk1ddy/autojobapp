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
});
