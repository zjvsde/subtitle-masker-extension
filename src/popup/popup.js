const elements = {
  status: document.getElementById("status"),
  enabled: document.getElementById("enabled"),
  style: document.getElementById("style"),
  color: document.getElementById("color"),
  opacity: document.getElementById("opacity"),
  blur: document.getElementById("blur"),
  reset: document.getElementById("reset"),
  addMask: document.getElementById("addMask"),
  maskList: document.getElementById("maskList"),
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
    elements.reset,
    elements.addMask
  ].forEach((el) => {
    el.disabled = disabled;
  });
}

function buildMaskRow(mask, index, activeId) {
  const row = document.createElement("div");
  row.className = "mask-item";

  const title = document.createElement("button");
  title.type = "button";
  title.textContent = `遮罩 ${index + 1}`;
  title.addEventListener("click", async () => {
    await sendActiveMessage({ type: "SET_ACTIVE_MASK", maskId: mask.id });
    await refreshState();
  });

  const activeTag = document.createElement("span");
  activeTag.className = "active-tag";
  activeTag.textContent = mask.id === activeId ? "当前" : "";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "删除";
  removeBtn.disabled = currentConfig.masks.length <= 1;
  removeBtn.addEventListener("click", async () => {
    await sendActiveMessage({ type: "DELETE_MASK", maskId: mask.id });
    await refreshState();
  });

  row.appendChild(title);
  row.appendChild(activeTag);
  row.appendChild(removeBtn);

  return row;
}

function renderMaskList() {
  elements.maskList.innerHTML = "";

  if (!currentConfig?.masks?.length) {
    return;
  }

  currentConfig.masks.forEach((mask, index) => {
    elements.maskList.appendChild(buildMaskRow(mask, index, currentConfig.activeMaskId));
  });
}

function syncUiFromState(state) {
  hasVideo = !!state?.hasVideo;
  currentConfig = state?.config || null;

  if (!hasVideo || !currentConfig) {
    elements.status.textContent = "未检测到视频（或当前页面不支持注入）。";
    setDisabled(true);
    elements.maskList.innerHTML = "";
    return;
  }

  setDisabled(false);
  elements.status.textContent = `已检测到视频，可调整遮罩（${currentConfig.masks.length} 个）。`;

  elements.enabled.checked = !!currentConfig.enabled;
  elements.style.value = currentConfig.style || "solid";
  elements.color.value = currentConfig.color || "#000000";
  elements.opacity.value = String(currentConfig.opacity ?? 0.8);
  elements.blur.value = String(currentConfig.blurPx ?? 12);

  updateControlVisibility(elements.style.value);
  renderMaskList();
}

async function sendRuntimeMessage(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response || { ok: false, error: "No response" };
  } catch (_error) {
    return { ok: false, error: "Runtime messaging failed" };
  }
}

async function sendActiveMessage(message) {
  return sendRuntimeMessage({
    type: "RELAY_TO_ACTIVE_TAB",
    payload: message
  });
}

async function refreshState() {
  const result = await sendActiveMessage({ type: "GET_STATE" });

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

  const result = await sendActiveMessage({ type: "UPDATE_CONFIG", patch });
  if (result?.ok) {
    syncUiFromState(result.state);
  }
}

elements.enabled.addEventListener("change", async () => {
  const result = await sendActiveMessage({
    type: "TOGGLE_ENABLE",
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
  const result = await sendActiveMessage({ type: "RESET_MASK" });
  if (result?.ok) {
    syncUiFromState(result.state);
  }
});

elements.addMask.addEventListener("click", async () => {
  const result = await sendActiveMessage({ type: "ADD_MASK" });
  if (result?.ok) {
    syncUiFromState(result.state);
  }
});

refreshState();
