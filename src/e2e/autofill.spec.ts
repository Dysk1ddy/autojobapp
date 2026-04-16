import { expect, Page, test } from "@playwright/test";
import { createDefaultApplicantProfile } from "../shared/core";

const TEST_SERVER_ORIGIN = "http://127.0.0.1:4174";
const CONTENT_SCRIPT_URL = `${TEST_SERVER_ORIGIN}/content.js`;

test("fills repeated experience blocks in a real browser fixture", async ({ page }) => {
  await loadContentTestApi(
    page,
    `${TEST_SERVER_ORIGIN}/fixtures/repeated-experience-application.html`
  );

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

  const fillSummary = await runFill(page, profile, {
    href: "https://jobs.example.com/apply/repeated",
    hostname: "jobs.example.com",
    title: "Repeated Experience"
  });

  await expect(page.locator(".experience-block")).toHaveCount(2);
  await expect(page.locator('input[name="experience_company_1"]')).toHaveValue(
    "Northwind Labs"
  );
  await expect(page.locator('input[name="experience_company_2"]')).toHaveValue(
    "Fabrikam Analytics"
  );
  await expect(page.locator('input[name="experience_title_2"]')).toHaveValue(
    "Senior Platform Engineer"
  );
  expect(fillSummary.fill.filled).toBeGreaterThanOrEqual(6);
});

test("fills Greenhouse-style fields in a real browser fixture", async ({ page }) => {
  await loadContentTestApi(
    page,
    `${TEST_SERVER_ORIGIN}/fixtures/greenhouse-application.html`
  );

  const fillSummary = await runFill(page, createDefaultApplicantProfile(), {
    href: "https://boards.greenhouse.io/acme/jobs/123",
    hostname: "boards.greenhouse.io",
    title: "Greenhouse Application"
  });

  await expect(page.locator("#gh-name")).toHaveValue("Taylor Applicant");
  await expect(page.locator("#gh-email")).toHaveValue(
    "taylor.applicant@example.com"
  );
  await expect(
    page.locator('input[name="future_sponsorship"][value="No"]')
  ).toBeChecked();
  expect(fillSummary.fill.filled).toBeGreaterThanOrEqual(3);
});

test("fills Lever-style fields in a real browser fixture", async ({ page }) => {
  await loadContentTestApi(
    page,
    `${TEST_SERVER_ORIGIN}/fixtures/lever-application.html`
  );

  const fillSummary = await runFill(page, createDefaultApplicantProfile(), {
    href: "https://jobs.lever.co/acme/123",
    hostname: "jobs.lever.co",
    title: "Lever Application"
  });

  await expect(page.locator("#lever-linkedin")).toBeVisible();
  await expect(page.locator("#lever-relocation")).toHaveValue(
    /relocation/i
  );
  expect(fillSummary.scan.adapterLabel).toBe("Lever adapter");
  expect(fillSummary.fill.filled).toBeGreaterThanOrEqual(1);
});

test("fills Workday-style fields in a real browser fixture", async ({ page }) => {
  await loadContentTestApi(
    page,
    `${TEST_SERVER_ORIGIN}/fixtures/workday-application.html`
  );

  const fillSummary = await runFill(page, createDefaultApplicantProfile(), {
    href: "https://acme.myworkdayjobs.com/en-US/careers/job/123",
    hostname: "acme.myworkdayjobs.com",
    title: "Workday Application"
  });

  await expect(page.locator("#wd-company")).toHaveValue("Northwind Labs");
  await expect(page.locator("#wd-title")).toHaveValue("Software Engineer");
  await expect(page.locator("#wd-salary")).toHaveValue(/compensation/i);
  expect(fillSummary.scan.adapterLabel).toBe("Workday adapter");
  expect(fillSummary.fill.filled).toBeGreaterThanOrEqual(3);
});

async function loadContentTestApi(page: Page, fixtureUrl: string): Promise<void> {
  await page.addInitScript(() => {
    (window as typeof window & {
      __AUTO_JOB_APP_ENABLE_TEST_API__?: boolean;
    }).__AUTO_JOB_APP_ENABLE_TEST_API__ = true;
  });
  await page.goto(fixtureUrl);
  await page.addScriptTag({
    type: "module",
    url: CONTENT_SCRIPT_URL
  });
  await page.waitForFunction(
    () =>
      Boolean(
        (window as typeof window & {
          __AUTO_JOB_APP_TEST_API__?: unknown;
        }).__AUTO_JOB_APP_TEST_API__
      )
  );
}

async function runFill(
  page: Page,
  activeProfile: ReturnType<typeof createDefaultApplicantProfile>,
  options: {
    href: string;
    hostname: string;
    title: string;
  }
): Promise<{
  fill: { filled: number };
  scan: { adapterLabel: string };
}> {
  return page.evaluate(
    async ({ activeProfile: profile, fillOptions }) => {
      const api = (
        window as typeof window & {
          __AUTO_JOB_APP_TEST_API__?: {
            fillPage: (
              profile: Record<string, unknown>,
              options?: { href: string; hostname: string; title: string }
            ) => Promise<{
              fill: { filled: number };
              scan: { adapterLabel: string };
            }>;
          };
        }
      ).__AUTO_JOB_APP_TEST_API__;

      if (!api) {
        throw new Error("Test API was not attached to the content script.");
      }

      return api.fillPage(profile, fillOptions);
    },
    {
      activeProfile,
      fillOptions: options
    }
  );
}
