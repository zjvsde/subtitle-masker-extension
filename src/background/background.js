async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();

  if (!tab?.id) {
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
  (async () => {
    if (message?.type === "RELAY_TO_ACTIVE_TAB" && message.payload) {
      const result = await sendToActiveTab(message.payload);
      sendResponse(result);
    } else {
      sendResponse({ ok: false, error: "Unknown message type" });
    }
  })();

  return true;
});
