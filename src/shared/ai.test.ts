import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyOpenAiConnection } from "./ai";
import { createDefaultSettings } from "./core";

describe("verifyOpenAiConnection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a valid status when OpenAI responds successfully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "resp_123",
          output_text: "OK"
        })
      })
    );

    const settings = createDefaultSettings();
    settings.openAiApiKey = "sk-test";

    const result = await verifyOpenAiConnection(settings);

    expect(result.status).toBe("valid");
    expect(result.responseId).toBe("resp_123");
    expect(result.message).toContain("OpenAI responded successfully");
  });

  it("treats missing or rejected keys as invalid", async () => {
    const settings = createDefaultSettings();
    expect((await verifyOpenAiConnection(settings)).status).toBe("invalid");

    settings.openAiApiKey = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "invalid api key"
      })
    );

    const rejected = await verifyOpenAiConnection(settings);
    expect(rejected.status).toBe("invalid");
    expect(rejected.message).toContain("rejected");
  });
});
