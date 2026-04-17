import { describe, expect, it } from "vitest";
import {
  createDefaultApplicantProfile,
  createDefaultSettings,
  createDefaultState,
  parseApplicantProfileJson,
  shouldFillConfidence
} from "./core";

describe("shouldFillConfidence", () => {
  it("keeps conservative mode limited to high-confidence matches", () => {
    expect(shouldFillConfidence("high", "conservative")).toBe(true);
    expect(shouldFillConfidence("medium", "conservative")).toBe(false);
    expect(shouldFillConfidence("low", "conservative")).toBe(false);
  });

  it("allows medium-confidence matches in neutral mode", () => {
    expect(shouldFillConfidence("high", "neutral")).toBe(true);
    expect(shouldFillConfidence("medium", "neutral")).toBe(true);
    expect(shouldFillConfidence("low", "neutral")).toBe(false);
  });

  it("allows every matched confidence in liberal mode", () => {
    expect(shouldFillConfidence("high", "liberal")).toBe(true);
    expect(shouldFillConfidence("medium", "liberal")).toBe(true);
    expect(shouldFillConfidence("low", "liberal")).toBe(true);
    expect(shouldFillConfidence("unmatched", "liberal")).toBe(false);
  });

  it("keeps the fully auto AI override off by default", () => {
    expect(createDefaultSettings().darkMode).toBe(false);
    expect(createDefaultSettings().fullyAutoEnabled).toBe(false);
    expect(createDefaultSettings().aiAssistScope).toBe("focused");
    expect(createDefaultSettings().aiPreferGeneratedValues).toBe(false);
  });

  it("imports a raw applicant profile JSON backup", () => {
    const profile = createDefaultApplicantProfile("restored-profile", "Restored");
    const imported = parseApplicantProfileJson(
      JSON.stringify({
        ...profile,
        personal: {
          ...profile.personal,
          firstName: "Jordan"
        }
      }),
      createDefaultApplicantProfile()
    );

    expect(imported.id).toBe("restored-profile");
    expect(imported.label).toBe("Restored");
    expect(imported.personal.firstName).toBe("Jordan");
  });

  it("imports the active profile from a stored-state JSON backup", () => {
    const state = createDefaultState();
    const alternateProfile = createDefaultApplicantProfile(
      "profile-2",
      "Data science profile"
    );

    alternateProfile.personal.firstName = "Jamie";
    state.profiles = [state.profiles[0], alternateProfile];
    state.activeProfileId = alternateProfile.id;

    const imported = parseApplicantProfileJson(
      JSON.stringify(state),
      createDefaultApplicantProfile()
    );

    expect(imported.id).toBe("profile-2");
    expect(imported.label).toBe("Data science profile");
    expect(imported.personal.firstName).toBe("Jamie");
  });

  it("keeps the newer screening-question defaults and imports them from JSON", () => {
    const fallback = createDefaultApplicantProfile();
    const imported = parseApplicantProfileJson(
      JSON.stringify({
        ...fallback,
        workAuthorization: {
          ...fallback.workAuthorization,
          selfIdentificationLanguage: "English",
          isAtLeast18: "yes",
          canVerifyLegalWorkRight: "yes",
          terminationHistory: "no",
          friendsOrRelativesAtCompany: "no",
          exportControlCitizenship: "no",
          boardDirectorPlans: "no",
          availabilityDate: "2 weeks after offer"
        }
      }),
      createDefaultApplicantProfile()
    );

    expect(fallback.workAuthorization.selfIdentificationLanguage).toBe("");
    expect(fallback.workAuthorization.isAtLeast18).toBe("unknown");
    expect(imported.workAuthorization.selfIdentificationLanguage).toBe("English");
    expect(imported.workAuthorization.canVerifyLegalWorkRight).toBe("yes");
    expect(imported.workAuthorization.boardDirectorPlans).toBe("no");
    expect(imported.workAuthorization.availabilityDate).toBe("2 weeks after offer");
  });
});
