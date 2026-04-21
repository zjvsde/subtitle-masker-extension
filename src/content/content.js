(() => {
  const STORAGE_PREFIX = "maskConfig:";
  const DOMAIN_PREFIX = "domainConfig:";
  const MIN_WIDTH_PCT = 0.05;
  const MIN_HEIGHT_PCT = 0.05;

  const DEFAULT_RECT = {
    xPct: 0.1,
    yPct: 0.78,
    wPct: 0.8,
    hPct: 0.18
  };

  const DEFAULT_CONFIG_BASE = {
    enabled: true,
    style: "solid",
    color: "#000000",
    opacity: 0.8,
    blurPx: 12
  };

  let activeVideo = null;
  let currentConfig = null;
  let rafToken = null;
  let isInitialized = false;
  let overlayHost = null;
  let lastUrl = normalizeUrl(window.location.href);

  const overlayMap = new Map();
  let interactionState = null;

  const mutationObserver = new MutationObserver(() => {
    scheduleRefresh();
  });

  function normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      return parsed.toString();
    } catch (_error) {
      return url;
    }
  }

  function createMask(rect = DEFAULT_RECT) {
    return {
      id: crypto.randomUUID(),
      rect: clampRect(rect)
    };
  }

  function createDefaultConfig() {
    const mask = createMask();
    return {
      ...DEFAULT_CONFIG_BASE,
      masks: [mask],
      activeMaskId: mask.id,
      updatedAt: Date.now()
    };
  }

  function getStorageKeyForPage() {
    return `${STORAGE_PREFIX}${normalizeUrl(window.location.href)}`;
  }

  function getStorageKeyForDomain() {
    try {
      return `${DOMAIN_PREFIX}${new URL(window.location.href).hostname}`;
    } catch (_error) {
      return null;
    }
  }

  async function loadConfigForPage() {
    const pageKey = getStorageKeyForPage();
    const domainKey = getStorageKeyForDomain();

    const keys = domainKey ? [pageKey, domainKey] : [pageKey];
    const data = await chrome.storage.local.get(keys);

    if (data[pageKey]) {
      return { config: data[pageKey], source: "page" };
    }

    if (domainKey && data[domainKey]) {
      return { config: data[domainKey], source: "domain" };
    }

    return null;
  }

  async function saveConfigForPage(config) {
    const pageKey = getStorageKeyForPage();
    const domainKey = getStorageKeyForDomain();

    const normalized = normalizeConfig({
      ...config,
      updatedAt: Date.now()
    });

    const writes = { [pageKey]: normalized };
    if (domainKey) {
      writes[domainKey] = normalized;
    }

    await chrome.storage.local.set(writes);
    currentConfig = normalized;
    return normalized;
  }

  function cloneConfigWithFreshMaskIds(rawConfig) {
    const normalized = normalizeConfig(rawConfig);
    const remappedMasks = normalized.masks.map((mask) => ({
      ...mask,
      id: crypto.randomUUID()
    }));

    return {
      ...normalized,
      masks: remappedMasks,
      activeMaskId: remappedMasks[0]?.id || null,
      updatedAt: Date.now()
    };
  }

  function normalizeConfig(rawConfig) {
    if (!rawConfig || typeof rawConfig !== "object") {
      return createDefaultConfig();
    }

    const style = ["solid", "blur", "custom"].includes(rawConfig.style)
      ? rawConfig.style
      : DEFAULT_CONFIG_BASE.style;

    const color = /^#([a-fA-F0-9]{6})$/.test(rawConfig.color)
      ? rawConfig.color
      : DEFAULT_CONFIG_BASE.color;

    const opacity = Number.isFinite(rawConfig.opacity)
      ? Math.max(0, Math.min(1, rawConfig.opacity))
      : DEFAULT_CONFIG_BASE.opacity;

    const blurPx = Number.isFinite(rawConfig.blurPx)
      ? Math.max(0, Math.min(60, rawConfig.blurPx))
      : DEFAULT_CONFIG_BASE.blurPx;

    let masks = [];

    if (Array.isArray(rawConfig.masks) && rawConfig.masks.length > 0) {
      masks = rawConfig.masks
        .filter((mask) => mask && typeof mask === "object")
        .map((mask) => ({
          id: typeof mask.id === "string" && mask.id ? mask.id : crypto.randomUUID(),
          rect: clampRect(mask.rect || DEFAULT_RECT)
        }));
    } else if (rawConfig.rect) {
      masks = [createMask(rawConfig.rect)];
    }

    if (masks.length === 0) {
      masks = [createMask()];
    }

    const activeMaskId = masks.some((mask) => mask.id === rawConfig.activeMaskId)
      ? rawConfig.activeMaskId
      : masks[0].id;

    return {
      enabled: !!rawConfig.enabled,
      style,
      color,
      opacity,
      blurPx,
      masks,
      activeMaskId,
      updatedAt: Number.isFinite(rawConfig.updatedAt) ? rawConfig.updatedAt : Date.now()
    };
  }

  function getCandidateVideos() {
    const videos = [...document.querySelectorAll("video")];

    return videos.filter((video) => {
      const rect = video.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 60) {
        return false;
      }

      const style = window.getComputedStyle(video);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) {
        return false;
      }

      return rect.bottom > 0 && rect.right > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
    });
  }

  function choosePrimaryVideo() {
    const videos = getCandidateVideos();
    if (videos.length === 0) {
      return null;
    }

    let bestVideo = videos[0];
    let bestArea = 0;

    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        bestVideo = video;
      }
    }

    return bestVideo;
  }

  function clampRect(rect) {
    const width = Math.max(MIN_WIDTH_PCT, Math.min(1, Number(rect?.wPct) || DEFAULT_RECT.wPct));
    const height = Math.max(MIN_HEIGHT_PCT, Math.min(1, Number(rect?.hPct) || DEFAULT_RECT.hPct));
    const x = Math.max(0, Math.min(1 - width, Number(rect?.xPct) || 0));
    const y = Math.max(0, Math.min(1 - height, Number(rect?.yPct) || 0));

    return {
      xPct: x,
      yPct: y,
      wPct: width,
      hPct: height
    };
  }

  function getVideoRect() {
    if (!activeVideo) {
      return null;
    }

    const rect = activeVideo.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return rect;
  }

  function getMaskById(maskId) {
    if (!currentConfig?.masks) {
      return null;
    }

    return currentConfig.masks.find((mask) => mask.id === maskId) || null;
  }

  function getActiveMask() {
    return getMaskById(currentConfig?.activeMaskId);
  }

  function setMaskRect(maskId, rect) {
    if (!currentConfig?.masks) {
      return;
    }

    currentConfig.masks = currentConfig.masks.map((mask) => {
      if (mask.id !== maskId) {
        return mask;
      }

      return {
        ...mask,
        rect: clampRect(rect)
      };
    });
  }

  function getMaskRectPixels(maskRect, videoRect) {
    return {
      left: videoRect.left + maskRect.xPct * videoRect.width,
      top: videoRect.top + maskRect.yPct * videoRect.height,
      width: maskRect.wPct * videoRect.width,
      height: maskRect.hPct * videoRect.height
    };
  }

  function toRectFromPixels(rectPx, videoRect) {
    return clampRect({
      xPct: (rectPx.left - videoRect.left) / videoRect.width,
      yPct: (rectPx.top - videoRect.top) / videoRect.height,
      wPct: rectPx.width / videoRect.width,
      hPct: rectPx.height / videoRect.height
    });
  }

  function resolveOverlayHost() {
    if (document.fullscreenElement && activeVideo && document.fullscreenElement.contains(activeVideo)) {
      return document.fullscreenElement;
    }

    return document.documentElement;
  }

  function mountOverlayToCurrentHost(overlay) {
    const host = resolveOverlayHost();

    if (overlayHost !== host) {
      overlayHost = host;
      for (const node of overlayMap.values()) {
        host.appendChild(node.element);
      }
    } else if (overlay.parentNode !== host) {
      host.appendChild(overlay);
    }
  }

  function createHandle(corner) {
    const handle = document.createElement("div");
    handle.className = `subtitle-masker-handle subtitle-masker-handle-${corner}`;
    handle.dataset.corner = corner;
    handle.style.position = "absolute";
    handle.style.width = "12px";
    handle.style.height = "12px";
    handle.style.background = "#ffffff";
    handle.style.border = "1px solid #111111";
    handle.style.borderRadius = "2px";
    handle.style.zIndex = "2";

    switch (corner) {
      case "nw":
        handle.style.left = "-7px";
        handle.style.top = "-7px";
        handle.style.cursor = "nwse-resize";
        break;
      case "ne":
        handle.style.right = "-7px";
        handle.style.top = "-7px";
        handle.style.cursor = "nesw-resize";
        break;
      case "sw":
        handle.style.left = "-7px";
        handle.style.bottom = "-7px";
        handle.style.cursor = "nesw-resize";
        break;
      case "se":
        handle.style.right = "-7px";
        handle.style.bottom = "-7px";
        handle.style.cursor = "nwse-resize";
        break;
      default:
        break;
    }

    return handle;
  }

  function createOverlayNode(maskId) {
    const overlay = document.createElement("div");
    overlay.dataset.maskId = maskId;
    overlay.style.position = "fixed";
    overlay.style.pointerEvents = "auto";
    overlay.style.cursor = "move";
    overlay.style.zIndex = "2147483646";
    overlay.style.border = "1px solid rgba(255,255,255,0.85)";
    overlay.style.boxSizing = "border-box";
    overlay.style.touchAction = "none";
    overlay.style.willChange = "left, top, width, height";

    const handles = {
      nw: createHandle("nw"),
      ne: createHandle("ne"),
      sw: createHandle("sw"),
      se: createHandle("se")
    };

    Object.values(handles).forEach((handle) => {
      overlay.appendChild(handle);
      handle.addEventListener("pointerdown", (event) => {
        onHandlePointerDown(event, maskId, handle.dataset.corner);
      });
    });

    overlay.addEventListener("pointerdown", (event) => {
      if (event.target !== overlay) {
        return;
      }

      onOverlayPointerDown(event, maskId);
    });

    mountOverlayToCurrentHost(overlay);

    overlayMap.set(maskId, {
      element: overlay,
      handles
    });

    return overlayMap.get(maskId);
  }

  function ensureOverlayNode(maskId) {
    const existing = overlayMap.get(maskId);
    if (existing) {
      mountOverlayToCurrentHost(existing.element);
      return existing;
    }

    return createOverlayNode(maskId);
  }

  function removeOverlayNode(maskId) {
    const node = overlayMap.get(maskId);
    if (!node) {
      return;
    }

    node.element.remove();
    overlayMap.delete(maskId);
  }

  function clearOrphanedOverlays() {
    if (!currentConfig?.masks) {
      for (const maskId of overlayMap.keys()) {
        removeOverlayNode(maskId);
      }
      return;
    }

    const activeIds = new Set(currentConfig.masks.map((mask) => mask.id));
    for (const maskId of overlayMap.keys()) {
      if (!activeIds.has(maskId)) {
        removeOverlayNode(maskId);
      }
    }
  }

  function hexToRgba(hex, alpha) {
    const safeHex = /^#([a-fA-F0-9]{6})$/.test(hex) ? hex : "#000000";
    const r = Number.parseInt(safeHex.slice(1, 3), 16);
    const g = Number.parseInt(safeHex.slice(3, 5), 16);
    const b = Number.parseInt(safeHex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  function applyOverlayStyle(overlay, isActive) {
    if (!currentConfig) {
      return;
    }

    const { style, color, opacity, blurPx } = currentConfig;

    if (style === "blur") {
      overlay.style.background = `rgba(0, 0, 0, ${Math.max(0.05, opacity * 0.28)})`;
      overlay.style.backdropFilter = `blur(${Math.max(0, blurPx)}px)`;
      overlay.style.webkitBackdropFilter = `blur(${Math.max(0, blurPx)}px)`;
    } else {
      overlay.style.backdropFilter = "none";
      overlay.style.webkitBackdropFilter = "none";

      const targetColor = style === "custom" ? color : "#000000";
      overlay.style.background = hexToRgba(targetColor, opacity);
    }

    const borderColor = style === "custom" ? color : "#000000";
    overlay.style.border = isActive
      ? "2px solid rgba(83, 174, 255, 0.95)"
      : `1px solid ${hexToRgba(borderColor, Math.min(1, Math.max(0.45, opacity + 0.2)))}`;

    const handles = overlay.querySelectorAll(".subtitle-masker-handle");
    handles.forEach((handle) => {
      handle.style.border = `1px solid ${borderColor}`;
    });
  }

  function renderMask(mask, videoRect) {
    const overlayNode = ensureOverlayNode(mask.id);
    const overlay = overlayNode.element;

    const rectPx = getMaskRectPixels(mask.rect, videoRect);

    overlay.style.display = "block";
    overlay.style.left = `${rectPx.left}px`;
    overlay.style.top = `${rectPx.top}px`;
    overlay.style.width = `${rectPx.width}px`;
    overlay.style.height = `${rectPx.height}px`;

    const isActive = mask.id === currentConfig.activeMaskId;

    for (const handle of Object.values(overlayNode.handles)) {
      handle.style.display = isActive ? "block" : "none";
    }

    applyOverlayStyle(overlay, isActive);
  }

  function renderOverlaySet() {
    clearOrphanedOverlays();

    if (!currentConfig?.enabled || !activeVideo) {
      for (const node of overlayMap.values()) {
        node.element.style.display = "none";
      }
      return;
    }

    const videoRect = getVideoRect();
    if (!videoRect) {
      for (const node of overlayMap.values()) {
        node.element.style.display = "none";
      }
      return;
    }

    overlayHost = resolveOverlayHost();

    currentConfig.masks.forEach((mask) => {
      renderMask(mask, videoRect);
    });
  }

  function scheduleRefresh() {
    if (rafToken) {
      return;
    }

    rafToken = window.requestAnimationFrame(() => {
      rafToken = null;
      refreshVideoAndOverlay();
    });
  }

  function refreshVideoAndOverlay() {
    const candidate = choosePrimaryVideo();

    if (!candidate) {
      activeVideo = null;
      for (const node of overlayMap.values()) {
        node.element.style.display = "none";
      }
      return;
    }

    const changed = candidate !== activeVideo;
    activeVideo = candidate;

    if (changed) {
      void ensureConfigLoaded().then(() => {
        renderOverlaySet();
      });
      return;
    }

    renderOverlaySet();
  }

  function beginInteraction(event, maskId, mode, corner = null) {
    if (!activeVideo || !currentConfig?.enabled) {
      return;
    }

    const mask = getMaskById(maskId);
    const videoRect = getVideoRect();
    if (!mask || !videoRect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    currentConfig.activeMaskId = maskId;

    interactionState = {
      pointerId: event.pointerId,
      maskId,
      mode,
      corner,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startRectPx: getMaskRectPixels(mask.rect, videoRect),
      videoRect
    };

    const overlayNode = overlayMap.get(maskId);
    if (overlayNode) {
      overlayNode.element.setPointerCapture(event.pointerId);
      overlayNode.element.addEventListener("pointermove", onPointerMove);
      overlayNode.element.addEventListener("pointerup", onPointerEnd);
      overlayNode.element.addEventListener("pointercancel", onPointerEnd);
    }

    renderOverlaySet();
  }

  function onOverlayPointerDown(event, maskId) {
    beginInteraction(event, maskId, "move", null);
  }

  function onHandlePointerDown(event, maskId, corner) {
    beginInteraction(event, maskId, "resize", corner || "se");
  }

  function resizeFromCorner(startRectPx, corner, dx, dy, videoRect) {
    const nextRect = {
      left: startRectPx.left,
      top: startRectPx.top,
      width: startRectPx.width,
      height: startRectPx.height
    };

    switch (corner) {
      case "nw":
        nextRect.left = startRectPx.left + dx;
        nextRect.top = startRectPx.top + dy;
        nextRect.width = startRectPx.width - dx;
        nextRect.height = startRectPx.height - dy;
        break;
      case "ne":
        nextRect.top = startRectPx.top + dy;
        nextRect.width = startRectPx.width + dx;
        nextRect.height = startRectPx.height - dy;
        break;
      case "sw":
        nextRect.left = startRectPx.left + dx;
        nextRect.width = startRectPx.width - dx;
        nextRect.height = startRectPx.height + dy;
        break;
      case "se":
      default:
        nextRect.width = startRectPx.width + dx;
        nextRect.height = startRectPx.height + dy;
        break;
    }

    nextRect.width = Math.max(videoRect.width * MIN_WIDTH_PCT, nextRect.width);
    nextRect.height = Math.max(videoRect.height * MIN_HEIGHT_PCT, nextRect.height);

    if (corner === "nw") {
      nextRect.left = startRectPx.left + (startRectPx.width - nextRect.width);
      nextRect.top = startRectPx.top + (startRectPx.height - nextRect.height);
    } else if (corner === "ne") {
      nextRect.top = startRectPx.top + (startRectPx.height - nextRect.height);
    } else if (corner === "sw") {
      nextRect.left = startRectPx.left + (startRectPx.width - nextRect.width);
    }

    return toRectFromPixels(nextRect, videoRect);
  }

  function onPointerMove(event) {
    if (!interactionState || event.pointerId !== interactionState.pointerId) {
      return;
    }

    const dx = event.clientX - interactionState.startPointerX;
    const dy = event.clientY - interactionState.startPointerY;

    let nextRect;

    if (interactionState.mode === "move") {
      nextRect = toRectFromPixels(
        {
          left: interactionState.startRectPx.left + dx,
          top: interactionState.startRectPx.top + dy,
          width: interactionState.startRectPx.width,
          height: interactionState.startRectPx.height
        },
        interactionState.videoRect
      );
    } else {
      nextRect = resizeFromCorner(
        interactionState.startRectPx,
        interactionState.corner,
        dx,
        dy,
        interactionState.videoRect
      );
    }

    setMaskRect(interactionState.maskId, nextRect);
    renderOverlaySet();
  }

  function clearInteractionListeners(maskId, pointerId) {
    const overlayNode = overlayMap.get(maskId);
    if (!overlayNode) {
      return;
    }

    try {
      overlayNode.element.releasePointerCapture(pointerId);
    } catch (_error) {
      // noop
    }

    overlayNode.element.removeEventListener("pointermove", onPointerMove);
    overlayNode.element.removeEventListener("pointerup", onPointerEnd);
    overlayNode.element.removeEventListener("pointercancel", onPointerEnd);
  }

  function onPointerEnd(event) {
    if (!interactionState || event.pointerId !== interactionState.pointerId) {
      return;
    }

    const { maskId, pointerId } = interactionState;
    interactionState = null;

    clearInteractionListeners(maskId, pointerId);
    void saveConfigForPage(currentConfig);
  }

  function getPublicState() {
    return {
      hasVideo: !!activeVideo,
      config: currentConfig,
      shortcut: "Alt+Shift+S"
    };
  }

  async function ensureConfigLoaded() {
    const result = await loadConfigForPage();

    if (!result) {
      currentConfig = createDefaultConfig();
      return;
    }

    if (result.source === "page") {
      currentConfig = normalizeConfig(result.config);
    } else {
      // domain fallback: inherit style/params but assign fresh mask IDs
      // so this page's config is independent of other pages on the same domain
      currentConfig = cloneConfigWithFreshMaskIds(result.config);
    }
  }

  async function resetActiveMask() {
    const activeMask = getActiveMask();
    if (!activeMask) {
      return currentConfig;
    }

    setMaskRect(activeMask.id, DEFAULT_RECT);
    const saved = await saveConfigForPage(currentConfig);
    currentConfig = saved;
    renderOverlaySet();
    return currentConfig;
  }

  async function addMask() {
    if (!currentConfig) {
      await ensureConfigLoaded();
    }

    const count = currentConfig.masks.length;
    const shift = Math.min(0.2, count * 0.03);
    const newMask = createMask({
      xPct: Math.max(0, DEFAULT_RECT.xPct + shift),
      yPct: Math.max(0, DEFAULT_RECT.yPct - shift),
      wPct: DEFAULT_RECT.wPct,
      hPct: DEFAULT_RECT.hPct
    });

    currentConfig.masks = [...currentConfig.masks, newMask];
    currentConfig.activeMaskId = newMask.id;

    const saved = await saveConfigForPage(currentConfig);
    currentConfig = saved;
    renderOverlaySet();

    return currentConfig;
  }

  async function deleteMask(maskId) {
    if (!currentConfig) {
      await ensureConfigLoaded();
    }

    if (currentConfig.masks.length <= 1) {
      return currentConfig;
    }

    const remaining = currentConfig.masks.filter((mask) => mask.id !== maskId);
    if (remaining.length === currentConfig.masks.length) {
      return currentConfig;
    }

    currentConfig.masks = remaining;

    if (!remaining.some((mask) => mask.id === currentConfig.activeMaskId)) {
      currentConfig.activeMaskId = remaining[0].id;
    }

    removeOverlayNode(maskId);

    const saved = await saveConfigForPage(currentConfig);
    currentConfig = saved;
    renderOverlaySet();

    return currentConfig;
  }

  async function setActiveMask(maskId) {
    if (!currentConfig) {
      await ensureConfigLoaded();
    }

    if (!currentConfig.masks.some((mask) => mask.id === maskId)) {
      return currentConfig;
    }

    currentConfig.activeMaskId = maskId;
    const saved = await saveConfigForPage(currentConfig);
    currentConfig = saved;
    renderOverlaySet();

    return currentConfig;
  }

  async function applyConfigPatch(patch) {
    if (!currentConfig) {
      await ensureConfigLoaded();
    }

    const merged = normalizeConfig({
      ...currentConfig,
      ...patch,
      masks: currentConfig.masks
    });

    currentConfig = merged;
    const saved = await saveConfigForPage(currentConfig);
    currentConfig = saved;
    renderOverlaySet();

    return currentConfig;
  }

  async function toggleEnabled(enabled) {
    return applyConfigPatch({ enabled: !!enabled });
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return Boolean(
      target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']") ||
      target.isContentEditable
    );
  }

  function onShortcutKeyDown(event) {
    if (event.defaultPrevented) {
      return;
    }

    if (!(event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey)) {
      return;
    }

    if (String(event.key).toLowerCase() !== "s") {
      return;
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (!currentConfig) {
      return;
    }

    void toggleEnabled(!currentConfig.enabled);
  }

  async function handleMessage(message) {
    switch (message?.type) {
      case "GET_STATE":
        return { ok: true, state: getPublicState() };
      case "UPDATE_CONFIG": {
        await applyConfigPatch(message.patch || {});
        return { ok: true, state: getPublicState() };
      }
      case "TOGGLE_ENABLE": {
        await toggleEnabled(message.enabled);
        return { ok: true, state: getPublicState() };
      }
      case "RESET_MASK": {
        await resetActiveMask();
        return { ok: true, state: getPublicState() };
      }
      case "ADD_MASK": {
        await addMask();
        return { ok: true, state: getPublicState() };
      }
      case "DELETE_MASK": {
        await deleteMask(message.maskId);
        return { ok: true, state: getPublicState() };
      }
      case "SET_ACTIVE_MASK": {
        await setActiveMask(message.maskId);
        return { ok: true, state: getPublicState() };
      }
      default:
        return { ok: false, error: "Unknown message type" };
    }
  }

  function onUrlPotentiallyChanged() {
    const currentUrl = normalizeUrl(window.location.href);
    if (currentUrl === lastUrl) {
      return;
    }

    lastUrl = currentUrl;
    void ensureConfigLoaded().then(() => {
      refreshVideoAndOverlay();
    });
  }

  function installUrlChangeHooks() {
    const rawPushState = history.pushState;
    const rawReplaceState = history.replaceState;

    history.pushState = function patchedPushState(...args) {
      const result = rawPushState.apply(this, args);
      onUrlPotentiallyChanged();
      return result;
    };

    history.replaceState = function patchedReplaceState(...args) {
      const result = rawReplaceState.apply(this, args);
      onUrlPotentiallyChanged();
      return result;
    };

    window.addEventListener("popstate", onUrlPotentiallyChanged, { passive: true });
  }

  function installGlobalListeners() {
    window.addEventListener("resize", scheduleRefresh, { passive: true });
    window.addEventListener("scroll", scheduleRefresh, { passive: true });
    document.addEventListener("fullscreenchange", scheduleRefresh, { passive: true });
    window.addEventListener("keydown", onShortcutKeyDown, true);

    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    installUrlChangeHooks();
  }

  function teardown() {
    mutationObserver.disconnect();
    window.removeEventListener("keydown", onShortcutKeyDown, true);

    for (const node of overlayMap.values()) {
      node.element.remove();
    }
    overlayMap.clear();
  }

  async function init() {
    if (isInitialized) {
      return;
    }
    isInitialized = true;

    await ensureConfigLoaded();

    refreshVideoAndOverlay();
    installGlobalListeners();

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      void handleMessage(message)
        .then((result) => sendResponse(result))
        .catch((error) => {
          sendResponse({ ok: false, error: error?.message || "Unknown content script error" });
        });

      return true;
    });
  }

  void init();

  window.addEventListener("beforeunload", teardown);
})();
