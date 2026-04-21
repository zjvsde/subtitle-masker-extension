const activeRequests = new Map();

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();

  if (!tab || !tab.id) {
    return { ok: false, error: "No active tab" };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return response || { ok: false, error: "No response from content script" };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Unable to reach content script"
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const requestId = crypto.randomUUID();
  activeRequests.set(requestId, true);

  (async () => {
    try {
      switch (message?.type) {
        case "GET_ACTIVE_STATE": {
          const result = await sendToActiveTab({ type: "GET_STATE" });
          sendResponse(result);
          break;
        }
        case "SET_ACTIVE_CONFIG": {
          const result = await sendToActiveTab({ type: "UPDATE_CONFIG", patch: message.patch || {} });
          sendResponse(result);
          break;
        }
        case "SET_ACTIVE_ENABLED": {
          const result = await sendToActiveTab({ type: "TOGGLE_ENABLE", enabled: !!message.enabled });
          sendResponse(result);
          break;
        }
        case "RESET_ACTIVE_MASK": {
          const result = await sendToActiveTab({ type: "RESET_MASK" });
          sendResponse(result);
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } finally {
      activeRequests.delete(requestId);
    }
  })();

  return true;
});
