# BrakeTrace

Offline-first SPEC Simulations tradeshow web app for matching a Formula 1 driver's brake and throttle trace.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Build

```bash
npm run build
npm run preview
```

## Telemetry

The first bundled fixture is `2026 Chinese Grand Prix / Qualifying` from `TracingInsights-Archive/2026`.

Regenerate it with:

```bash
npm run import:telemetry
```

The generated offline fixture lives at `public/data/chinese-gp-qualifying.json`.

## Kiosk Controls

- Public flow: start challenge, choose circuit, choose driver, choose corner or segment, run, result, leaderboard.
- Hidden operator calibration: press `C` or click the SPEC mark five times.
- Keyboard fallback: `Space` for brake, `W` for throttle.
