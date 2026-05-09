# Agent Handoff

This repo is the BrakeTrace tradeshow PWA for SPEC Simulations.

## Start Here

- Read `README.md` for setup and current state.
- Read `PRD.md` for product intent and requirements.
- Main implementation is mostly in `src/main.tsx`.
- Styles are in `src/styles.css`.
- Shared data types are in `src/types.ts`.

## Current Baseline

- Latest functional baseline includes commit `bcdd46b Add pre-run countdown`.
- The app was rolled back from the Shanghai full-lap audio experiment.
- Current audio is `public/assets/audio/engine-loop.m4a`.
- Do not assume per-track audio timecode exists.
- If changing audio, treat it as a separate feature and keep the run timer independent.

## Product Shape

- This is a kiosk game, not a dashboard.
- Public flow: attract -> track -> driver -> segment -> ready -> run -> result -> leaderboard.
- One clear choice per screen.
- During run, centered telemetry graph is the hero.
- Keep copy short, confident, and tradeshow-friendly.

## Data

- 2025 qualifying fixtures are bundled in `public/data/fixtures-2025/`.
- Manifest is `public/data/fixtures-2025-manifest.json`.
- Data came from `TracingInsights-Archive/2025`.
- Import script is `scripts/import-telemetry.mjs`.
- Segments are sector-like groups plus full track.

## Input

- Keyboard fallback:
  - `Space` or `ArrowDown` = brake.
  - `W` or `ArrowUp` = throttle.
- PS4 default:
  - L2 = throttle.
  - R2 = brake.
- Hidden calibration:
  - press `C`, or click the SPEC mark five times.
  - maps brake/throttle axis or button for sim pedals.

## Scoring And Leaderboard

- Score is local only.
- Leaderboard key is `track + driver + segment`.
- Local storage keys are defined near the top of `src/main.tsx`.
- Result screen supports initials and local ranking.

## PWA / Offline

- Service worker is `public/sw.js`.
- Cache includes app shell, manifest, fixture manifest, fixture JSON, driver images, and engine-loop audio.
- When adding offline assets, update `public/sw.js`.
- Bump the cache name if cache behavior changes.

## Design Guardrails

- Use SPEC palette:
  - off-white `#efeff2`
  - near-black `#2d2d34`
  - yellow `#ffc300`
- Keep UI slick, sparse, and kiosk-readable.
- Avoid dashboard panels and dense telemetry tables.
- Avoid decorative clutter.
- Keep graph labels and pedal meters readable from a few feet away.

## Development Commands

```bash
npm install
npm run dev
npm run build
npm run preview
npm run import:telemetry
```

## Before Finishing Work

- Run `npm run build`.
- Verify localhost loads.
- For UI changes, test the full loop manually where possible.
- Do not revert unrelated user changes.
- Commit and push when the user asks or when a feature is complete.

## Known Caution

Audio has been the most fragile area. Previous full-track Shanghai audio/timecode attempts caused run-start issues and were reverted. The next agent should not block gameplay on audio readiness.
