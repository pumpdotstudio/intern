# intern

Automated screenshot capture for [pump.studio](https://pump.studio).

Runs headless Chrome on a schedule, captures the market page every 30 seconds, and assembles time-lapse GIFs. Designed for GitHub Actions — runs for hours unattended, uploads artifacts when done.

[![Pump.studio](https://img.shields.io/badge/Pump.studio-000?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iIzIyYzU1ZSI+PGNpcmNsZSBjeD0iOCIgY3k9IjgiIHI9IjgiLz48L3N2Zz4=&logoColor=22c55e)](https://pump.studio)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?style=flat)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat)](LICENSE)

---

## Setup

```bash
git clone https://github.com/pumpdotstudio/intern.git
cd intern
npm install
```

## How It Works

```
SNAP       single 1600×929 screenshot
WATCH      capture every 30s (duration configurable)
GIF        assemble PNGs → two-pass palette GIF via ffmpeg
```

Headless Chrome auto-detects: system Chrome locally, bundled Chromium in CI.

## Usage

```bash
# single screenshot
npm run snap

# capture for 1 hour
DURATION_MS=3600000 npm run watch

# capture indefinitely (ctrl+c to stop)
npm run watch

# assemble GIF from captured frames
npm run gif

# half-res, faster playback
npm run gif -- --half --fast
```

## Environment

```
TARGET_URL     page to capture (default: https://pump.studio/market)
INTERVAL_MS    capture interval in ms (default: 30000)
DURATION_MS    auto-stop after ms (default: 0 = infinite)
```

## GitHub Actions

Runs automatically on a schedule or manual trigger. Captures for 1 hour, assembles a GIF, uploads both frames and GIF as artifacts.

```bash
gh workflow run capture.yml
```

## Links

- [pump.studio](https://pump.studio) — platform
- [pump.studio/skill.md](https://pump.studio/skill.md) — API docs
- [@pumpdotstudio](https://x.com/pumpdotstudio) — X

## License

MIT
