import {
  ContentRequest,
  ContentResponse,
  duplicateActiveProfileInStorage,
  RuntimeRequest,
  RuntimeResponse,
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

chrome.runtime.onInstalled.addListener(() => {
  void ensureState();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureState();
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
  const contentRequest: ContentRequest = {
    type: "JOB_APP_SCAN_PAGE",
    profile: getActiveProfile(state),
    settings: state.settings
  };

  const response = (await chrome.tabs.sendMessage(
    tab.id,
    contentRequest
  )) as ContentResponse;

  if (!response.ok || !response.scan) {
    return {
      ok: false,
      error: response.ok
        ? "The page did not return a scan result."
        : response.error
    };
  }

  const nextState = {
    ...state,
    lastScan: response.scan,
    lastUpdatedAt: new Date().toISOString()
  };

  await writeState(nextState);

  return {
    ok: true,
    state: nextState,
    scan: response.scan
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
  const contentRequest: ContentRequest = {
    type: "JOB_APP_FILL_PAGE",
    profile: getActiveProfile(state),
    settings: state.settings
  };

  const response = (await chrome.tabs.sendMessage(
    tab.id,
    contentRequest
  )) as ContentResponse;

  if (!response.ok || !response.fill) {
    return {
      ok: false,
      error: response.ok
        ? "The page did not return an autofill result."
        : response.error
    };
  }

  const nextState = {
    ...state,
    lastScan: response.scan ?? state.lastScan,
    lastFill: response.fill,
    lastUpdatedAt: new Date().toISOString()
  };

  await writeState(nextState);

  return {
    ok: true,
    state: nextState,
    scan: response.scan,
    fill: response.fill
  };
}
