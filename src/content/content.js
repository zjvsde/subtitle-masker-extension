(() => {
  const STORAGE_PREFIX = "maskConfig:";
  const DEFAULT_CONFIG = {
    enabled: true,
    style: "solid",
    color: "#000000",
    opacity: 0.8,
    blurPx: 12,
    rect: {
      xPct: 0.1,
      yPct: 0.78,
      wPct: 0.8,
      hPct: 0.18
    },
    updatedAt: Date.now()
  };

  const MIN_WIDTH_PCT = 0.05;
  const MIN_HEIGHT_PCT = 0.05;

  let activeVideo = null;
  let currentConfig = null;
  let overlay = null;
  let resizeHandle = null;
  let isInitialized = false;

  let dragState = null;
  let rafToken = null;

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

  function getStorageKeyForPage() {
    return `${STORAGE_PREFIX}${normalizeUrl(window.location.href)}`;
  }

  async function loadConfigForPage() {
    const key = getStorageKeyForPage();
    const data = await chrome.storage.local.get(key);
    return data[key] || null;
  }

  async function saveConfigForPage(config) {
    const key = getStorageKeyForPage();
    const nextConfig = {
      ...config,
      updatedAt: Date.now()
    };

    await chrome.storage.local.set({ [key]: nextConfig });
    currentConfig = nextConfig;
    return nextConfig;
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

      const inViewport = rect.bottom > 0 && rect.right > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
      return inViewport;
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
    const width = Math.max(MIN_WIDTH_PCT, Math.min(1, rect.wPct));
    const height = Math.max(MIN_HEIGHT_PCT, Math.min(1, rect.hPct));
    const x = Math.max(0, Math.min(1 - width, rect.xPct));
    const y = Math.max(0, Math.min(1 - height, rect.yPct));

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

  function ensureOverlayDom() {
    if (overlay && resizeHandle) {
      return;
    }

    overlay = document.createElement("div");
    overlay.id = "subtitle-masker-overlay";
    overlay.style.position = "fixed";
    overlay.style.pointerEvents = "auto";
    overlay.style.cursor = "move";
    overlay.style.zIndex = "2147483646";
    overlay.style.border = "1px solid rgba(255,255,255,0.6)";
    overlay.style.boxSizing = "border-box";
    overlay.style.backdropFilter = "none";
    overlay.style.webkitBackdropFilter = "none";

    resizeHandle = document.createElement("div");
    resizeHandle.id = "subtitle-masker-handle";
    resizeHandle.style.position = "absolute";
    resizeHandle.style.width = "12px";
    resizeHandle.style.height = "12px";
    resizeHandle.style.right = "-6px";
    resizeHandle.style.bottom = "-6px";
    resizeHandle.style.background = "#ffffff";
    resizeHandle.style.border = "1px solid #000000";
    resizeHandle.style.borderRadius = "2px";
    resizeHandle.style.cursor = "nwse-resize";

    overlay.appendChild(resizeHandle);
    document.documentElement.appendChild(overlay);

    overlay.addEventListener("pointerdown", onOverlayPointerDown);
    resizeHandle.addEventListener("pointerdown", onResizePointerDown);
  }

  function destroyOverlay() {
    if (overlay) {
      overlay.removeEventListener("pointerdown", onOverlayPointerDown);
      overlay.remove();
      overlay = null;
    }

    if (resizeHandle) {
      resizeHandle.removeEventListener("pointerdown", onResizePointerDown);
      resizeHandle = null;
    }
  }

  function applyStyle() {
    if (!overlay || !currentConfig) {
      return;
    }

    const { style, color, opacity, blurPx } = currentConfig;

    if (style === "blur") {
      overlay.style.background = `rgba(0, 0, 0, ${Math.max(0.05, opacity * 0.3)})`;
      overlay.style.backdropFilter = `blur(${Math.max(0, blurPx)}px)`;
      overlay.style.webkitBackdropFilter = `blur(${Math.max(0, blurPx)}px)`;
      return;
    }

    overlay.style.backdropFilter = "none";
    overlay.style.webkitBackdropFilter = "none";

    const targetColor = style === "custom" ? color : "#000000";
    overlay.style.background = hexToRgba(targetColor, opacity);
  }

  function hexToRgba(hex, alpha) {
    const safeHex = /^#([a-fA-F0-9]{6})$/.test(hex) ? hex : "#000000";
    const r = Number.parseInt(safeHex.slice(1, 3), 16);
    const g = Number.parseInt(safeHex.slice(3, 5), 16);
    const b = Number.parseInt(safeHex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  function renderOverlay() {
    if (!currentConfig?.enabled || !activeVideo) {
      if (overlay) {
        overlay.style.display = "none";
      }
      return;
    }

    const videoRect = getVideoRect();
    if (!videoRect) {
      if (overlay) {
        overlay.style.display = "none";
      }
      return;
    }

    ensureOverlayDom();

    const rect = clampRect(currentConfig.rect);
    currentConfig.rect = rect;

    overlay.style.display = "block";
    overlay.style.left = `${videoRect.left + rect.xPct * videoRect.width}px`;
    overlay.style.top = `${videoRect.top + rect.yPct * videoRect.height}px`;
    overlay.style.width = `${rect.wPct * videoRect.width}px`;
    overlay.style.height = `${rect.hPct * videoRect.height}px`;

    applyStyle();
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
      if (overlay) {
        overlay.style.display = "none";
      }
      return;
    }

    const changed = candidate !== activeVideo;
    activeVideo = candidate;

    if (changed) {
      void ensureConfigLoaded().then(() => {
        renderOverlay();
      });
      return;
    }

    renderOverlay();
  }

  function toRectFromPixels(startRectPx, videoRect) {
    return clampRect({
      xPct: (startRectPx.left - videoRect.left) / videoRect.width,
      yPct: (startRectPx.top - videoRect.top) / videoRect.height,
      wPct: startRectPx.width / videoRect.width,
      hPct: startRectPx.height / videoRect.height
    });
  }

  function onOverlayPointerDown(event) {
    if (!overlay || !activeVideo || !currentConfig?.enabled) {
      return;
    }

    if (event.target === resizeHandle) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const videoRect = getVideoRect();
    if (!videoRect) {
      return;
    }

    const overlayRect = overlay.getBoundingClientRect();

    dragState = {
      mode: "move",
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startRectPx: {
        left: overlayRect.left,
        top: overlayRect.top,
        width: overlayRect.width,
        height: overlayRect.height
      },
      videoRect
    };

    overlay.setPointerCapture(event.pointerId);
    overlay.addEventListener("pointermove", onPointerMove);
    overlay.addEventListener("pointerup", onPointerEnd);
    overlay.addEventListener("pointercancel", onPointerEnd);
  }

  function onResizePointerDown(event) {
    if (!overlay || !activeVideo || !currentConfig?.enabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const videoRect = getVideoRect();
    if (!videoRect) {
      return;
    }

    const overlayRect = overlay.getBoundingClientRect();

    dragState = {
      mode: "resize",
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startRectPx: {
        left: overlayRect.left,
        top: overlayRect.top,
        width: overlayRect.width,
        height: overlayRect.height
      },
      videoRect
    };

    overlay.setPointerCapture(event.pointerId);
    overlay.addEventListener("pointermove", onPointerMove);
    overlay.addEventListener("pointerup", onPointerEnd);
    overlay.addEventListener("pointercancel", onPointerEnd);
  }

  function onPointerMove(event) {
    if (!overlay || !dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const dx = event.clientX - dragState.startPointerX;
    const dy = event.clientY - dragState.startPointerY;

    const start = dragState.startRectPx;
    let nextRect = { ...start };

    if (dragState.mode === "move") {
      nextRect.left = start.left + dx;
      nextRect.top = start.top + dy;
    } else {
      nextRect.width = Math.max(dragState.videoRect.width * MIN_WIDTH_PCT, start.width + dx);
      nextRect.height = Math.max(dragState.videoRect.height * MIN_HEIGHT_PCT, start.height + dy);
    }

    const normalized = toRectFromPixels(nextRect, dragState.videoRect);
    currentConfig.rect = normalized;
    renderOverlay();
  }

  function clearPointerHandlers(pointerId) {
    if (!overlay) {
      return;
    }

    try {
      overlay.releasePointerCapture(pointerId);
    } catch (_error) {
      // ignore
    }

    overlay.removeEventListener("pointermove", onPointerMove);
    overlay.removeEventListener("pointerup", onPointerEnd);
    overlay.removeEventListener("pointercancel", onPointerEnd);
  }

  function onPointerEnd(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const pointerId = dragState.pointerId;
    dragState = null;
    clearPointerHandlers(pointerId);

    void saveConfigForPage(currentConfig);
  }

  function mergeConfig(patch) {
    const merged = {
      ...currentConfig,
      ...patch,
      rect: clampRect({
        ...currentConfig.rect,
        ...(patch?.rect || {})
      })
    };

    return merged;
  }

  function getDefaultConfig() {
    return {
      ...DEFAULT_CONFIG,
      rect: { ...DEFAULT_CONFIG.rect },
      updatedAt: Date.now()
    };
  }

  async function ensureConfigLoaded() {
    const loaded = await loadConfigForPage();
    currentConfig = loaded ? mergeConfig(loaded) : getDefaultConfig();
  }

  async function resetMask() {
    const next = {
      ...currentConfig,
      rect: { ...DEFAULT_CONFIG.rect }
    };

    const saved = await saveConfigForPage(next);
    currentConfig = saved;
    renderOverlay();
    return saved;
  }

  function getPublicState() {
    return {
      hasVideo: !!activeVideo,
      config: currentConfig
    };
  }

  async function handleMessage(message) {
    switch (message?.type) {
      case "GET_STATE": {
        return { ok: true, state: getPublicState() };
      }
      case "UPDATE_CONFIG": {
        if (!currentConfig) {
          await ensureConfigLoaded();
        }
        currentConfig = mergeConfig(message.patch || {});
        const saved = await saveConfigForPage(currentConfig);
        currentConfig = saved;
        renderOverlay();
        return { ok: true, state: getPublicState() };
      }
      case "TOGGLE_ENABLE": {
        if (!currentConfig) {
          await ensureConfigLoaded();
        }
        currentConfig = mergeConfig({ enabled: !!message.enabled });
        const saved = await saveConfigForPage(currentConfig);
        currentConfig = saved;
        renderOverlay();
        return { ok: true, state: getPublicState() };
      }
      case "RESET_MASK": {
        if (!currentConfig) {
          await ensureConfigLoaded();
        }
        await resetMask();
        return { ok: true, state: getPublicState() };
      }
      default:
        return { ok: false, error: "Unknown message type" };
    }
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

  let lastUrl = normalizeUrl(window.location.href);

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

  function installGlobalListeners() {
    window.addEventListener("resize", scheduleRefresh, { passive: true });
    window.addEventListener("scroll", scheduleRefresh, { passive: true });
    document.addEventListener("fullscreenchange", scheduleRefresh, { passive: true });

    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    installUrlChangeHooks();
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

  window.addEventListener("beforeunload", () => {
    mutationObserver.disconnect();
    destroyOverlay();
  });
})();
