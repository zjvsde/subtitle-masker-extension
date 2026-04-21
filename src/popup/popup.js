const elements = {
  status: document.getElementById("status"),
  enabled: document.getElementById("enabled"),
  style: document.getElementById("style"),
  color: document.getElementById("color"),
  opacity: document.getElementById("opacity"),
  blur: document.getElementById("blur"),
  reset: document.getElementById("reset"),
  colorRow: document.getElementById("colorRow"),
  blurRow: document.getElementById("blurRow")
};

let hasVideo = false;
let currentConfig = null;

function updateControlVisibility(style) {
  elements.colorRow.style.display = style === "custom" ? "flex" : "none";
  elements.blurRow.style.display = style === "blur" ? "flex" : "none";
}

function setDisabled(disabled) {
  [
    elements.enabled,
    elements.style,
    elements.color,
    elements.opacity,
    elements.blur,
    elements.reset
  ].forEach((el) => {
    el.disabled = disabled;
  });
}

function syncUiFromState(state) {
  hasVideo = !!state?.hasVideo;
  currentConfig = state?.config || null;

  if (!hasVideo || !currentConfig) {
    elements.status.textContent = "未检测到视频（或当前页面不支持注入）。";
    setDisabled(true);
    return;
  }

  setDisabled(false);
  elements.status.textContent = "已检测到视频，可调整遮罩。";

  elements.enabled.checked = !!currentConfig.enabled;
  elements.style.value = currentConfig.style || "solid";
  elements.color.value = currentConfig.color || "#000000";
  elements.opacity.value = String(currentConfig.opacity ?? 0.8);
  elements.blur.value = String(currentConfig.blurPx ?? 12);

  updateControlVisibility(elements.style.value);
}

async function sendRuntimeMessage(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response || { ok: false, error: "No response" };
  } catch (_error) {
    return { ok: false, error: "Runtime messaging failed" };
  }
}

async function refreshState() {
  const result = await sendRuntimeMessage({ type: "GET_ACTIVE_STATE" });

  if (!result?.ok) {
    syncUiFromState({ hasVideo: false });
    return;
  }

  syncUiFromState(result.state);
}

async function updateConfig(patch) {
  if (!hasVideo) {
    return;
  }

  const result = await sendRuntimeMessage({ type: "SET_ACTIVE_CONFIG", patch });
  if (result?.ok) {
    syncUiFromState(result.state);
  }
}

elements.enabled.addEventListener("change", async () => {
  const result = await sendRuntimeMessage({
    type: "SET_ACTIVE_ENABLED",
    enabled: elements.enabled.checked
  });
  if (result?.ok) {
    syncUiFromState(result.state);
  }
});

elements.style.addEventListener("change", async () => {
  updateControlVisibility(elements.style.value);
  await updateConfig({ style: elements.style.value });
});

elements.color.addEventListener("change", async () => {
  await updateConfig({ color: elements.color.value, style: "custom" });
});

elements.opacity.addEventListener("input", async () => {
  await updateConfig({ opacity: Number(elements.opacity.value) });
});

elements.blur.addEventListener("input", async () => {
  await updateConfig({ blurPx: Number(elements.blur.value), style: "blur" });
});

elements.reset.addEventListener("click", async () => {
  const result = await sendRuntimeMessage({ type: "RESET_ACTIVE_MASK" });
  if (result?.ok) {
    syncUiFromState(result.state);
  }
});

refreshState();
