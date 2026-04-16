import {
  AiAssistSummary,
  ContentRequest,
  ContentResponse,
  ScanSummary,
  duplicateActiveProfileInStorage,
  RuntimeRequest,
  RuntimeResponse,
  createDefaultAiAssistSummary,
  ensureState,
  getActiveProfile,
  isScannableUrl,
  readState,
  resetStoredState,
  updateExtensionSettingsInStorage,
  setActiveProfileInStorage,
  toErrorMessage,
  writeState
} from "../shared/core";
import { generateAiAssistSummary } from "../shared/ai";

chrome.runtime.onInstalled.addListener(() => {
  void ensureState();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureState();
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "autofill-active-tab") {
    return;
  }

  void fillActiveTab().catch((error) => {
    console.error("AutoJobApp shortcut autofill failed:", error);
  });
});

chrome.runtime.onMessage.addListener(
  (request: RuntimeRequest, _sender, sendResponse) => {
    void handleRuntimeMessage(request)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: toErrorMessage(error)
        } satisfies RuntimeResponse);
      });

    return true;
  }
);

async function handleRuntimeMessage(
  request: RuntimeRequest
): Promise<RuntimeResponse> {
  switch (request.type) {
    case "GET_STATE":
      return {
        ok: true,
        state: await ensureState()
      };

    case "RESET_STATE":
      return {
        ok: true,
        state: await resetStoredState()
      };

    case "SET_ACTIVE_PROFILE":
      return {
        ok: true,
        state: await setActiveProfileInStorage(request.profileId)
      };

    case "DUPLICATE_ACTIVE_PROFILE":
      return {
        ok: true,
        state: await duplicateActiveProfileInStorage(request.label)
      };

    case "SCAN_ACTIVE_TAB":
      return scanActiveTab();

    case "FILL_ACTIVE_TAB":
      return fillActiveTab();

    case "UPDATE_SETTINGS":
      return {
        ok: true,
        state: await updateExtensionSettingsInStorage((settings) => ({
          ...settings,
          ...request.settings
        }))
      };

    default:
      return {
        ok: false,
        error: "Unknown runtime request."
      };
  }
}

async function scanActiveTab(): Promise<RuntimeResponse> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    return {
      ok: false,
      error: "No active tab was available to scan."
    };
  }

  if (!isScannableUrl(tab.url)) {
    return {
      ok: false,
      error: "Open an HTTP or HTTPS job application page before scanning."
    };
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  });

  const state = await readState();
  const profile = getActiveProfile(state);
  const contentRequest: ContentRequest = {
    type: "JOB_APP_SCAN_PAGE",
    profile,
    settings: state.settings
  };

  const response = await sendContentMessage(tab.id, contentRequest);

  if (!response.ok || !response.scan) {
    return {
      ok: false,
      error: response.ok
        ? "The page did not return a scan result."
        : response.error
    };
  }

  const aiAssist = await maybeGenerateAiAssist(
    response.scan,
    profile,
    state.settings
  );
  const scan = attachAiAssistToScan(response.scan, aiAssist);

  const nextState = {
    ...state,
    lastScan: scan,
    lastUpdatedAt: new Date().toISOString()
  };

  await writeState(nextState);

  return {
    ok: true,
    state: nextState,
    scan
  };
}

async function fillActiveTab(): Promise<RuntimeResponse> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    return {
      ok: false,
      error: "No active tab was available to autofill."
    };
  }

  if (!isScannableUrl(tab.url)) {
    return {
      ok: false,
      error: "Open an HTTP or HTTPS job application page before autofilling."
    };
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  });

  const state = await readState();
  const profile = getActiveProfile(state);
  const scanRequest: ContentRequest = {
    type: "JOB_APP_SCAN_PAGE",
    profile,
    settings: state.settings
  };

  const scanResponse = await sendContentMessage(tab.id, scanRequest);

  if (!scanResponse.ok || !scanResponse.scan) {
    return {
      ok: false,
      error: scanResponse.ok
        ? "The page did not return a scan result before autofill."
        : scanResponse.error
    };
  }

  const aiAssist = await maybeGenerateAiAssist(
    scanResponse.scan,
    profile,
    state.settings
  );
  const contentRequest: ContentRequest = {
    type: "JOB_APP_FILL_PAGE",
    profile,
    settings: state.settings,
    aiSuggestions: aiAssist.suggestions
  };

  const response = await sendContentMessage(tab.id, contentRequest);

  if (!response.ok || !response.fill) {
    return {
      ok: false,
      error: response.ok
        ? "The page did not return an autofill result."
        : response.error
    };
  }

  const scan = attachAiAssistToScan(response.scan ?? scanResponse.scan, aiAssist);
  const nextState = {
    ...state,
    lastScan: scan,
    lastFill: response.fill,
    lastUpdatedAt: new Date().toISOString()
  };

  await writeState(nextState);

  return {
    ok: true,
    state: nextState,
    scan,
    fill: response.fill
  };
}

async function maybeGenerateAiAssist(
  scan: ScanSummary,
  profile: ReturnType<typeof getActiveProfile>,
  settings: Awaited<ReturnType<typeof readState>>["settings"]
): Promise<AiAssistSummary> {
  return generateAiAssistSummary(scan, profile, settings);
}

function attachAiAssistToScan(
  scan: ScanSummary,
  aiAssist: AiAssistSummary
): ScanSummary {
  return {
    ...scan,
    aiAssist
  };
}

async function sendContentMessage(
  tabId: number,
  request: ContentRequest
): Promise<ContentResponse> {
  try {
    return (await chrome.tabs.sendMessage(tabId, request)) as ContentResponse;
  } catch (error) {
    const message = toErrorMessage(error);

    if (!message.includes("Receiving end does not exist")) {
      throw error;
    }

    await delay(120);
    return (await chrome.tabs.sendMessage(tabId, request)) as ContentResponse;
  }
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
