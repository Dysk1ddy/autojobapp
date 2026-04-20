import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultApplicantProfile,
  createDefaultSettings
} from "../shared/core";
import {
  findHandshakeEasyApplyControl,
  isHandshakeApplicationSurfaceEasy,
  isHandshakeEasyApplyControl,
  runHandshakeMode
} from "./handshake-mode";

describe("Handshake mode", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "<title>Handshake Jobs</title>";
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn()
    });
  });

  it("detects in-Handshake apply buttons and rejects external apply controls", () => {
    document.body.innerHTML = `
      <button id="external">Apply Externally</button>
      <a id="external-link" href="https://example-ats.com/apply">Apply</a>
      <button id="apply">Apply</button>
    `;

    expect(
      isHandshakeEasyApplyControl(document.getElementById("external") as HTMLElement)
    ).toBe(false);
    expect(
      isHandshakeEasyApplyControl(
        document.getElementById("external-link") as HTMLElement
      )
    ).toBe(false);
    expect(
      isHandshakeEasyApplyControl(document.getElementById("apply") as HTMLElement)
    ).toBe(true);
    expect(findHandshakeEasyApplyControl()?.id).toBe("apply");
  });

  it("allows resume-only application dialogs and rejects extra document prompts", () => {
    document.body.innerHTML = `
      <div role="dialog" id="resume-only">
        <h2>Apply to Software Intern</h2>
        <label>
          Resume
          <select>
            <option value="">Select</option>
            <option value="resume">Resume.pdf</option>
          </select>
        </label>
        <button>Submit Application</button>
      </div>
      <div role="dialog" id="cover-letter">
        <h2>Apply to Product Intern</h2>
        <p>Resume</p>
        <p>Cover letter required</p>
        <button>Submit Application</button>
      </div>
      <div role="dialog" id="question">
        <h2>Apply to Design Intern</h2>
        <p>Resume</p>
        <label>
          Why are you interested?
          <textarea required></textarea>
        </label>
        <button>Submit Application</button>
      </div>
    `;

    expect(
      isHandshakeApplicationSurfaceEasy(
        document.getElementById("resume-only") as HTMLElement
      )
    ).toBe(true);
    expect(
      isHandshakeApplicationSurfaceEasy(
        document.getElementById("cover-letter") as HTMLElement
      )
    ).toBe(false);
    expect(
      isHandshakeApplicationSurfaceEasy(
        document.getElementById("question") as HTMLElement
      )
    ).toBe(false);
  });

  it("submits one resume-only Handshake job and then stops when no more jobs exist", async () => {
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
          <li class="job-card">
            <a id="job-link" href="https://app.joinhandshake.com/job-search/101">
              Software Intern
            </a>
          </li>
        </ol>
        <section id="job-detail">
          <h1>Software Intern</h1>
          <button id="apply-button">Apply</button>
        </section>
      </main>
    `;

    document.getElementById("job-link")?.addEventListener("click", (event) => {
      event.preventDefault();
    });
    document.getElementById("apply-button")?.addEventListener("click", () => {
      const dialog = document.createElement("div");
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
        <button id="submit-application" disabled>Submit Application</button>
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
        confirmation.textContent = "Application submitted!";
        document.body.appendChild(confirmation);
      });
    });

    const status = await runHandshakeMode(profile, createDefaultSettings(), {
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
});
