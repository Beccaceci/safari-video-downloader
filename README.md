# Safari Video Downloader

A lightweight, modern Manifest V3 Safari Web Extension designed to detect, preview, and download videos and media streams directly from web pages and hyperlinks. Tailored for university learning portals (such as Politecnico di Torino's *Portale della Didattica*) and general HTML5/HLS media.

---

## Key Features

- **Hyperlink & Player Sniffing**: Automatically intercepts direct `.mp4`, `.webm`, `.m4v`, and `.m3u8` (HLS) streams from links, DOM media tags, and network activity.
- **Chunked Streaming Downloads**: Downloads streams via `fetch()` and `ReadableStream`, preventing Safari from automatically opening and playing `.mp4` URLs in new tabs. Media is converted to a native `Blob` and saved directly to `~/Downloads`.
- **Stop (Pause) & Resume Support**: Supports pause/resume via HTTP `Range: bytes=...` requests (HTTP 206 Partial Content), preserving downloaded byte integrity.
- **Real-Time Progress Toolbars**:
  - **Extension Popup**: Displays live download percentage (`0%` to `100%`), downloaded/total size, current speed (e.g. `3.4 MB/s`), and interactive **Pause**, **Resume**, and **Cancel** buttons.
  - **In-Page Floating Widget**: A non-intrusive floating macOS frosted-glass toolbar allows tracking progress even when the popup is closed.
- **Privacy First (No Auto-Play)**: Videos are never loaded or played automatically. Playback is strictly isolated to the explicit **Preview** button inside the popup card.
- **Portale della Didattica (PoliTo) Integration**:
  - Contextual link title extraction (replaces generic portal titles with actual lecture dates/names).
  - Inline **"Scarica Video"** download triggers on course lecture tables.
  - Chronological ordering: most recently selected lectures appear at the bottom.
- **HLS (.m3u8) Downloader**: Dedicated client-side stream parser that concurrently downloads TS segments, handles AES-128 decryption, and merges them into a single MP4 file.
- **YouTube Support**: Integrated action pill button with format options (1080p Full HD, 720p, MP3 Audio).

---

## Project Structure

```text
safari-video-downloader-extension/
├── manifest.json              # Extension Manifest V3 configuration
├── background.js              # Background service worker & download coordinator
├── icons/                     # Extension icons (16, 32, 48, 128px)
├── content/
│   ├── content-bridge.js      # StreamDownloadManager, DOM scanner, message router
│   ├── main-world-interceptor.js # In-page network interceptor
│   ├── polito-adapter.js      # Politecnico di Torino adapter & buttons
│   ├── youtube-adapter.js     # YouTube UI pill button & format selector
│   ├── youtube-interceptor.js # YouTube SPA navigation hook
│   └── content.css            # Styles for in-page toolbars and buttons
├── popup/
│   ├── popup.html             # Media card list interface
│   ├── popup.css              # Apple-style light/dark mode stylesheet
│   └── popup.js               # Popup logic & live progress management
├── downloader/
│   ├── hls-downloader.html    # Standalone HLS merger UI
│   ├── hls-downloader.js      # Segment fetcher & MP4 assembler
│   └── hls-downloader.css     # Downloader styles
├── test/                      # Test pages & automated verification scripts
│   ├── mock-polito.html
│   ├── mock-youtube.html
│   ├── test-video.html
│   └── test-download-stream.js
└── scripts/
    ├── open-in-safari.sh
    └── reload-safari.sh
```

---

## Installation & Usage in Safari

### 1. Enable Unsigned Extensions in Safari
1. Open **Safari**.
2. Go to **Settings > Advanced** and check **"Show features for web developers"** (or "Show Develop menu").
3. In the menu bar, open **Develop** and ensure **"Allow Unsigned Extensions"** is checked.

### 2. Run / Load the Extension
You can convert or run the extension using Safari's Web Extension tools:
```bash
xcrun safari-web-extension-converter /path/to/safari-video-downloader-extension --macos-only
```
Alternatively, build and run via Xcode to sign and install it directly into Safari.

---

## Testing

Run the included automated integration test to verify streaming, pause, and HTTP 206 resume logic:
```bash
node test/test-download-stream.js
```

---

## License

MIT License.
