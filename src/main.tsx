import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DriverTrace, LeaderboardEntry, RunSample, Sample, ScoreBreakdown, Segment, TrackFixture } from "./types";
import "./styles.css";

const LEADERBOARD_KEY = "braketrace.leaderboard.v1";
const CALIBRATION_KEY = "braketrace.calibration.v1";
const IDLE_MS = 90_000;

type Screen = "attract" | "track" | "driver" | "corner" | "ready" | "run" | "result" | "leaderboard" | "calibration";
type Calibration = {
  brakeAxis: number | null;
  throttleAxis: number | null;
  brakeButton: number | null;
  throttleButton: number | null;
  brakeInvert: boolean;
  throttleInvert: boolean;
  deadZone: number;
};

const defaultCalibration: Calibration = {
  brakeAxis: null,
  throttleAxis: null,
  brakeButton: null,
  throttleButton: null,
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
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
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
  const pad = Array.from(pads).find(Boolean);
  let brake = keyboard.brake ? 1 : 0;
  let throttle = keyboard.throttle ? 1 : 0;

  if (pad) {
    if (calibration.brakeAxis !== null) {
      brake = normalizeAxis(pad.axes[calibration.brakeAxis] ?? -1, calibration.brakeInvert, calibration.deadZone);
    } else if (calibration.brakeButton !== null) {
      brake = pad.buttons[calibration.brakeButton]?.value ?? 0;
    }

    if (calibration.throttleAxis !== null) {
      throttle = normalizeAxis(pad.axes[calibration.throttleAxis] ?? -1, calibration.throttleInvert, calibration.deadZone);
    } else if (calibration.throttleButton !== null) {
      throttle = pad.buttons[calibration.throttleButton]?.value ?? 0;
    }
  }

  return { brake: clamp(brake), throttle: clamp(throttle), connected: Boolean(pad), pad };
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

function leaderboardKey(track: TrackFixture, driver: DriverTrace, segment: Segment) {
  return `${track.id}:${driver.code}:${segment.id}`;
}

function sortedLeaderboard(entries: LeaderboardEntry[], key: string) {
  return entries
    .filter((entry) => entry.key === key)
    .sort((a, b) => b.score - a.score || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function SpecLogo({ onSecret }: { onSecret?: () => void }) {
  return (
    <button className="brand-mark" onClick={onSecret} aria-label="SPEC Simulations">
      <span />
      SPEC
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
  disabled = false
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className={`button button-${variant}`} onClick={onClick} disabled={disabled}>
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
  onSecret?: () => void;
}) {
  return (
    <main className="step-screen">
      <header className="topbar">
        <button className="back-button" onClick={onBack} disabled={!onBack}>
          {onBack ? "Back" : ""}
        </button>
        <SpecLogo onSecret={onSecret} />
        <Eyebrow>{eyebrow}</Eyebrow>
      </header>

      <section className="step-content">
        <Eyebrow tag>{eyebrow}</Eyebrow>
        <h1>{title}</h1>
        {italic ? <p className="italic-line">{italic}</p> : null}
        <div className="step-options">{children}</div>
      </section>

      {onNext ? (
        <footer className="step-footer">
          <Button onClick={onNext} disabled={nextDisabled}>
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
  items: { id: T; eyebrow?: string; title: string; meta?: string; accent?: string }[];
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
          {item.eyebrow ? <span className="eyebrow">{item.eyebrow}</span> : null}
          <strong>{item.title}</strong>
          {item.meta ? <small>{item.meta}</small> : null}
        </button>
      ))}
    </div>
  );
}

function PedalMeters({ brake, throttle }: { brake: number; throttle: number }) {
  return (
    <div className="pedal-meters">
      <div className="pedal-meter">
        <span>Brake</span>
        <div><i style={{ transform: `scaleY(${brake})` }} /></div>
      </div>
      <div className="pedal-meter">
        <span>Throttle</span>
        <div><i style={{ transform: `scaleY(${throttle})` }} /></div>
      </div>
    </div>
  );
}

function TelemetryGraph({
  reference,
  run,
  progress,
  prompt
}: {
  reference: Sample[];
  run: RunSample[];
  progress: number;
  prompt?: string;
}) {
  const width = 1000;
  const height = 440;
  const padding = 52;
  const duration = reference[reference.length - 1].t;

  const points = useCallback(
    (values: { t: number; brake?: number; throttle?: number }[], key: "brake" | "throttle", scale = 1) =>
      values
        .map((sample) => {
          const x = padding + clamp(sample.t / duration) * (width - padding * 2);
          const value = key === "brake" ? sample.brake ?? 0 : sample.throttle ?? 0;
          const y = height - padding - clamp(value / scale) * (height - padding * 2);
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" "),
    [duration]
  );

  const playhead = padding + progress * (width - padding * 2);

  return (
    <div className="graph-shell">
      <div className="graph-labels">
        <span>Reference</span>
        <span>You</span>
      </div>
      {prompt ? <div className="run-prompt">{prompt}</div> : null}
      <svg className="telemetry-graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Brake and throttle trace">
        <rect x="0" y="0" width={width} height={height} rx="8" />
        {[0, 0.25, 0.5, 0.75, 1].map((line) => (
          <React.Fragment key={line}>
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
        <text x={padding} y={height - 18}>BRAKE</text>
        <text x={width - padding - 90} y={height - 18}>THROTTLE</text>
      </svg>
    </div>
  );
}

function CalibrationScreen({
  calibration,
  setCalibration,
  pedals,
  onDone
}: {
  calibration: Calibration;
  setCalibration: (calibration: Calibration) => void;
  pedals: ReturnType<typeof useLivePedals>;
  onDone: () => void;
}) {
  const pad = pedals.pad;
  const axes = pad?.axes ?? [];
  const buttons = pad?.buttons ?? [];

  const setAxis = (key: "brakeAxis" | "throttleAxis", axis: number) => {
    setCalibration({ ...calibration, [key]: axis, [key.replace("Axis", "Button")]: null });
  };

  return (
    <main className="calibration-screen">
      <header className="topbar">
        <button className="back-button" onClick={onDone}>Close</button>
        <SpecLogo />
        <Eyebrow>Operator</Eyebrow>
      </header>
      <section className="calibration-panel">
        <Eyebrow tag>Rig setup</Eyebrow>
        <h1>Map the pedals.</h1>
        <p className="italic-line">Connect the rig, press each pedal, and assign the axis that moves.</p>
        <div className="operator-status">
          {pad ? `${pad.id} connected` : "No game controller detected. Keyboard fallback is active."}
        </div>
        <div className="calibration-grid">
          <div>
            <h2>Axes</h2>
            {axes.length ? axes.map((axis, index) => (
              <div className="axis-row" key={index}>
                <span>Axis {index}</span>
                <div><i style={{ transform: `scaleX(${clamp((axis + 1) / 2)})` }} /></div>
                <Button variant="secondary" onClick={() => setAxis("brakeAxis", index)}>Brake</Button>
                <Button variant="secondary" onClick={() => setAxis("throttleAxis", index)}>Throttle</Button>
              </div>
            )) : <p className="small-copy">Move a pedal or reconnect the wheelbase to expose axes.</p>}
          </div>
          <div>
            <h2>Live input</h2>
            <PedalMeters brake={pedals.brake} throttle={pedals.throttle} />
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
        {buttons.length ? <p className="small-copy">Buttons are visible to the browser, but this build prioritizes pedal axes for analog scoring.</p> : null}
      </section>
    </main>
  );
}

function RunScreen({
  driver,
  segment,
  reference,
  calibration,
  onComplete
}: {
  driver: DriverTrace;
  segment: Segment;
  reference: Sample[];
  calibration: Calibration;
  onComplete: (run: RunSample[], breakdown: ScoreBreakdown) => void;
}) {
  const pedals = useLivePedals(calibration);
  const pedalsRef = useRef(pedals);
  const [run, setRun] = useState<RunSample[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  const completedRef = useRef(false);
  const audioRef = useRef<{ ctx: AudioContext; osc: OscillatorNode; gain: GainNode } | null>(null);
  const duration = reference[reference.length - 1].t;

  useEffect(() => {
    pedalsRef.current = pedals;
  }, [pedals]);

  useEffect(() => {
    const AudioCtx = window.AudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      audioRef.current = { ctx, osc, gain };
    }

    let frame = 0;
    const tick = (now: number) => {
      if (startedAt.current === null) startedAt.current = now;
      const t = (now - startedAt.current) / 1000;
      const ref = sampleAt(reference, t);
      const currentPedals = pedalsRef.current;
      setElapsed(t);
      setRun((current) => {
        const next = [...current, { t, brake: currentPedals.brake, throttle: currentPedals.throttle }];
        return next.length > 900 ? next.slice(next.length - 900) : next;
      });

      if (audioRef.current) {
        const frequency = clamp(ref.rpm / 12000, 0.2, 1) * 420 + ref.gear * 32;
        audioRef.current.osc.frequency.setTargetAtTime(frequency, audioRef.current.ctx.currentTime, 0.03);
        audioRef.current.gain.gain.setTargetAtTime(0.02 + clamp(ref.speed / 320) * 0.06, audioRef.current.ctx.currentTime, 0.04);
      }

      if (t >= duration && !completedRef.current) {
        completedRef.current = true;
        setRun((current) => {
          const breakdown = scoreRun(reference, current);
          window.setTimeout(() => onComplete(current, breakdown), 0);
          return current;
        });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      if (audioRef.current) {
        audioRef.current.gain.gain.setTargetAtTime(0.0001, audioRef.current.ctx.currentTime, 0.02);
        audioRef.current.osc.stop(audioRef.current.ctx.currentTime + 0.05);
        audioRef.current.ctx.close();
      }
    };
  }, [duration, onComplete, reference]);

  const ref = sampleAt(reference, elapsed);
  const prompt = ref.brake > 0.5 ? "Brake" : ref.throttle > 50 ? "Throttle" : "Release";

  return (
    <main className="run-screen">
      <header className="run-header">
        <SpecLogo />
        <div>
          <Eyebrow>{driver.name}</Eyebrow>
          <strong>{segment.name}</strong>
        </div>
        <div className="run-clock">{Math.max(0, duration - elapsed).toFixed(1)}</div>
      </header>
      <section className="stage">
        <TelemetryGraph reference={reference} run={run} progress={clamp(elapsed / duration)} prompt={prompt} />
      </section>
      <footer className="run-footer">
        <PedalMeters brake={pedals.brake} throttle={pedals.throttle} />
        <div className="run-hint">Space brake · W throttle</div>
      </footer>
    </main>
  );
}

function ResultScreen({
  entry,
  ranking,
  breakdown,
  driver,
  segment,
  onInitials,
  onAgain,
  onLeaderboard,
  onNextPlayer
}: {
  entry: LeaderboardEntry;
  ranking: number;
  breakdown: ScoreBreakdown;
  driver: DriverTrace;
  segment: Segment;
  onInitials: (initials: string) => void;
  onAgain: () => void;
  onLeaderboard: () => void;
  onNextPlayer: () => void;
}) {
  return (
    <main className="result-screen">
      <header className="topbar">
        <span />
        <SpecLogo />
        <Eyebrow>Result</Eyebrow>
      </header>
      <section className="result-content">
        <Eyebrow tag>{driver.name} · {segment.name}</Eyebrow>
        <h1>{breakdown.score}% MATCH</h1>
        <p className="italic-line">P{ranking} on this corner.</p>
        <div className="result-stats">
          <Stat label="Brake timing" value={`${breakdown.brakeTimingMs > 0 ? "+" : ""}${breakdown.brakeTimingMs} ms`} />
          <Stat label="Release shape" value={`${breakdown.releaseShape}%`} />
          <Stat label="Throttle pickup" value={`${breakdown.throttlePickup}%`} />
        </div>
        <label className="initials-field">
          Initials
          <input
            value={entry.initials}
            maxLength={3}
            onChange={(event) => onInitials(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          />
        </label>
        <div className="result-actions">
          <Button onClick={onAgain}>Run again</Button>
          <Button variant="secondary" onClick={onLeaderboard}>Leaderboard</Button>
          <Button variant="ghost" onClick={onNextPlayer}>Next player</Button>
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
  driver,
  segment,
  onBack,
  onNextPlayer
}: {
  entries: LeaderboardEntry[];
  driver: DriverTrace;
  segment: Segment;
  onBack: () => void;
  onNextPlayer: () => void;
}) {
  return (
    <main className="leaderboard-screen">
      <header className="topbar">
        <button className="back-button" onClick={onBack}>Back</button>
        <SpecLogo />
        <Eyebrow>Leaderboard</Eyebrow>
      </header>
      <section className="leaderboard-content">
        <Eyebrow tag>{driver.name} · {segment.name}</Eyebrow>
        <h1>Local ranking.</h1>
        <div className="leaderboard-list">
          {entries.slice(0, 10).map((entry, index) => (
            <div className="leaderboard-row" key={entry.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{entry.initials || "YOU"}</strong>
              <b>{entry.score}%</b>
              <small>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
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
  const [fixture, setFixture] = useState<TrackFixture | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/chinese-gp-qualifying.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Telemetry failed: ${response.status}`);
        return response.json();
      })
      .then((data) => setFixture(data as TrackFixture))
      .catch((caught: Error) => setError(caught.message));
  }, []);

  if (error) {
    return (
      <main className="attract-screen">
        <section className="attract-content">
          <SpecLogo />
          <Eyebrow tag>SPEC Simulations</Eyebrow>
          <h1>Telemetry missing</h1>
          <p className="italic-line">{error}</p>
        </section>
      </main>
    );
  }

  if (!fixture) {
    return (
      <main className="attract-screen">
        <section className="attract-content">
          <SpecLogo />
          <Eyebrow tag>SPEC Simulations</Eyebrow>
          <h1>Loading trace</h1>
          <p className="italic-line">Preparing the braking zone.</p>
        </section>
      </main>
    );
  }

  return <BrakeTraceApp fixture={fixture} />;
}

function BrakeTraceApp({ fixture }: { fixture: TrackFixture }) {
  const [screen, setScreen] = useState<Screen>("attract");
  const [selectedDriverCode, setSelectedDriverCode] = useState(fixture.drivers[0]?.code ?? "");
  const [selectedSegmentId, setSelectedSegmentId] = useState("t14");
  const [leaderboard, setLeaderboard] = useLocalStorageState<LeaderboardEntry[]>(LEADERBOARD_KEY, []);
  const [calibration, setCalibration] = useLocalStorageState<Calibration>(CALIBRATION_KEY, defaultCalibration);
  const [lastEntryId, setLastEntryId] = useState<string | null>(null);
  const [secretClicks, setSecretClicks] = useState(0);
  const livePedals = useLivePedals(calibration);

  const driver = fixture.drivers.find((item) => item.code === selectedDriverCode) ?? fixture.drivers[0];
  const segment = fixture.segments.find((item) => item.id === selectedSegmentId) ?? fixture.segments[0];
  const reference = useMemo(() => segmentSamples(driver, segment), [driver, segment]);
  const key = leaderboardKey(fixture, driver, segment);
  const currentBoard = sortedLeaderboard(leaderboard, key);
  const lastEntry = leaderboard.find((entry) => entry.id === lastEntryId);

  const resetToAttract = useCallback(() => {
    setScreen("attract");
    setLastEntryId(null);
  }, []);

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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register("/sw.js");
    }
  }, []);

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

  const completeRun = (run: RunSample[], breakdown: ScoreBreakdown) => {
    const entry: LeaderboardEntry = {
      id: crypto.randomUUID(),
      key,
      initials: "YOU",
      score: breakdown.score,
      driver: driver.code,
      segment: segment.id,
      createdAt: new Date().toISOString(),
      breakdown
    };
    setLeaderboard([entry, ...leaderboard]);
    setLastEntryId(entry.id);
    setScreen("result");
  };

  const updateInitials = (initials: string) => {
    if (!lastEntryId) return;
    setLeaderboard(
      leaderboard.map((entry) => (entry.id === lastEntryId ? { ...entry, initials: initials || "YOU" } : entry))
    );
  };

  if (screen === "calibration") {
    return (
      <CalibrationScreen
        calibration={calibration}
        setCalibration={setCalibration}
        pedals={livePedals}
        onDone={() => setScreen("attract")}
      />
    );
  }

  if (screen === "run") {
    return (
      <RunScreen
        driver={driver}
        segment={segment}
        reference={reference}
        calibration={calibration}
        onComplete={completeRun}
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
        driver={driver}
        segment={segment}
        onInitials={updateInitials}
        onAgain={() => setScreen("ready")}
        onLeaderboard={() => setScreen("leaderboard")}
        onNextPlayer={resetToAttract}
      />
    );
  }

  if (screen === "leaderboard") {
    return (
      <LeaderboardScreen
        entries={currentBoard}
        driver={driver}
        segment={segment}
        onBack={() => setScreen(lastEntry ? "result" : "ready")}
        onNextPlayer={resetToAttract}
      />
    );
  }

  if (screen === "track") {
    return (
      <StepChrome
        eyebrow="01 · Track"
        title="Choose the circuit."
        onBack={() => setScreen("attract")}
        onNext={() => setScreen("driver")}
        onSecret={openSecret}
      >
        <ChoiceGrid
          selected={fixture.id}
          onSelect={() => undefined}
          items={[{ id: fixture.id, eyebrow: fixture.session, title: fixture.name, meta: fixture.event }]}
        />
      </StepChrome>
    );
  }

  if (screen === "driver") {
    return (
      <StepChrome
        eyebrow="02 · Driver"
        title="Pick your reference."
        italic="Follow their throttle. Chase their brake release."
        onBack={() => setScreen("track")}
        onNext={() => setScreen("corner")}
      >
        <ChoiceGrid
          selected={selectedDriverCode}
          onSelect={setSelectedDriverCode}
          items={fixture.drivers.slice(0, 12).map((item) => ({
            id: item.code,
            eyebrow: item.team,
            title: item.name,
            meta: `${item.code} · Lap ${item.lap} · ${formatLap(item.lapTime)}`,
            accent: item.color
          }))}
        />
      </StepChrome>
    );
  }

  if (screen === "corner") {
    return (
      <StepChrome
        eyebrow="03 · Corner"
        title="Select the braking zone."
        onBack={() => setScreen("driver")}
        onNext={() => setScreen("ready")}
      >
        <ChoiceGrid
          selected={selectedSegmentId}
          onSelect={setSelectedSegmentId}
          items={fixture.segments.map((item) => ({
            id: item.id,
            eyebrow: item.type,
            title: item.name,
            meta:
              item.type === "full"
                ? "Full lap trace"
                : `${Math.round(item.endDistance - item.startDistance)} m challenge`
          }))}
        />
      </StepChrome>
    );
  }

  if (screen === "ready") {
    return (
      <StepChrome
        eyebrow="04 · Ready"
        title="Your feet vs. theirs."
        italic={`${driver.name}. ${segment.name}. ${reference[reference.length - 1].t.toFixed(1)} seconds.`}
        onBack={() => setScreen("corner")}
        onNext={() => setScreen("run")}
        nextLabel="Start run"
      >
        <div className="ready-stage">
          <TelemetryGraph reference={reference} run={[]} progress={0} />
          <PedalMeters brake={livePedals.brake} throttle={livePedals.throttle} />
        </div>
      </StepChrome>
    );
  }

  return (
    <main className="attract-screen">
      <button className="offline-pill" onClick={openSecret}>{livePedals.connected ? "Pedals ready" : "Offline"}</button>
      <section className="attract-content">
        <SpecLogo onSecret={openSecret} />
        <Eyebrow tag>SPEC Simulations</Eyebrow>
        <h1>Match the feet</h1>
        <p className="italic-line">Step into a Formula 1 braking zone.</p>
        <Button onClick={() => setScreen("track")}>Start challenge</Button>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<AppRoot />);
