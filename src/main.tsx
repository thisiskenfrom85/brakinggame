import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  DriverTrace,
  LeaderboardEntry,
  RunSample,
  Sample,
  ScoreBreakdown,
  Segment,
  TrackFixture,
  TrackFixtureSummary,
  TrackMapPoint
} from "./types";
import "./styles.css";

const LEADERBOARD_KEY = "braketrace.leaderboard.v1";
const CALIBRATION_KEY = "braketrace.calibration.v1";
const AUDIO_VOLUME_KEY = "braketrace.audioVolume.v1";
const LEADERBOARD_MAX_ENTRIES = 200;
const LEADERBOARD_RECENT_ENTRIES = 50;
const IDLE_MS = 90_000;
const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
const DRIVER_IMAGE_BASE = assetPath("assets/drivers");
const SHANGHAI_AUDIO_PATH = assetPath("assets/audio/shanghai.m4a");
const SPEC_SECONDARY_LOGO_PATH = assetPath("assets/spec-secondary.svg");
const SEGMENT_ACCENTS = ["#0875e1", "#35d000", "#35b8ff", "#00b988", "#79e500", "#2e8fff", "#62dfb0"];
const PEDAL_CHECK_THRESHOLD = 0.9;
const PS4_L2_BUTTON = 6;
const PS4_R2_BUTTON = 7;
const CHALLENGES = [
  {
    id: "beginner",
    level: "Beginner",
    trackName: "China",
    fixtureId: "2025-chinese-grand-prix-qualifying",
    segmentName: "T1-T5",
    sourceSegments: ["T1-T5"],
    audioPath: SHANGHAI_AUDIO_PATH,
    accent: "#35d000"
  },
  {
    id: "intermediate",
    level: "Intermediate",
    trackName: "Singapore",
    fixtureId: "2025-singapore-grand-prix-qualifying",
    segmentName: "T7-T10",
    sourceSegments: ["T7-T10"],
    audioPath: undefined,
    accent: "#0875e1"
  },
  {
    id: "advance",
    level: "Advance",
    trackName: "UK",
    fixtureId: "2025-british-grand-prix-qualifying",
    segmentName: "T1-T9",
    sourceSegments: ["T1-T5", "T6-T9"],
    audioPath: undefined,
    accent: "#ffc300"
  }
] as const;
const COUNTRY_FLAGS: Record<string, string> = {
  "Australian Grand Prix": "🇦🇺",
  "Chinese Grand Prix": "🇨🇳",
  "Japanese Grand Prix": "🇯🇵",
  "Bahrain Grand Prix": "🇧🇭",
  "Saudi Arabian Grand Prix": "🇸🇦",
  "Miami Grand Prix": "🇺🇸",
  "Emilia Romagna Grand Prix": "🇮🇹",
  "Monaco Grand Prix": "🇲🇨",
  "Spanish Grand Prix": "🇪🇸",
  "Canadian Grand Prix": "🇨🇦",
  "Austrian Grand Prix": "🇦🇹",
  "British Grand Prix": "🇬🇧",
  "Belgian Grand Prix": "🇧🇪",
  "Hungarian Grand Prix": "🇭🇺",
  "Dutch Grand Prix": "🇳🇱",
  "Italian Grand Prix": "🇮🇹",
  "Azerbaijan Grand Prix": "🇦🇿",
  "Singapore Grand Prix": "🇸🇬",
  "United States Grand Prix": "🇺🇸",
  "Mexico City Grand Prix": "🇲🇽",
  "São Paulo Grand Prix": "🇧🇷",
  "Las Vegas Grand Prix": "🇺🇸",
  "Qatar Grand Prix": "🇶🇦",
  "Abu Dhabi Grand Prix": "🇦🇪"
};
const TRACK_CONTINENTS: Record<string, string> = {
  "Australian Grand Prix": "Oceania",
  "Chinese Grand Prix": "Asia",
  "Japanese Grand Prix": "Asia",
  "Bahrain Grand Prix": "Asia",
  "Saudi Arabian Grand Prix": "Asia",
  "Miami Grand Prix": "Americas",
  "Emilia Romagna Grand Prix": "Europe",
  "Monaco Grand Prix": "Europe",
  "Spanish Grand Prix": "Europe",
  "Canadian Grand Prix": "Americas",
  "Austrian Grand Prix": "Europe",
  "British Grand Prix": "Europe",
  "Belgian Grand Prix": "Europe",
  "Hungarian Grand Prix": "Europe",
  "Dutch Grand Prix": "Europe",
  "Italian Grand Prix": "Europe",
  "Azerbaijan Grand Prix": "Europe",
  "Singapore Grand Prix": "Asia",
  "United States Grand Prix": "Americas",
  "Mexico City Grand Prix": "Americas",
  "São Paulo Grand Prix": "Americas",
  "Las Vegas Grand Prix": "Americas",
  "Qatar Grand Prix": "Asia",
  "Abu Dhabi Grand Prix": "Asia"
};
const CONTINENT_ORDER = ["Americas", "Europe", "Asia", "Oceania"];

type DifficultyId = (typeof CHALLENGES)[number]["id"];
type Challenge = (typeof CHALLENGES)[number];
type Screen = "attract" | "track" | "driver" | "pedal-check" | "ready" | "run" | "result" | "leaderboard" | "calibration";
type EngineAudioState = "idle" | "loading" | "running" | "blocked" | "unavailable";
type Calibration = {
  gamepadIndex: number | null;
  brakeAxis: number | null;
  throttleAxis: number | null;
  brakeButton: number | null;
  throttleButton: number | null;
  brakeInvert: boolean;
  throttleInvert: boolean;
  deadZone: number;
};

