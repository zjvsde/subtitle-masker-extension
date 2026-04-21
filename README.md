# Subtitle Masker Extension

A Chrome extension that places an adjustable overlay on any web video to block hardcoded (burned-in) subtitles. The mask position, size, and style are saved per video page URL and restored automatically on revisit.

## Features

- Works on any website that uses an HTML `<video>` element (YouTube, Bilibili, news sites, etc.)
- Auto-initialises a default mask covering the bottom subtitle region
- Drag to move and resize the mask directly on the video
- Three mask styles: solid colour / blur / custom colour with opacity
- Configuration saved per video page URL, restored on next visit
- Domain-level fallback: if a page has no saved config yet, it inherits the latest config from the same site
- Full-screen and SPA navigation supported

## Installation

> The extension is not yet published to the Chrome Web Store. Install it in Developer Mode as described below.

1. Clone or download this repository:
   ```bash
   git clone https://github.com/zjvsde/subtitle-masker-extension.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `subtitle-masker-extension` folder.
5. The extension icon appears in the toolbar. Pin it for easy access.

## Usage

1. Open any page that contains a video (e.g. a YouTube or Bilibili video page).
2. A black mask appears automatically over the typical subtitle area at the bottom of the video.
3. **Move** the mask: drag it anywhere within the video.
4. **Resize** the mask: drag the small white handle in the bottom-right corner.
5. Click the extension icon to open the control panel:
   - Toggle the mask on/off with the **启用遮罩** switch.
   - Change the mask style with the **遮罩样式** selector (solid / blur / custom colour).
   - Adjust opacity and blur intensity with the sliders.
   - Click **重置遮罩区域** to restore the default position.
6. All settings are saved automatically for that video page URL.
7. If a new page on the same domain has no page-level config yet, it will auto-inherit your latest domain-level settings.

## Project Structure

```
subtitle-masker-extension/
├── manifest.json              # Chrome Extension Manifest V3
└── src/
    ├── background/
    │   └── background.js      # Lightweight service worker (message bridge)
    ├── content/
    │   └── content.js         # Core: video detection, overlay rendering, interactions, storage
    └── popup/
        ├── popup.html         # Control panel HTML
        ├── popup.css          # Control panel styles
        └── popup.js           # Control panel logic
```

## Known Limitations (V1)

- Cross-origin `<iframe>` videos (e.g. embedded third-party players) are not supported.
- Only the largest visible video on a page is targeted when multiple videos are present.

## Roadmap

- [ ] Smoother resize handle interactions
- [ ] Keyboard shortcut to toggle mask on/off
- [x] Domain-level fallback config (apply saved settings to all videos on a site)
- [ ] Heuristic subtitle region detection (auto-fit the mask to the actual subtitle area)
- [ ] Firefox / Edge compatibility
- [ ] Chrome Web Store release

## License

MIT
