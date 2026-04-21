async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getAllFrameIds(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return (frames || []).map((f) => f.frameId);
  } catch (_error) {
    return [0];
  }
}

async function sendToFrame(tabId, frameId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message, { frameId });
    return response || null;
  } catch (_error) {
    return null;
  }
}

// Send to ALL frames, return the first successful ok:true response.
// This ensures we reach whichever frame actually holds the video.
async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return { ok: false, error: "No active tab" };
  }

  const frameIds = await getAllFrameIds(tab.id);

  for (const frameId of frameIds) {
    const result = await sendToFrame(tab.id, frameId, message);
    if (result?.ok) {
      return result;
    }
  }

  return { ok: false, error: "No frame responded with a video" };
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