const defaultCalibration: Calibration = {
  gamepadIndex: null,
  brakeAxis: null,
  throttleAxis: null,
  brakeButton: PS4_R2_BUTTON,
  throttleButton: PS4_L2_BUTTON,
  brakeInvert: false,
  throttleInvert: false,
  deadZone: 0.04
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function formatLap(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  return `${mins}:${secs.toFixed(3).padStart(6, "0")}`;
}

function useLocalStorageState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private browsing and event-floor machines can reject storage writes.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

function capLeaderboard(entries: LeaderboardEntry[]) {
  if (entries.length <= LEADERBOARD_MAX_ENTRIES) return entries;

  const byNewest = [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const recent = byNewest.slice(0, LEADERBOARD_RECENT_ENTRIES);
  const recentIds = new Set(recent.map((entry) => entry.id));
  const highValue = entries
    .filter((entry) => !recentIds.has(entry.id))
    .sort((a, b) => b.score - a.score || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, LEADERBOARD_MAX_ENTRIES - recent.length);

  return [...recent, ...highValue];
}

function segmentSamples(driver: DriverTrace, segment: Segment) {
  const clipped = driver.samples.filter(
    (sample) => sample.distance >= segment.startDistance && sample.distance <= segment.endDistance
  );
  const source = clipped.length > 2 ? clipped : driver.samples;
  const first = source[0];
  return source.map((sample) => ({
    ...sample,
    t: sample.t - first.t,
    distance: sample.distance - first.distance
  }));
}

type TrackMapSource = Pick<TrackFixture, "map" | "segments">;

function trackDistance(fixture: TrackMapSource) {
  const full = fixture.segments.find((item) => item.type === "full") ?? fixture.segments[fixture.segments.length - 1];
  return Math.max(full?.endDistance ?? 1, ...fixture.segments.map((item) => item.endDistance));
}

function fullTrackSegment(fixture: TrackMapSource) {
  return fixture.segments.find((item) => item.type === "full") ?? fixture.segments[fixture.segments.length - 1];
}

function segmentForChallenge(fixture: TrackMapSource, challenge: Challenge): Segment {
  const parts = challenge.sourceSegments
    .map((name) => fixture.segments.find((segment) => segment.name.toLowerCase() === name.toLowerCase()))
    .filter((segment): segment is Segment => Boolean(segment));

  if (!parts.length) return fixture.segments[0];

  return {
    id: `${challenge.id}-${challenge.segmentName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: challenge.segmentName,
    type: "segment",
    startDistance: Math.min(...parts.map((segment) => segment.startDistance)),
    endDistance: Math.max(...parts.map((segment) => segment.endDistance))
  };
}

function flagForEvent(event: string) {
  return COUNTRY_FLAGS[event] ?? "";
}

function continentForEvent(event: string) {
  return TRACK_CONTINENTS[event] ?? "Other";
}

function groupedBy<T>(items: T[], groupFor: (item: T) => string, preferredOrder: string[] = []) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groupFor(item);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      const aIndex = preferredOrder.indexOf(a);
      const bIndex = preferredOrder.indexOf(b);
      if (aIndex >= 0 || bIndex >= 0) return (aIndex >= 0 ? aIndex : 999) - (bIndex >= 0 ? bIndex : 999);
      return a.localeCompare(b);
    })
    .map(([label, groupItems]) => ({ label, items: groupItems }));
}

function pathFromMapPoints(points: Pick<TrackMapPoint, "x" | "y">[]) {
  if (!points.length) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function sampleAt(samples: Sample[], t: number) {
  if (t <= samples[0].t) return samples[0];
  const last = samples[samples.length - 1];
  if (t >= last.t) return last;

  let high = samples.length - 1;
  let low = 0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].t < t) low = mid + 1;
    else high = mid;
  }

  const b = samples[low];
  const a = samples[Math.max(0, low - 1)];
  const span = Math.max(0.001, b.t - a.t);
  const ratio = (t - a.t) / span;
  return {
    t,
    distance: a.distance + (b.distance - a.distance) * ratio,
    throttle: a.throttle + (b.throttle - a.throttle) * ratio,
    brake: a.brake + (b.brake - a.brake) * ratio,
    speed: a.speed + (b.speed - a.speed) * ratio,
    rpm: a.rpm + (b.rpm - a.rpm) * ratio,
    gear: Math.round(a.gear + (b.gear - a.gear) * ratio)
  };
}

function normalizeAxis(value: number, invert: boolean, deadZone: number) {
  const normalized = invert ? (1 - value) / 2 : (value + 1) / 2;
  return clamp(normalized < deadZone ? 0 : normalized);
}

function readPedals(calibration: Calibration, keyboard: { brake: boolean; throttle: boolean }) {
  const pads = navigator.getGamepads?.() ?? [];
  const activePads = Array.from(pads).filter(Boolean) as Gamepad[];
  const configuredIndex = calibration.gamepadIndex ?? null;
  const pad = configuredIndex !== null ? pads[configuredIndex] ?? null : activePads[0] ?? null;
  const brakeAxis = typeof calibration.brakeAxis === "number" ? calibration.brakeAxis : null;
  const throttleAxis = typeof calibration.throttleAxis === "number" ? calibration.throttleAxis : null;
  const brakeButton = typeof calibration.brakeButton === "number" ? calibration.brakeButton : null;
  const throttleButton = typeof calibration.throttleButton === "number" ? calibration.throttleButton : null;
  let brake = keyboard.brake ? 1 : 0;
  let throttle = keyboard.throttle ? 1 : 0;

  if (pad) {
    if (brakeAxis !== null) {
      brake = Math.max(brake, normalizeAxis(pad.axes[brakeAxis] ?? -1, calibration.brakeInvert, calibration.deadZone));
    } else if (brakeButton !== null) {
      brake = Math.max(brake, pad.buttons[brakeButton]?.value ?? 0);
    }

    if (throttleAxis !== null) {
      throttle = Math.max(throttle, normalizeAxis(pad.axes[throttleAxis] ?? -1, calibration.throttleInvert, calibration.deadZone));
    } else if (throttleButton !== null) {
      throttle = Math.max(throttle, pad.buttons[throttleButton]?.value ?? 0);
    }
  }

  return { brake: clamp(brake), throttle: clamp(throttle), connected: Boolean(pad), pad, pads: activePads };
}

function useKeyboardPedals() {
  const [keyboard, setKeyboard] = useState({ brake: false, throttle: false });

  useEffect(() => {
    const update = (event: KeyboardEvent, pressed: boolean) => {
      if (event.code === "Space" || event.code === "ArrowDown") {
        event.preventDefault();
        setKeyboard((current) => ({ ...current, brake: pressed }));
      }
      if (event.code === "KeyW" || event.code === "ArrowUp") {
        event.preventDefault();
        setKeyboard((current) => ({ ...current, throttle: pressed }));
      }
    };
    const down = (event: KeyboardEvent) => update(event, true);
    const up = (event: KeyboardEvent) => update(event, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return keyboard;
}

function useLivePedals(calibration: Calibration) {
  const keyboard = useKeyboardPedals();
  const [pedals, setPedals] = useState(() => readPedals(calibration, keyboard));

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setPedals(readPedals(calibration, keyboard));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [calibration, keyboard]);

  return pedals;
}

function scoreRun(reference: Sample[], run: RunSample[]): ScoreBreakdown {
  if (run.length < 3) {
    return { score: 0, brakeTimingMs: 999, releaseShape: 0, throttlePickup: 0, smoothness: 0 };
  }

  const refBrakeStart = reference.find((sample) => sample.brake > 0.5)?.t ?? 0;
  const userBrakeSample = run.find((sample) => sample.brake > 0.2);
  const userBrakeStart = userBrakeSample?.t ?? run[run.length - 1].t;
  const brakeTimingMs = Math.round((userBrakeStart - refBrakeStart) * 1000);
  const usedBrake = Boolean(userBrakeSample);
  const usedThrottle = run.some((sample) => sample.throttle > 0.2);

  let brakeError = 0;
  let throttleError = 0;
  let count = 0;
  for (const sample of run) {
    const ref = sampleAt(reference, sample.t);
    brakeError += Math.abs(sample.brake - ref.brake);
    throttleError += Math.abs(sample.throttle * 100 - ref.throttle) / 100;
    count += 1;
  }

  let jitter = 0;
  for (let i = 1; i < run.length; i += 1) {
    jitter += Math.abs(run[i].brake - run[i - 1].brake) + Math.abs(run[i].throttle - run[i - 1].throttle);
  }

  const releaseShape = usedBrake ? Math.round(clamp(1 - brakeError / count) * 100) : 0;
  const throttlePickup = usedThrottle ? Math.round(clamp(1 - throttleError / count) * 100) : 0;
  const smoothness = usedBrake || usedThrottle ? Math.round(clamp(1 - jitter / Math.max(1, run.length * 0.18)) * 100) : 0;
  const timingScore = clamp(1 - Math.abs(brakeTimingMs) / 900) * 100;
  const score = Math.round(timingScore * 0.28 + releaseShape * 0.34 + throttlePickup * 0.28 + smoothness * 0.1);

  return {
    score,
    brakeTimingMs,
    releaseShape,
    throttlePickup,
    smoothness
  };
}

function leaderboardKey(challenge: Challenge) {
  return `difficulty:${challenge.id}`;
}

function sortedLeaderboard(entries: LeaderboardEntry[], key: string) {
  return entries
    .filter((entry) => entry.key === key)
    .sort((a, b) => b.score - a.score || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function fastestDriver(drivers: DriverTrace[]) {
  return [...drivers].sort((a, b) => a.lapTime - b.lapTime)[0] ?? null;
}

function SpecLogo({ onSecret, iconOnly = false, size = "normal" }: { onSecret?: () => void; iconOnly?: boolean; size?: "normal" | "compact" | "hero" }) {
  return (
    <button
      className={`spec-mark ${iconOnly ? "spec-mark-icon-only" : ""} spec-mark-${size}`}
      onClick={onSecret}
      aria-label="SPEC Simulations"
      type="button"
    >
      <img src={SPEC_SECONDARY_LOGO_PATH} alt="" />
      {!iconOnly && <span>SPEC Simulations</span>}
    </button>
  );
}

function Eyebrow({ children, tag = false }: { children: React.ReactNode; tag?: boolean }) {
  return <span className={tag ? "eyebrow eyebrow-tag" : "eyebrow"}>{children}</span>;
}

function Button({
  children,
  variant = "primary",
  onClick,
  disabled = false,
  size = "normal"
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  onClick?: () => void;
  disabled?: boolean;
  size?: "normal" | "large";
}) {
  return (
    <button className={`button button-${variant} ${size === "large" ? "button-large" : ""}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function StepChrome({
  eyebrow,
  title,
  italic,
  children,
  onBack,
  onNext,
  nextLabel = "Next",
  nextDisabled = false,
  nextProminent = false,
  onSecret
}: {
  eyebrow: string;
  title: string;
  italic?: string;
  children: React.ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextProminent?: boolean;
  onSecret?: () => void;
}) {
  return (
    <main className="step-screen">
      <div className="broadcast-grid-bg" aria-hidden="true" />
      <header className="topbar">
        <button className="back-button" onClick={onBack} disabled={!onBack}>
          {onBack ? "Back" : ""}
        </button>
        <SpecLogo onSecret={onSecret} iconOnly size="compact" />
        <div className="topbar-side">
          <span />
        </div>
      </header>

      <section className="step-content">
        <div className="step-title-block">
          <span className="step-caption">SPEC challenge</span>
          <h1>{title}</h1>
          {italic ? <p className="italic-line">{italic}</p> : null}
        </div>
        <div className="step-options">{children}</div>
      </section>

      {onNext ? (
        <footer className={`step-footer ${nextProminent ? "step-footer-prominent" : ""}`}>
          <Button onClick={onNext} disabled={nextDisabled} size={nextProminent ? "large" : "normal"}>
            {nextLabel}
          </Button>
        </footer>
      ) : null}
    </main>
  );
}

function ChoiceGrid<T extends string>({
  items,
  selected,
  onSelect
}: {
  items: { id: T; eyebrow?: string; title: string; meta?: string; accent?: string; flag?: string; visual?: React.ReactNode }[];
  selected: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="choice-grid">
      {items.map((item) => (
        <button
          className={`choice ${selected === item.id ? "selected" : ""}`}
          key={item.id}
          onClick={() => onSelect(item.id)}
          style={{ "--choice-accent": item.accent ?? "var(--accent)" } as React.CSSProperties}
        >
          <span className="choice-rule" />
          {item.flag ? <span className="choice-flag">{item.flag}</span> : null}
          {item.visual ? <span className="choice-visual">{item.visual}</span> : null}
          <span className="choice-copy">
            {item.eyebrow ? <span className="eyebrow">{item.eyebrow}</span> : null}
            <strong>{item.title}</strong>
            {item.meta ? <small>{item.meta}</small> : null}
          </span>
          <span className="choice-status">{selected === item.id ? "Locked" : "Select"}</span>
        </button>
      ))}
    </div>
  );
}

function GroupedChoiceGrid<T extends string>({
  groups,
  selected,
  onSelect,
  className = ""
}: {
  groups: {
    label: string;
    items: { id: T; eyebrow?: string; title: string; meta?: string; accent?: string; flag?: string; visual?: React.ReactNode }[];
  }[];
  selected: T;
  onSelect: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={`choice-groups ${className}`}>
      {groups.map((group) => (
        <section className="choice-group" key={group.label}>
          <div className="choice-group-label">
            <Eyebrow>{group.label}</Eyebrow>
          </div>
          <ChoiceGrid items={group.items} selected={selected} onSelect={onSelect} />
        </section>
      ))}
    </div>
  );
}

function TrackMap({
  fixture,
  segment,
  accent,
  label
}: {
  fixture: TrackMapSource;
  segment?: Segment;
  accent?: string;
  label?: string;
}) {
  const points = fixture.map?.points ?? [];
  const basePath = pathFromMapPoints(points);
  const highlightPoints =
    segment && segment.type !== "full"
      ? points.filter((point) => point.distance >= segment.startDistance && point.distance <= segment.endDistance)
      : points;
  const highlightPath = pathFromMapPoints(highlightPoints.length > 1 ? highlightPoints : points);

  return (
    <span
      className="track-map-wrap"
      role="img"
      aria-label={label ?? "Track map"}
      style={{ "--segment-accent": accent ?? "var(--accent)" } as React.CSSProperties}
    >
      <svg className="track-line-map" viewBox="0 0 240 150" aria-hidden="true">
        <path className="track-line-base" d={basePath} />
        <path className="track-line-highlight-halo" d={highlightPath} />
        <path className="track-line-highlight" d={highlightPath} />
      </svg>
    </span>
  );
}

function DriverThumb({ driver }: { driver: DriverTrace }) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <span className="driver-thumb" style={{ "--driver-accent": driver.color } as React.CSSProperties}>
      {imageFailed ? (
        <strong className="driver-thumb-fallback">{driver.code}</strong>
      ) : (
        <img src={`${DRIVER_IMAGE_BASE}/${driver.code}.webp`} alt={driver.name} onError={() => setImageFailed(true)} />
      )}
      <span>{driver.code}</span>
    </span>
  );
}

function PedalMeters({ brake, throttle }: { brake: number; throttle: number }) {
  return (
    <div className="pedal-meters">
      <div className="pedal-meter pedal-meter-throttle">
        <span>Throttle</span>
        <div><i style={{ transform: `scaleX(${throttle})` }} /></div>
        <b>{Math.round(throttle * 100)}</b>
      </div>
      <div className="pedal-meter pedal-meter-brake">
        <span>Brake</span>
        <div><i style={{ transform: `scaleX(${brake})` }} /></div>
        <b>{Math.round(brake * 100)}</b>
      </div>
    </div>
  );
}

function TelemetryGraph({
  reference,
  run,
  progress,
  variant = "live",
  readout,
  timeRemaining,
  brake,
  throttle
}: {
  reference: Sample[];
  run: RunSample[];
  progress: number;
  variant?: "preview" | "live";
  readout?: string;
  timeRemaining?: number;
  brake?: number;
  throttle?: number;
}) {
  const width = 1000;
  const height = 440;
  const padding = 52;
  const duration = reference[reference.length - 1].t;
  const focusTime = clamp(progress) * duration;
  const shouldPan = duration > 18;
  const windowDuration = shouldPan ? Math.min(14, Math.max(8, duration * 0.16)) : duration;
  const rawWindowStart = focusTime - windowDuration * 0.38;
  const windowStart = shouldPan ? clamp(rawWindowStart, 0, Math.max(0, duration - windowDuration)) : 0;
  const windowEnd = shouldPan ? windowStart + windowDuration : duration;
  const windowSpan = Math.max(0.001, windowEnd - windowStart);

  const points = useCallback(
    (values: { t: number; brake?: number; throttle?: number }[], key: "brake" | "throttle", scale = 1) =>
      values
        .filter((sample) => sample.t >= windowStart - windowSpan * 0.08 && sample.t <= windowEnd + windowSpan * 0.08)
        .map((sample) => {
          const x = padding + ((sample.t - windowStart) / windowSpan) * (width - padding * 2);
          const value = key === "brake" ? sample.brake ?? 0 : sample.throttle ?? 0;
          const y = height - padding - clamp(value / scale) * (height - padding * 2);
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" "),
    [windowEnd, windowSpan, windowStart]
  );

  const playhead = padding + clamp((focusTime - windowStart) / windowSpan) * (width - padding * 2);

  return (
    <div className={`graph-shell graph-shell-${variant}`}>
      <div className="graph-labels">
        <span>Reference trace</span>
        <strong>{readout ?? "Brake / throttle"}</strong>
        {typeof timeRemaining === "number" ? (
          <span className="graph-clock">
            <b>{Math.max(0, timeRemaining).toFixed(1)}</b>
            <small>Time remaining</small>
          </span>
        ) : (
          <span>Your input</span>
        )}
      </div>
      <div className={`telemetry-live-layout ${typeof brake === "number" && typeof throttle === "number" ? "" : "telemetry-live-layout-single"}`}>
        <div className="telemetry-stage">
          <div className="telemetry-zone telemetry-zone-brake">Brake phase</div>
          <div className="telemetry-zone telemetry-zone-release">Release window</div>
          <div className="telemetry-progress" style={{ transform: `scaleX(${clamp(progress)})` }} />
          <svg className="telemetry-graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Brake and throttle trace">
            <rect x="0" y="0" width={width} height={height} rx="8" />
            {[0, 0.25, 0.5, 0.75, 1].map((line) => (
              <React.Fragment key={`grid-${line}`}>
                <line
                  x1={padding + line * (width - padding * 2)}
                  x2={padding + line * (width - padding * 2)}
                  y1={padding}
                  y2={height - padding}
                />
                <line
                  x1={padding}
                  x2={width - padding}
                  y1={padding + line * (height - padding * 2)}
                  y2={padding + line * (height - padding * 2)}
                />
              </React.Fragment>
            ))}
            <polyline className="trace trace-brake-ref" points={points(reference, "brake")} />
            <polyline className="trace trace-throttle-ref" points={points(reference, "throttle", 100)} />
            <polyline className="trace trace-brake-user" points={points(run, "brake")} />
            <polyline className="trace trace-throttle-user" points={points(run, "throttle")} />
            <line className="playhead" x1={playhead} x2={playhead} y1={padding} y2={height - padding} />
            <circle className="playhead-dot" cx={playhead} cy={padding + 12} r="9" />
            <text x={padding} y={height - 18}>BRAKE</text>
            <text x={width - padding - 90} y={height - 18}>THROTTLE</text>
          </svg>
        </div>
        {typeof brake === "number" && typeof throttle === "number" ? (
          <div className="graph-pedal-panel">
            <PedalMeters brake={brake} throttle={throttle} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CalibrationScreen({
  calibration,
  setCalibration,
  audioVolume,
  setAudioVolume,
  pedals,
  onDone
}: {
  calibration: Calibration;
  setCalibration: (calibration: Calibration) => void;
  audioVolume: number;
  setAudioVolume: (volume: number) => void;
  pedals: ReturnType<typeof useLivePedals>;
  onDone: () => void;
}) {
  const pad = pedals.pad;
  const gamepads = pedals.pads;
  const axes = pad?.axes ?? [];
  const buttons = pad?.buttons ?? [];
  const [detectTarget, setDetectTarget] = useState<"brake" | "throttle" | null>(null);
  const baselineRef = useRef<{ axes: number[]; buttons: number[] } | null>(null);

  const assignAxis = useCallback(
    (target: "brake" | "throttle", axis: number) => {
      if (target === "brake") {
        setCalibration({ ...calibration, brakeAxis: axis, brakeButton: null });
      } else {
        setCalibration({ ...calibration, throttleAxis: axis, throttleButton: null });
      }
    },
    [calibration, setCalibration]
  );

  const assignButton = useCallback(
    (target: "brake" | "throttle", button: number) => {
      if (target === "brake") {
        setCalibration({ ...calibration, brakeAxis: null, brakeButton: button });
      } else {
        setCalibration({ ...calibration, throttleAxis: null, throttleButton: button });
      }
    },
    [calibration, setCalibration]
  );

  const setAxis = (key: "brakeAxis" | "throttleAxis", axis: number) => {
    assignAxis(key === "brakeAxis" ? "brake" : "throttle", axis);
  };

  const setButton = (key: "brakeButton" | "throttleButton", button: number) => {
    assignButton(key === "brakeButton" ? "brake" : "throttle", button);
  };

  const startDetect = (target: "brake" | "throttle") => {
    baselineRef.current = {
      axes: [...axes],
      buttons: buttons.map((button) => button.value)
    };
    setDetectTarget(target);
  };

  const setPs4Preset = () => {
    setCalibration({
      ...calibration,
      gamepadIndex: pad?.index ?? calibration.gamepadIndex,
      brakeAxis: null,
      throttleAxis: null,
      brakeButton: PS4_R2_BUTTON,
      throttleButton: PS4_L2_BUTTON
    });
  };

  const clearMapping = () => {
    setCalibration({
      ...calibration,
      brakeAxis: null,
      throttleAxis: null,
      brakeButton: null,
      throttleButton: null
    });
  };

  useEffect(() => {
    if (!detectTarget || !pad || !baselineRef.current) return;

    const baseline = baselineRef.current;
    const axisIndex = axes.findIndex((axis, index) => Math.abs(axis - (baseline.axes[index] ?? 0)) > 0.28);
    if (axisIndex >= 0) {
      assignAxis(detectTarget, axisIndex);
      baselineRef.current = null;
      setDetectTarget(null);
      return;
    }

    const buttonIndex = buttons.findIndex((button, index) => button.value > 0.35 && Math.abs(button.value - (baseline.buttons[index] ?? 0)) > 0.25);
    if (buttonIndex >= 0) {
      assignButton(detectTarget, buttonIndex);
      baselineRef.current = null;
      setDetectTarget(null);
    }
  }, [assignAxis, assignButton, axes, buttons, detectTarget, pad]);

  return (
    <main className="calibration-screen">
      <header className="topbar">
        <button className="back-button" onClick={onDone}>Close</button>
        <SpecLogo iconOnly size="compact" />
        <Eyebrow>Operator</Eyebrow>
      </header>
      <section className="calibration-panel">
        <Eyebrow tag>Rig setup</Eyebrow>
        <h1>Map the pedals.</h1>
        <p className="italic-line">Connect the rig, press each pedal, and assign the axis that moves.</p>
        <div className="operator-status">
          {pad ? `${pad.id} connected` : "No game controller detected. Keyboard fallback is active."}
        </div>
        <div className="operator-actions">
          <Button onClick={() => startDetect("throttle")} disabled={!pad}>
            {detectTarget === "throttle" ? "Press throttle..." : "Detect throttle"}
          </Button>
          <Button onClick={() => startDetect("brake")} disabled={!pad}>
            {detectTarget === "brake" ? "Press brake..." : "Detect brake"}
          </Button>
          <Button variant="secondary" onClick={setPs4Preset}>PS4 L2 throttle · R2 brake</Button>
          <Button variant="ghost" onClick={clearMapping}>Clear</Button>
        </div>
        <div className="calibration-grid">
          <div>
            <h2>Device</h2>
            {gamepads.length ? (
              <div className="device-list">
                {gamepads.map((gamepad) => (
                  <button
                    className={`device-option ${pad?.index === gamepad.index ? "selected" : ""}`}
                    key={gamepad.index}
                    onClick={() => setCalibration({ ...calibration, gamepadIndex: gamepad.index })}
                  >
                    <strong>{gamepad.id}</strong>
                    <span>{gamepad.axes.length} axes · {gamepad.buttons.length} buttons · index {gamepad.index}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="small-copy">Press any pedal or reconnect the Asetek device so the browser exposes it.</p>
            )}
            <h2>Axes</h2>
            {axes.length ? axes.map((axis, index) => (
              <div className="axis-row" key={index}>
                <span>Axis {index}</span>
                <div><i style={{ transform: `scaleX(${clamp((axis + 1) / 2)})` }} /></div>
                <Button variant="secondary" onClick={() => setAxis("brakeAxis", index)}>Brake</Button>
                <Button variant="secondary" onClick={() => setAxis("throttleAxis", index)}>Throttle</Button>
              </div>
            )) : <p className="small-copy">Move a pedal or reconnect the wheelbase to expose axes.</p>}
            <h2>Buttons</h2>
            {buttons.length ? buttons.map((button, index) => (
              <div className="axis-row" key={index}>
                <span>Button {index}</span>
                <div><i style={{ transform: `scaleX(${clamp(button.value)})` }} /></div>
                <Button variant="secondary" onClick={() => setButton("brakeButton", index)}>Brake</Button>
                <Button variant="secondary" onClick={() => setButton("throttleButton", index)}>Throttle</Button>
              </div>
            )) : <p className="small-copy">Buttons will appear here if this device exposes any.</p>}
          </div>
          <div>
            <h2>Live input</h2>
            <PedalMeters brake={pedals.brake} throttle={pedals.throttle} />
            <div className="mapping-summary">
              <span>Device</span>
              <strong>{pad ? `Index ${pad.index}` : "None"}</strong>
              <span>Brake</span>
              <strong>{calibration.brakeAxis !== null ? `Axis ${calibration.brakeAxis}` : calibration.brakeButton !== null ? `Button ${calibration.brakeButton}` : "Not mapped"}</strong>
              <span>Throttle</span>
              <strong>{calibration.throttleAxis !== null ? `Axis ${calibration.throttleAxis}` : calibration.throttleButton !== null ? `Button ${calibration.throttleButton}` : "Not mapped"}</strong>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={calibration.brakeInvert}
                onChange={(event) => setCalibration({ ...calibration, brakeInvert: event.target.checked })}
              />
              Invert brake
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={calibration.throttleInvert}
                onChange={(event) => setCalibration({ ...calibration, throttleInvert: event.target.checked })}
              />
              Invert throttle
            </label>
            <label className="range-row">
              Dead zone
              <input
                type="range"
                min="0"
                max="0.2"
                step="0.01"
                value={calibration.deadZone}
                onChange={(event) => setCalibration({ ...calibration, deadZone: Number(event.target.value) })}
              />
            </label>
          </div>
        </div>
        <AudioDiagnostics volume={audioVolume} setVolume={setAudioVolume} />
        {buttons.length ? <p className="small-copy">PS4 preset uses button 6 for L2 throttle and button 7 for R2 brake. The Ready screen pedal meters are the quickest test.</p> : null}
      </section>
    </main>
  );
}

function AudioDiagnostics({ volume, setVolume }: { volume: number; setVolume: (volume: number) => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<EngineAudioState>("idle");
  const [message, setMessage] = useState("Ready to test.");

  const stopTest = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    audioRef.current = null;
    setState("idle");
    setMessage("Audio test stopped.");
  }, []);

  useEffect(() => () => stopTest(), [stopTest]);

  const startTest = async () => {
    if (audioRef.current) {
      stopTest();
      return;
    }

    setState("loading");
    setMessage("Loading Shanghai clip.");

    try {
      const audio = new Audio(SHANGHAI_AUDIO_PATH);
      audio.volume = volume;
      audioRef.current = audio;
      await audio.play();
      setState("running");
      setMessage("Shanghai clip playing.");
    } catch (error) {
      audioRef.current = null;
      setState("unavailable");
      setMessage(error instanceof Error ? error.message : "Audio failed to play.");
    }
  };

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  return (
    <div className="audio-diagnostics">
      <div>
        <h2>Audio</h2>
        <div className="mapping-summary">
          <span>Clip</span>
          <strong>Shanghai</strong>
          <span>State</span>
          <strong>{state}</strong>
        </div>
        <p className="small-copy">{message}</p>
      </div>
      <div>
        <div className="operator-actions">
          <Button onClick={startTest}>{audioRef.current ? "Stop audio" : "Test audio"}</Button>
          <Button variant="ghost" onClick={stopTest}>Mute</Button>
        </div>
        <label className="range-row">
          Master volume
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
      </div>
    </div>
  );
}

function RunScreen({
  segment,
  reference,
  calibration,
  audioVolume,
  audioPath,
  audioElement,
  onComplete,
  onQuit
}: {
  segment: Segment;
  reference: Sample[];
  calibration: Calibration;
  audioVolume: number;
  audioPath?: string;
  audioElement?: HTMLAudioElement;
  onComplete: (run: RunSample[], breakdown: ScoreBreakdown) => void;
  onQuit: () => void;
}) {
  const pedals = useLivePedals(calibration);
  const pedalsRef = useRef(pedals);
  const [run, setRun] = useState<RunSample[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(3);
  const pausedRef = useRef(false);
  const countdownDoneRef = useRef(false);
  const elapsedRef = useRef(0);
  const lastPaintAt = useRef(0);
  const lastSampleAt = useRef(0);
  const runStartedAt = useRef<number | null>(null);
  const pauseStartedAt = useRef<number | null>(null);
  const totalPausedMs = useRef(0);
  const runRef = useRef<RunSample[]>([]);
  const completedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioVolumeRef = useRef(audioVolume);
  const duration = reference[reference.length - 1].t;

  useEffect(() => {
    pedalsRef.current = pedals;
  }, [pedals]);

  useEffect(() => {
    audioVolumeRef.current = audioVolume;
  }, [audioVolume]);

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) {
      pauseStartedAt.current = performance.now();
      return;
    }
    if (pauseStartedAt.current !== null) {
      totalPausedMs.current += performance.now() - pauseStartedAt.current;
      pauseStartedAt.current = null;
    }
  }, [paused]);

  useEffect(() => {
    countdownDoneRef.current = false;
    setCountdown(3);
    const timers = [1, 2, 3].map((second) =>
      window.setTimeout(() => {
        if (second < 3) {
          const nextCountdown = 3 - second;
          setCountdown(nextCountdown);
          if (nextCountdown === 1 && audioRef.current) {
            const audio = audioRef.current;
            audio.muted = false;
            audio.volume = audioVolumeRef.current;
            audio.currentTime = 0;
            if (audio.paused) {
              audio.play().catch(() => {
                // Audio approval is still under review; failed playback must not block the run.
              });
            }
          }
          return;
        }
        countdownDoneRef.current = true;
        setCountdown(null);
      }, second * 1000)
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (audioElement || audioPath) {
      const audio = audioElement ?? new Audio(audioPath);
      audio.preload = "auto";
      audio.muted = true;
      audio.volume = 0;
      audioRef.current = audio;
      if (!audioElement) {
        audio.load();
        audio.play().catch(() => {
          // Muted warm-up can still fail in strict browsers; do not block the run.
        });
      }
    }

    let frame = 0;
    const tick = (now: number) => {
      const runActive = countdownDoneRef.current;

      if (!pausedRef.current && runActive) {
        if (runStartedAt.current === null) {
          runStartedAt.current = now;
        }
        elapsedRef.current = Math.max(0, (now - runStartedAt.current - totalPausedMs.current) / 1000);
      }

      const t = elapsedRef.current;
      const ref = sampleAt(reference, t);
      const currentPedals = pedalsRef.current;

      if (now - lastPaintAt.current >= 50) {
        setElapsed(t);
        lastPaintAt.current = now;
      }

      if (runActive && !pausedRef.current && t - lastSampleAt.current >= 1 / 24) {
        const sample = { t, brake: currentPedals.brake, throttle: currentPedals.throttle };
        runRef.current.push(sample);
        lastSampleAt.current = t;
        setRun((current) => {
          const next = [...current, sample];
          return next.length > 420 ? next.slice(next.length - 420) : next;
        });
      }

      if (t >= duration && !completedRef.current) {
        completedRef.current = true;
        const finalRun = runRef.current;
        const breakdown = scoreRun(reference, finalRun);
        window.setTimeout(() => onComplete(finalRun, breakdown), 0);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      audioRef.current = null;
    };
  }, [audioPath, audioVolume, duration, onComplete, reference]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = audioVolume;
  }, [audioVolume]);

  const ref = sampleAt(reference, elapsed);
  const pedalDelta = pedals.brake - ref.brake;
  const prompt = ref.brake > 0.5 ? "Brake now" : ref.throttle > 50 ? "Power" : "Release";
  const deltaReadout = countdown !== null
    ? "Grid set"
    : Math.abs(pedalDelta) < 0.12
      ? "Delta good"
      : pedalDelta > 0
        ? "Too much brake"
        : "Late brake";
  const command = countdown !== null
    ? "Get ready"
    : paused
      ? "Paused"
      : prompt;

  return (
    <main className="run-screen">
      <div className="broadcast-grid-bg" aria-hidden="true" />
      <header className="run-header">
        <div className="run-brand-stack">
          <SpecLogo iconOnly size="compact" />
        </div>
        <div>
          <Eyebrow>Live challenge · Pro Trace</Eyebrow>
          <strong>{segment.name}</strong>
        </div>
      </header>
      <section className="stage">
        {countdown !== null ? (
          <div className="countdown-overlay" aria-live="polite">
            {countdown}
          </div>
        ) : null}
        <TelemetryGraph
          reference={reference}
          run={run}
          progress={clamp(elapsed / duration)}
          readout={`${command} · ${deltaReadout}`}
          timeRemaining={duration - elapsed}
          brake={pedals.brake}
          throttle={pedals.throttle}
        />
      </section>
      <footer className="run-footer">
        <div className="run-control">
          <Button variant="secondary" onClick={() => setPaused((current) => !current)}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button variant="ghost" onClick={onQuit}>
            Quit
          </Button>
        </div>
        <div className="run-hint">L2 throttle · R2 brake · Space/W keyboard</div>
      </footer>
    </main>
  );
}

function PedalCheckScreen({
  calibration,
  onBack,
  onReady
}: {
  calibration: Calibration;
  onBack: () => void;
  onReady: () => void;
}) {
  const pedals = useLivePedals(calibration);
  const [throttleComplete, setThrottleComplete] = useState(false);
  const [brakeComplete, setBrakeComplete] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (pedals.throttle >= PEDAL_CHECK_THRESHOLD) setThrottleComplete(true);
  }, [pedals.throttle]);

  useEffect(() => {
    if (throttleComplete && pedals.brake >= PEDAL_CHECK_THRESHOLD) setBrakeComplete(true);
  }, [pedals.brake, throttleComplete]);

  useEffect(() => {
    if (!brakeComplete || startedRef.current) return;
    startedRef.current = true;
    onReady();
  }, [brakeComplete, onReady]);

  const ready = throttleComplete && brakeComplete;
  const instruction = !throttleComplete
    ? "Push throttle to 90%"
    : !brakeComplete
      ? "Push brake to 90%"
      : "Pedals checked";

  return (
    <StepChrome
      eyebrow="04 · Pedal check"
      title={instruction}
      italic="Confirm full travel before the timed trace starts."
      onBack={onBack}
      onNext={onReady}
      nextLabel="Begin session"
      nextDisabled={!ready}
      nextProminent
    >
      <div className="ready-stage pedal-check-stage">
        <div className="pedal-check-steps">
          <div className={`pedal-check-step ${throttleComplete ? "complete" : ""}`}>
            <span>01</span>
            <strong>Throttle 90%</strong>
            <small>{throttleComplete ? "Complete" : "Waiting for throttle"}</small>
          </div>
          <div className={`pedal-check-step ${brakeComplete ? "complete" : ""}`}>
            <span>02</span>
            <strong>Brake 90%</strong>
            <small>{brakeComplete ? "Starting session" : throttleComplete ? "Waiting for brake" : "Complete throttle first"}</small>
          </div>
        </div>
        <PedalMeters brake={pedals.brake} throttle={pedals.throttle} />
      </div>
    </StepChrome>
  );
}

function ResultScreen({
  entry,
  ranking,
  breakdown,
  segment,
  challenge,
  onInitials,
  onAgain,
  onLeaderboard,
  onNextPlayer
}: {
  entry: LeaderboardEntry;
  ranking: number;
  breakdown: ScoreBreakdown;
  segment: Segment;
  challenge: Challenge;
  onInitials: (initials: string) => void;
  onAgain: () => void;
  onLeaderboard: () => void;
  onNextPlayer: () => void;
}) {
  return (
    <main className="result-screen">
      <div className="broadcast-grid-bg" aria-hidden="true" />
      <header className="topbar">
        <span />
        <SpecLogo iconOnly size="compact" />
        <Eyebrow>Result</Eyebrow>
      </header>
      <section className="result-content">
        <div className="result-title-block">
          <span className="step-caption">SPEC Challenge</span>
        </div>
        <div className="session-bug">
          <Eyebrow tag>{challenge.trackName} · {segment.name}</Eyebrow>
          <span>Final classification</span>
        </div>
        <h1>{breakdown.score}% MATCH</h1>
        <p className="italic-line">P{ranking} in {challenge.level}.</p>
        <div className="result-stats">
          <Stat label="Brake timing" value={`${breakdown.brakeTimingMs > 0 ? "+" : ""}${breakdown.brakeTimingMs} ms`} />
          <Stat label="Release shape" value={`${breakdown.releaseShape}%`} />
          <Stat label="Throttle pickup" value={`${breakdown.throttlePickup}%`} />
        </div>
        <div className="result-next-panel">
          <div className="result-save-row">
            <label className="initials-field">
              <span>Initials</span>
              <input
                value={entry.initials}
                maxLength={3}
                onChange={(event) => onInitials(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              />
            </label>
            <Button variant="secondary" onClick={onLeaderboard}>Leaderboard</Button>
          </div>
          <div className="result-actions">
            <Button onClick={onAgain}>Run again</Button>
            <Button variant="ghost" onClick={onNextPlayer}>Next player</Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LeaderboardScreen({
  entries,
  challenge,
  onBack,
  onNextPlayer
}: {
  entries: LeaderboardEntry[];
  challenge: Challenge;
  onBack: () => void;
  onNextPlayer: () => void;
}) {
  return (
    <main className="leaderboard-screen">
      <div className="broadcast-grid-bg" aria-hidden="true" />
      <header className="topbar">
        <button className="back-button" onClick={onBack}>Back</button>
        <SpecLogo iconOnly size="compact" />
        <Eyebrow>Leaderboard</Eyebrow>
      </header>
      <section className="leaderboard-content">
        <div className="session-bug">
          <Eyebrow tag>{challenge.level} · {challenge.trackName}</Eyebrow>
          <span>Local timing tower</span>
        </div>
        <h1>Local ranking.</h1>
        <div className="leaderboard-list">
          {entries.slice(0, 10).map((entry, index) => (
            <div className="leaderboard-row" key={entry.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{entry.initials || "---"}</strong>
              <b>{entry.score}%</b>
              <small>{entry.trackName ?? challenge.trackName}, {entry.driverName ?? entry.driver}, {entry.segmentName ?? entry.segment}</small>
            </div>
          ))}
          {!entries.length ? <p className="small-copy">No runs yet. First clean lap writes the board.</p> : null}
        </div>
        <Button onClick={onNextPlayer}>Next player</Button>
      </section>
    </main>
  );
}

function AppRoot() {
  const [tracks, setTracks] = useState<TrackFixtureSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(assetPath("data/fixtures-2025-manifest.json"))
      .then((response) => {
        if (!response.ok) throw new Error(`Telemetry failed: ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) throw new Error("No qualifying fixtures found");
        setTracks(data as TrackFixtureSummary[]);
      })
      .catch((caught: Error) => setError(caught.message));
  }, []);

  if (error) {
    return (
      <main className="attract-screen">
        <div className="broadcast-grid-bg" aria-hidden="true" />
        <section className="attract-content">
          <SpecLogo iconOnly size="hero" />
          <Eyebrow tag>SPEC Simulations</Eyebrow>
          <h1>Telemetry missing</h1>
          <p className="italic-line">{error}</p>
        </section>
      </main>
    );
  }

  if (!tracks) {
    return (
      <main className="attract-screen">
        <div className="broadcast-grid-bg" aria-hidden="true" />
        <section className="attract-content">
          <SpecLogo iconOnly size="hero" />
          <Eyebrow tag>SPEC Simulations</Eyebrow>
          <h1>Loading trace</h1>
          <p className="italic-line">Preparing the braking zone.</p>
        </section>
      </main>
    );
  }

  return <BrakeTraceApp tracks={tracks} />;
}

function BrakeTraceApp({ tracks }: { tracks: TrackFixtureSummary[] }) {
  const [screen, setScreen] = useState<Screen>("attract");
  const [selectedChallengeId, setSelectedChallengeId] = useState<DifficultyId>("beginner");
  const selectedChallenge = CHALLENGES.find((item) => item.id === selectedChallengeId) ?? CHALLENGES[0];
  const selectedFixtureId = selectedChallenge.fixtureId;
  const selectedTrack = tracks.find((item) => item.id === selectedFixtureId) ?? tracks[0]!;
  const [fixtureCache, setFixtureCache] = useState<Record<string, TrackFixture>>({});
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  const fixture = fixtureCache[selectedFixtureId];
  const [leaderboard, setLeaderboard] = useLocalStorageState<LeaderboardEntry[]>(LEADERBOARD_KEY, []);
  const [calibration, setCalibration] = useLocalStorageState<Calibration>(CALIBRATION_KEY, defaultCalibration);
  const [audioVolume, setAudioVolume] = useLocalStorageState<number>(AUDIO_VOLUME_KEY, 0.85);
  const [lastEntryId, setLastEntryId] = useState<string | null>(null);
  const [secretClicks, setSecretClicks] = useState(0);
  const unlockedAudioRef = useRef<Record<string, HTMLAudioElement>>({});
  const livePedals = useLivePedals(calibration);

  const resetToAttract = useCallback(() => {
    setScreen("attract");
    setLastEntryId(null);
  }, []);

  const unlockAudio = useCallback((audioPath?: string) => {
    if (!audioPath) return;
    const audio = unlockedAudioRef.current[audioPath] ?? new Audio(audioPath);
    unlockedAudioRef.current[audioPath] = audio;
    audio.preload = "auto";
    audio.muted = true;
    audio.volume = 0;
    audio.play()
      .catch(() => {
        // Some browsers still reject the warm-up; the run timer must continue either way.
      });
  }, [audioVolume]);

  useEffect(() => {
    let timeout = window.setTimeout(resetToAttract, IDLE_MS);
    const reset = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(resetToAttract, IDLE_MS);
    };
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [resetToAttract]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "KeyC") setScreen("calibration");
      if (event.code === "Escape") resetToAttract();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetToAttract]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (import.meta.env.PROD) {
      navigator.serviceWorker.register(assetPath("sw.js"), { scope: import.meta.env.BASE_URL });
      return;
    }

    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => ("caches" in window ? caches.keys() : Promise.resolve([])))
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("braketrace-")).map((key) => caches.delete(key))))
      .catch(() => {
        // Dev cleanup is best-effort; the app should still boot if browser storage APIs are blocked.
      });
  }, []);

  useEffect(() => {
    setLastEntryId(null);
    setFixtureError(null);
  }, [selectedTrack.id]);

  useEffect(() => {
    if (fixtureCache[selectedTrack.id]) return;
    let cancelled = false;
    fetch(assetPath(selectedTrack.dataPath))
      .then((response) => {
        if (!response.ok) throw new Error(`Telemetry failed: ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setFixtureCache((cache) => ({ ...cache, [selectedTrack.id]: data as TrackFixture }));
      })
      .catch((caught: Error) => {
        if (!cancelled) setFixtureError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, [fixtureCache, selectedTrack.dataPath, selectedTrack.id]);

  const driver = fixture ? fastestDriver(fixture.drivers) : null;
  const segment = fixture ? segmentForChallenge(fixture, selectedChallenge) : null;
  const reference = useMemo(() => (driver && segment ? segmentSamples(driver, segment) : []), [driver, segment]);
  const key = leaderboardKey(selectedChallenge);
  const currentBoard = key ? sortedLeaderboard(leaderboard, key) : [];
  const lastEntry = leaderboard.find((entry) => entry.id === lastEntryId);
  const challengeChoiceGroups = useMemo(
    () =>
      [{
        label: "Difficulty",
        items: CHALLENGES.map((challenge) => {
          const track = tracks.find((item) => item.id === challenge.fixtureId);
          return {
            id: challenge.id,
            eyebrow: challenge.trackName,
            title: challenge.level,
            flag: track ? flagForEvent(track.event) : undefined,
            accent: challenge.accent,
            meta: track ? `${challenge.segmentName} · ${track.driverCount} drivers` : "Telemetry loading",
            visual: track ? <TrackMap fixture={track} segment={segmentForChallenge(track, challenge)} label={`${challenge.trackName} map`} /> : undefined
          };
        })
      }],
    [tracks]
  );
  const openSecret = () => {
    setSecretClicks((clicks) => {
      const next = clicks + 1;
      if (next >= 5) {
        setScreen("calibration");
        return 0;
      }
      return next;
    });
  };

  if (screen === "calibration") {
    return (
      <CalibrationScreen
        calibration={calibration}
        setCalibration={setCalibration}
        audioVolume={audioVolume}
        setAudioVolume={setAudioVolume}
        pedals={livePedals}
        onDone={() => setScreen("attract")}
      />
    );
  }

  if (screen === "track") {
    return (
      <StepChrome
        eyebrow="01 · Difficulty"
        title="Choose Level."
        onBack={() => setScreen("attract")}
        onSecret={openSecret}
      >
        <GroupedChoiceGrid
          selected={selectedChallenge.id}
          onSelect={(id) => {
            const challenge = CHALLENGES.find((item) => item.id === id);
            unlockAudio(challenge?.audioPath);
            setSelectedChallengeId(id);
            setScreen("pedal-check");
          }}
          groups={challengeChoiceGroups}
        />
        {fixtureError ? <p className="small-copy">Telemetry load failed: {fixtureError}</p> : null}
      </StepChrome>
    );
  }

  if (!fixture) {
    return (
      <StepChrome
        eyebrow="Telemetry"
        title="Loading circuit trace."
        italic={`${selectedChallenge.level} · ${selectedChallenge.trackName}`}
        onBack={() => setScreen("track")}
        onSecret={openSecret}
      >
        <div className="ready-stage">
          <TrackMap fixture={selectedTrack} segment={segmentForChallenge(selectedTrack, selectedChallenge)} label={`${selectedChallenge.trackName} map`} />
        </div>
      </StepChrome>
    );
  }

  if (!driver || !segment || reference.length === 0) {
    return (
      <StepChrome
        eyebrow="Telemetry"
        title="Loading driver trace."
        italic={`${selectedChallenge.level} · ${selectedChallenge.trackName}`}
        onBack={() => setScreen("track")}
        onSecret={openSecret}
      >
        <div className="ready-stage">
          <TrackMap fixture={selectedTrack} segment={segmentForChallenge(selectedTrack, selectedChallenge)} label={`${selectedChallenge.trackName} map`} />
        </div>
      </StepChrome>
    );
  }

  const completeRun = (run: RunSample[], breakdown: ScoreBreakdown) => {
    const entry: LeaderboardEntry = {
      id: crypto.randomUUID(),
      key,
      initials: "",
      score: breakdown.score,
      difficulty: selectedChallenge.id,
      trackName: selectedChallenge.trackName,
      driver: "REF-01",
      driverName: "Pro Trace",
      segment: segment.id,
      segmentName: segment.name,
      createdAt: new Date().toISOString(),
      breakdown
    };
    setLeaderboard((current) => capLeaderboard([entry, ...current]));
    setLastEntryId(entry.id);
    setScreen("result");
  };

  const updateInitials = (initials: string) => {
    if (!lastEntryId) return;
    setLeaderboard(
      (current) => capLeaderboard(current.map((entry) => (entry.id === lastEntryId ? { ...entry, initials } : entry)))
    );
  };

  if (screen === "run") {
    return (
      <RunScreen
        segment={segment}
        reference={reference}
        calibration={calibration}
        audioVolume={audioVolume}
        audioPath={selectedChallenge.audioPath}
        audioElement={selectedChallenge.audioPath ? unlockedAudioRef.current[selectedChallenge.audioPath] : undefined}
        onComplete={completeRun}
        onQuit={resetToAttract}
      />
    );
  }

  if (screen === "result" && lastEntry) {
    const board = sortedLeaderboard(leaderboard, key);
    const ranking = Math.max(1, board.findIndex((entry) => entry.id === lastEntry.id) + 1);
    return (
      <ResultScreen
        entry={lastEntry}
        ranking={ranking}
        breakdown={lastEntry.breakdown}
        segment={segment}
        challenge={selectedChallenge}
        onInitials={updateInitials}
        onAgain={() => setScreen("pedal-check")}
        onLeaderboard={() => setScreen("leaderboard")}
        onNextPlayer={resetToAttract}
      />
    );
  }

  if (screen === "leaderboard") {
    return (
      <LeaderboardScreen
        entries={currentBoard}
        challenge={selectedChallenge}
        onBack={() => setScreen(lastEntry ? "result" : "pedal-check")}
        onNextPlayer={resetToAttract}
      />
    );
  }

  if (screen === "pedal-check") {
    return (
      <PedalCheckScreen
        calibration={calibration}
        onBack={() => setScreen("track")}
        onReady={() => setScreen("run")}
      />
    );
  }

  if (screen === "ready") {
    return (
      <StepChrome
        eyebrow="Ready"
        title="Your feet vs. theirs."
        italic={`${flagForEvent(fixture.event)} ${selectedChallenge.trackName}. Pro Trace. ${segment.name}. ${reference[reference.length - 1].t.toFixed(1)} seconds.`}
        onBack={() => setScreen("pedal-check")}
        onNext={() => setScreen("run")}
        nextLabel="Start run"
        nextProminent
      >
        <div className="ready-stage">
          <TelemetryGraph reference={reference} run={[]} progress={0} variant="preview" readout="Broadcast trace armed" />
          <PedalMeters brake={livePedals.brake} throttle={livePedals.throttle} />
        </div>
      </StepChrome>
    );
  }

  return (
    <main className="attract-screen">
      <div className="broadcast-grid-bg" aria-hidden="true" />
      <section className="attract-content">
        <SpecLogo onSecret={openSecret} iconOnly size="hero" />
        <h1>Footwork Challenge</h1>
        <p className="italic-line">Brake late. Release clean. Power out.</p>
        <Button onClick={() => setScreen("track")}>Start challenge</Button>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<AppRoot />);
