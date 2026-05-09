# BrakeTrace

BrakeTrace is an offline-first SPEC Simulations tradeshow web app. A visitor sits in a sim rig, chooses an F1 track, driver, and segment, then tries to match the reference driver's brake and throttle trace for a percentage score and local leaderboard ranking.

## Current State

- React + TypeScript + Vite PWA.
- Public kiosk flow: attract, track, driver, segment, ready, run, result, leaderboard.
- 2025 qualifying fixtures are bundled offline from `TracingInsights-Archive/2025`.
- Tracks are grouped by continent.
- Drivers are grouped by race team and use local thumbnail assets.
- Segments and full-track options use generated track-line maps.
- Run screen has a 3-2-1 countdown before timer and input recording begin.
- Local leaderboard is stored per `track + driver + segment`.
- Hidden operator calibration maps brake and throttle from gamepads or sim pedals.
- Keyboard fallback is available for testing.

## Setup

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. It is usually `http://localhost:5173`, but this workspace has often been using `http://localhost:5174` when another Vite server is already running.

## Build

```bash
npm run build
npm run preview
```

## Controls

- Public start: click `Start challenge`.
- Keyboard test: `Space` or `ArrowDown` for brake, `W` or `ArrowUp` for throttle.
- PS4 default: L2 throttle, R2 brake.
- Hidden calibration: press `C` or click the SPEC mark five times.
- Run controls: pause/resume, quit, and audio retry.

## Data And Assets

- Fixture manifest: `public/data/fixtures-2025-manifest.json`
- Fixture JSON files: `public/data/fixtures-2025/`
- Driver thumbnails: `public/assets/drivers/`
- Current bundled audio: `public/assets/audio/engine-loop.m4a`
- PWA cache list: `public/sw.js`
- Import script: `scripts/import-telemetry.mjs`

Regenerate telemetry after updating the importer:

```bash
npm run import:telemetry
```

## Notes For Next Work

The app was rolled back from a Shanghai full-lap audio experiment. The current baseline uses the earlier bundled engine-loop audio and should not assume per-track audio timecode exists. New audio work should be treated as a separate feature, not a quick patch inside the game timer.
