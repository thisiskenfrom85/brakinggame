# BrakeTrace PRD

## Product Summary

BrakeTrace is a minimal, game-like F1 footwork challenge for a SPEC Simulations tradeshow rig. Visitors choose a circuit, driver, and segment, then try to mimic the reference brake and throttle graph using a wheel/pedal device. The app scores the run and stores a local leaderboard for the selected challenge.

## Target Experience

The app should feel like a premium kiosk game, not a telemetry dashboard. The visitor should understand what to do in a few seconds, make one choice per screen, run the challenge, and get a clear percentage score plus local ranking.

## Audience

- Primary: tradeshow visitors trying a SPEC sim rig for the first time.
- Secondary: booth operator who needs fast calibration and reliable reset.
- Development: Codex/new agents extending features in this repo.

## Current User Flow

1. Attract screen: SPEC branding and `Start challenge`.
2. Track selection: tracks grouped by continent.
3. Driver selection: drivers grouped by team with thumbnails.
4. Segment selection: sector-style segments or full track.
5. Ready screen: selected track, driver, segment, preview graph, pedal meters.
6. Run screen: 3-2-1 countdown, centered scrolling telemetry graph, live pedals, pause/quit.
7. Result screen: match score, ranking, score breakdown, initials.
8. Leaderboard: local rankings for the same `track + driver + segment`.

## Core Requirements

- Work offline as a PWA after caching.
- Keep telemetry and required assets bundled in the app.
- Use 2025 qualifying data only.
- Use each driver's trace from the bundled fixture as the reference.
- Support gamepad/sim-pedal brake and throttle input.
- Include keyboard fallback for testing without hardware.
- Provide hidden calibration for booth operators.
- Store leaderboard results locally on the event machine.
- Reset to attract screen after inactivity.
- Keep run graph centered and readable on a tradeshow monitor.

## Design Direction

- Visual language follows the SPEC configurator guide:
  - off-white `#efeff2`
  - near-black `#2d2d34`
  - SPEC yellow `#ffc300` as the only main accent
  - bold uppercase kiosk copy
  - editorial panels and pill CTAs
- Avoid dashboard density.
- During a run, the graph is the hero.
- Copy should stay short and action-oriented.

## Current Implementation

- Framework: React 19, TypeScript, Vite.
- Main app: `src/main.tsx`.
- Styles: `src/styles.css`.
- Types: `src/types.ts`.
- PWA service worker: `public/sw.js`.
- Telemetry fixture data: `public/data/fixtures-2025/`.
- Fixture manifest: `public/data/fixtures-2025-manifest.json`.
- Driver images: `public/assets/drivers/`.
- Audio baseline: `public/assets/audio/engine-loop.m4a`.

## Known Decisions

- Keep this as a web app/PWA, not a native Windows or Mac app.
- Use local-only leaderboard for v1.
- Calibration is hidden from public users.
- Current audio is the pre-Shanghai engine-loop baseline. The Shanghai timecode audio experiment was reverted.
- One-corner challenges were replaced by longer segments or full track.

## Open Product Areas

- Improve robustness of game start and audio unlock across browsers.
- Validate Asetek pedal mapping on actual hardware.
- Improve generated track maps if better licensed vector sources are available.
- Add richer score explanation without making the result screen busy.
- Consider operator tools for clearing/exporting local leaderboard.
- Decide whether per-track audio should return as a separate, well-scoped feature.

## Acceptance Checklist

- User can complete attract -> track -> driver -> segment -> ready -> run -> result -> leaderboard.
- Countdown displays `3`, `2`, `1` before timer starts.
- Keyboard fallback produces visible brake/throttle meter movement.
- Calibration can map a connected pedal device.
- Leaderboard persists after refresh.
- Offline reload works after PWA cache install.
- `npm run build` passes before shipping.
