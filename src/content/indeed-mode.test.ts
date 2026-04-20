import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultApplicantProfile,
  createDefaultSettings
} from "../shared/core";
import {
  findIndeedEasyApplyControl,
  isIndeedApplicationSurfaceEasy,
  isIndeedEasyApplyControl,
  runIndeedMode
} from "./indeed-mode";

describe("Indeed mode", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "<title>Indeed Jobs</title>";
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn()
    });
  });

  it("detects Indeed Easy Apply buttons and rejects external or link apply controls", () => {
    document.body.innerHTML = `
      <button id="company-site">Apply on company site</button>
      <a id="apply-link" href="https://www.indeed.com/applystart?jk=abc" target="_blank">
        Apply now
      </a>
      <button id="apply-now">Apply now</button>
    `;

    expect(
      isIndeedEasyApplyControl(
        document.getElementById("company-site") as HTMLElement
      )
    ).toBe(false);
    expect(
      isIndeedEasyApplyControl(document.getElementById("apply-link") as HTMLElement)
    ).toBe(false);
    expect(
      isIndeedEasyApplyControl(document.getElementById("apply-now") as HTMLElement)
    ).toBe(true);
    expect(findIndeedEasyApplyControl()?.id).toBe("apply-now");
  });

  it("allows resume-only Indeed dialogs and rejects extra questions", () => {
    document.body.innerHTML = `
      <div id="resume-only" role="dialog">
        <h2>Apply to Software Intern</h2>
        <label>
          Resume
          <select>
            <option value="">Select</option>
            <option value="resume">Resume.pdf</option>
          </select>
        </label>
        <button>Submit your application</button>
      </div>
      <div id="company-site-dialog" role="dialog">
        <h2>Apply to Product Intern</h2>
        <p>Apply on company site</p>
        <button>Continue</button>
      </div>
      <div id="questions" role="dialog">
        <h2>Apply to Design Intern</h2>
        <p>Resume</p>
        <p>Questions from the employer</p>
        <label>
          Why are you interested?
          <textarea required></textarea>
        </label>
        <button>Submit your application</button>
      </div>
    `;

    expect(
      isIndeedApplicationSurfaceEasy(
        document.getElementById("resume-only") as HTMLElement
      )
    ).toBe(true);
    expect(
      isIndeedApplicationSurfaceEasy(
        document.getElementById("company-site-dialog") as HTMLElement
      )
    ).toBe(false);
    expect(
      isIndeedApplicationSurfaceEasy(
        document.getElementById("questions") as HTMLElement
      )
    ).toBe(false);
  });

  it("submits a direct Indeed job page without search-result cards", async () => {
    const profile = createDefaultApplicantProfile();
    profile.documents.resume = {
      id: "resume-1",
      name: "Resume PDF",
      fileName: "Resume.pdf",
      mimeType: "application/pdf",
      source: "local",
      sizeBytes: 12,
      dataBase64: "cmVzdW1lIGRhdGE=",
      lastUpdatedAt: new Date().toISOString()
    };
    let submitted = false;

    document.head.innerHTML = `
      <title>Frontend Engineer - Indeed</title>
      <link rel="canonical" href="https://www.indeed.com/viewjob?vjk=indeed-303">
    `;
    document.body.innerHTML = `
      <main>
        <section data-testid="jobsearch-JobComponent">
          <h1>Frontend Engineer</h1>
          <button id="apply-button">Apply now</button>
        </section>
      </main>
    `;

    expect(
      isIndeedEasyApplyControl(document.getElementById("apply-button") as HTMLElement)
    ).toBe(true);

    document.getElementById("apply-button")?.addEventListener("click", () => {
      const dialog = document.createElement("div");
      dialog.id = "ia-container";
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = `
        <h2>Apply to Frontend Engineer</h2>
        <label>
          Resume
          <select id="resume-select" required>
            <option value="">Select</option>
            <option value="resume">Resume.pdf</option>
          </select>
        </label>
        <button id="submit-application" disabled>Submit your application</button>
        <button id="cancel-application">Cancel</button>
      `;
      document.body.appendChild(dialog);

      const select = document.getElementById("resume-select") as HTMLSelectElement;
      const submit = document.getElementById(
        "submit-application"
      ) as HTMLButtonElement;

      select.addEventListener("change", () => {
        submit.disabled = !select.value;
      });
      submit.addEventListener("click", () => {
        submitted = true;
        dialog.hidden = true;
        const confirmation = document.createElement("p");
        confirmation.textContent = "Your application has been submitted";
        document.body.appendChild(confirmation);
      });
    });

    const status = await runIndeedMode(profile, createDefaultSettings(), {
      maxIdleRounds: 1,
      actionDelayMs: 0,
      surfaceTimeoutMs: 100
    });

    expect(submitted).toBe(true);
    expect(status.visited).toBe(1);
    expect(status.applied).toBe(1);
    expect(status.skipped).toBe(0);
    expect(status.failed).toBe(0);
  });

  it("submits one resume-only Indeed Easy Apply job", async () => {
    const profile = createDefaultApplicantProfile();
    profile.documents.resume = {
      id: "resume-1",
      name: "Resume PDF",
      fileName: "Resume.pdf",
      mimeType: "application/pdf",
      source: "local",
      sizeBytes: 12,
      dataBase64: "cmVzdW1lIGRhdGE=",
      lastUpdatedAt: new Date().toISOString()
    };
    let submitted = false;

    document.body.innerHTML = `
      <main>
        <ol>
          <li class="job_seen_beacon" data-jk="indeed-101">
            <a id="job-link" href="https://www.indeed.com/viewjob?jk=indeed-101">
              Software Intern
            </a>
          </li>
        </ol>
        <section id="jobsearch-ViewjobPaneWrapper">
          <h1>Software Intern</h1>
          <button id="apply-button">Apply now</button>
        </section>
      </main>
    `;

    document.getElementById("job-link")?.addEventListener("click", (event) => {
      event.preventDefault();
    });
    document.getElementById("apply-button")?.addEventListener("click", () => {
      const dialog = document.createElement("div");
      dialog.id = "ia-container";
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = `
        <h2>Apply to Software Intern</h2>
        <label>
          Resume
          <select id="resume-select" required>
            <option value="">Select</option>
            <option value="resume">Resume.pdf</option>
          </select>
        </label>
        <button id="submit-application" disabled>Submit your application</button>
        <button id="cancel-application">Cancel</button>
      `;
      document.body.appendChild(dialog);

      const select = document.getElementById("resume-select") as HTMLSelectElement;
      const submit = document.getElementById(
        "submit-application"
      ) as HTMLButtonElement;

      select.addEventListener("change", () => {
        submit.disabled = !select.value;
      });
      submit.addEventListener("click", () => {
        submitted = true;
        dialog.hidden = true;
        const confirmation = document.createElement("p");
        confirmation.textContent = "Your application has been submitted";
        document.body.appendChild(confirmation);
      });
    });

    const status = await runIndeedMode(profile, createDefaultSettings(), {
      maxIdleRounds: 1,
      actionDelayMs: 0,
      surfaceTimeoutMs: 100
    });

    expect(submitted).toBe(true);
    expect(status.applied).toBe(1);
    expect(status.skipped).toBe(0);
    expect(status.failed).toBe(0);
    expect(status.active).toBe(false);
  });

  it("does not click job-list apply anchors that can open new tabs", async () => {
    const profile = createDefaultApplicantProfile();
    let applyAnchorClicks = 0;

    document.body.innerHTML = `
      <main>
        <ol>
          <li class="job_seen_beacon" data-jk="indeed-202">
            <a
              id="list-apply"
              href="https://www.indeed.com/applystart?jk=indeed-202"
              target="_blank"
            >
              Apply now
            </a>
            <a id="job-link" href="https://www.indeed.com/viewjob?jk=indeed-202">
              Backend Intern
            </a>
          </li>
        </ol>
        <section id="jobsearch-ViewjobPaneWrapper">
          <h1>Backend Intern</h1>
          <a
            id="detail-apply"
            href="https://www.indeed.com/applystart?jk=indeed-202"
            target="_blank"
          >
            Apply now
          </a>
        </section>
      </main>
    `;

    document.getElementById("job-link")?.addEventListener("click", (event) => {
      event.preventDefault();
    });
    document.getElementById("list-apply")?.addEventListener("click", () => {
      applyAnchorClicks += 1;
    });
    document.getElementById("detail-apply")?.addEventListener("click", () => {
      applyAnchorClicks += 1;
    });

    const status = await runIndeedMode(profile, createDefaultSettings(), {
      maxIdleRounds: 1,
      actionDelayMs: 0,
      surfaceTimeoutMs: 50
    });

    expect(applyAnchorClicks).toBe(0);
    expect(status.applied).toBe(0);
    expect(status.skipped).toBe(1);
    expect(status.failed).toBe(0);
  });
});
