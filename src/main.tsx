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
const ENGINE_AUDIO_PATH = assetPath("assets/audio/engine-loop.m4a");
const SPEC_SECONDARY_LOGO_PATH = assetPath("assets/spec-secondary.svg");
const STANDARD_CHARTERED_HOME_LOGO_PATH = assetPath("assets/standard-chartered-home.png");
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
    accent: "#35d000"
  },
  {
    id: "intermediate",
    level: "Intermediate",
    trackName: "Singapore",
    fixtureId: "2025-singapore-grand-prix-qualifying",
    segmentName: "T7-T10",
    sourceSegments: ["T7-T10"],
    accent: "#0875e1"
  },
  {
    id: "advance",
    level: "Advance",
    trackName: "UK",
    fixtureId: "2025-british-grand-prix-qualifying",
    segmentName: "T1-T9",
    sourceSegments: ["T1-T5", "T6-T9"],
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

let sharedAudioContext: AudioContext | null = null;
const engineBufferCache = new WeakMap<AudioContext, Promise<AudioBuffer>>();
const processedEngineCache = new WeakMap<AudioContext, Promise<ProcessedEngineLoop>>();

type DifficultyId = (typeof CHALLENGES)[number]["id"];
type Challenge = (typeof CHALLENGES)[number];
type Screen = "attract" | "track" | "driver" | "pedal-check" | "ready" | "run" | "result" | "leaderboard" | "calibration";
type EngineAudioState = "idle" | "loading" | "ready" | "running" | "blocked" | "unavailable";
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

type ProcessedEngineLoop = {
  buffer: AudioBuffer;
  duration: number;
  sourceDuration: number;
  startTime: number;
  endTime: number;
  peak: number;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function audioContextConstructor() {
  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function getSharedAudioContext() {
  const AudioCtx = audioContextConstructor();
  if (!AudioCtx) return null;
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioCtx();
  }
  return sharedAudioContext;
}

function loadEngineBuffer(ctx: AudioContext) {
  const cached = engineBufferCache.get(ctx);
  if (cached) return cached;
  const pending = fetch(ENGINE_AUDIO_PATH)
    .then((response) => {
      if (!response.ok) throw new Error(`Engine audio failed: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((data) => ctx.decodeAudioData(data));
  engineBufferCache.set(ctx, pending);
  return pending;
}

function displayAudioState(ctx: AudioContext): EngineAudioState {
  return ctx.state === "running" ? "running" : "blocked";
}

function buildProcessedEngineLoop(ctx: AudioContext, source: AudioBuffer): ProcessedEngineLoop {
  const sampleRate = source.sampleRate;
  const channels = source.numberOfChannels;
  const totalFrames = source.length;
  const windowSize = Math.min(Math.max(1024, Math.round(sampleRate * 0.045)), 4096);
  const hop = Math.max(256, Math.round(windowSize / 4));
  const analysisStart = Math.min(Math.round(sampleRate * 0.35), Math.max(0, totalFrames - windowSize));
  const analysisEnd = Math.max(analysisStart + windowSize, totalFrames - Math.round(sampleRate * 0.35));
  const mono = source.getChannelData(0);
  const levels: { start: number; rms: number }[] = [];

  for (let start = analysisStart; start + windowSize < analysisEnd; start += hop) {
    let sum = 0;
    for (let index = 0; index < windowSize; index += 1) {
      const sample = mono[start + index] ?? 0;
      sum += sample * sample;
    }
    levels.push({ start, rms: Math.sqrt(sum / windowSize) });
  }

  const targetFrames = Math.min(
    Math.max(Math.round(sampleRate * 1.8), Math.round(totalFrames * 0.18)),
    Math.round(sampleRate * 3.2),
    Math.max(windowSize * 2, totalFrames - analysisStart)
  );
  const spanWindows = Math.max(3, Math.round(targetFrames / hop));
  let bestStart = analysisStart;
  let bestScore = -Infinity;

  for (let index = 0; index + spanWindows < levels.length; index += 1) {
    const slice = levels.slice(index, index + spanWindows);
    const avg = slice.reduce((sum, item) => sum + item.rms, 0) / slice.length;
    const variance = slice.reduce((sum, item) => sum + (item.rms - avg) ** 2, 0) / slice.length;
    const stabilityPenalty = Math.sqrt(variance) * 0.85;
    const edgePenalty = index < 4 || index + spanWindows > levels.length - 4 ? avg * 0.12 : 0;
    const score = avg - stabilityPenalty - edgePenalty;
    if (score > bestScore) {
      bestScore = score;
      bestStart = levels[index].start;
    }
  }

  const loopFrames = Math.min(targetFrames, totalFrames - bestStart);
  const fadeFrames = Math.min(Math.round(sampleRate * 0.09), Math.round(loopFrames * 0.18));
  const outputFrames = Math.max(windowSize, loopFrames - fadeFrames);
  const output = ctx.createBuffer(channels, outputFrames, sampleRate);
  let peak = 0.001;

  for (let channel = 0; channel < channels; channel += 1) {
    const input = source.getChannelData(channel);
    const outputData = output.getChannelData(channel);
    for (let index = 0; index < outputFrames; index += 1) {
      let sample = input[bestStart + index] ?? 0;
      const fadeIndex = index - (outputFrames - fadeFrames);
      if (fadeIndex >= 0) {
        const ratio = fadeIndex / Math.max(1, fadeFrames - 1);
        const endGain = Math.cos(ratio * Math.PI * 0.5);
        const startGain = Math.sin(ratio * Math.PI * 0.5);
        const startSample = input[bestStart + fadeIndex] ?? 0;
        sample = sample * endGain + startSample * startGain;
      }
      outputData[index] = sample;
      peak = Math.max(peak, Math.abs(sample));
    }
  }

  const normalizeGain = Math.min(2.8, 0.72 / peak);
  for (let channel = 0; channel < channels; channel += 1) {
    const outputData = output.getChannelData(channel);
    for (let index = 0; index < outputData.length; index += 1) {
      outputData[index] *= normalizeGain;
    }
  }

  return {
    buffer: output,
    duration: output.duration,
    sourceDuration: source.duration,
    startTime: bestStart / sampleRate,
    endTime: (bestStart + loopFrames) / sampleRate,
    peak: peak * normalizeGain
  };
}

function loadProcessedEngineLoop(ctx: AudioContext) {
  const cached = processedEngineCache.get(ctx);
  if (cached) return cached;
  const pending = loadEngineBuffer(ctx).then((buffer) => buildProcessedEngineLoop(ctx, buffer));
  processedEngineCache.set(ctx, pending);
  return pending;
}

class EngineAudioController {
  readonly ctx: AudioContext;
  state: EngineAudioState = "idle";
  loop: ProcessedEngineLoop | null = null;
  private source: AudioBufferSourceNode | null = null;
  private accent: AudioBufferSourceNode | null = null;
  private inputGain: GainNode;
  private accentGain: GainNode;
  private filter: BiquadFilterNode;
  private masterGain: GainNode;
  private lastGear: number | null = null;
  private volume = 0.85;

  constructor(ctx: AudioContext, volume: number) {
    this.ctx = ctx;
    this.volume = volume;
    this.inputGain = ctx.createGain();
    this.accentGain = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.masterGain = ctx.createGain();
    this.inputGain.gain.value = 0.0001;
    this.accentGain.gain.value = 0.0001;
    this.filter.type = "lowpass";
    this.filter.frequency.value = 2600;
    this.filter.Q.value = 0.55;
    this.masterGain.gain.value = volume;
    this.inputGain.connect(this.filter);
    this.accentGain.connect(this.filter);
    this.filter.connect(this.masterGain).connect(ctx.destination);
  }

  async load() {
    this.state = "loading";
    this.loop = await loadProcessedEngineLoop(this.ctx);
    this.state = this.ctx.state === "running" ? "ready" : "blocked";
  }

  async start() {
    if (!this.loop) await this.load();
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (this.ctx.state !== "running") {
      this.state = "blocked";
      return;
    }
    if (!this.source && this.loop) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.loop.buffer;
      source.loop = true;
      source.playbackRate.value = 1;
      source.connect(this.inputGain);
      source.start();
      this.source = source;
    }
    this.state = "running";
  }

  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (!this.source) await this.start();
    this.state = this.ctx.state === "running" ? "running" : "blocked";
  }

  setVolume(volume: number) {
    this.volume = clamp(volume, 0, 1);
    this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  update(sample: Sample, pedals: { brake: number; throttle: number }, paused: boolean) {
    if (!this.source || this.state !== "running") return;
    const now = this.ctx.currentTime;
    const referenceThrottle = sample.throttle / 100;
    const userThrottleInfluence = (pedals.throttle - referenceThrottle) * 0.14;
    const throttle = clamp(referenceThrottle + userThrottleInfluence);
    const brake = clamp(Math.max(pedals.brake * 0.55, sample.brake * 0.4));
    const rpmLoad = clamp((sample.rpm - 4500) / 7600, 0, 1);
    const rate = paused ? 0.92 : clamp(0.85 + rpmLoad * 0.34 + throttle * 0.03 - brake * 0.04, 0.84, 1.22);
    const level = paused ? 0.0001 : clamp(0.18 + throttle * 0.48 + rpmLoad * 0.18 - brake * 0.14, 0.07, 0.76);
    const cutoff = paused ? 900 : clamp(1050 + rpmLoad * 3400 + throttle * 2200 - brake * 950, 850, 6800);

    this.source.playbackRate.setTargetAtTime(rate, now, 0.09);
    this.inputGain.gain.setTargetAtTime(level, now, 0.08);
    this.filter.frequency.setTargetAtTime(cutoff, now, 0.1);

    if (!paused && this.loop && this.lastGear !== null && sample.gear < this.lastGear) {
      this.playDownshift(sample, rate);
    }
    this.lastGear = sample.gear;
  }

  stop() {
    const now = this.ctx.currentTime;
    const source = this.source;
    const accent = this.accent;
    const inputGain = this.inputGain;
    const accentGain = this.accentGain;
    const filter = this.filter;
    const masterGain = this.masterGain;
    try {
      inputGain.gain.setTargetAtTime(0.0001, now, 0.025);
      accentGain.gain.setTargetAtTime(0.0001, now, 0.025);
      source?.stop(now + 0.1);
      accent?.stop(now + 0.1);
      window.setTimeout(() => {
        try {
          source?.disconnect();
          accent?.disconnect();
          inputGain.disconnect();
          accentGain.disconnect();
          filter.disconnect();
          masterGain.disconnect();
        } catch {
          // The graph may already be disconnected by the browser.
        }
      }, 130);
    } catch {
      // Browsers may already stop audio nodes during teardown.
    }
    this.source = null;
    this.accent = null;
    this.state = "idle";
  }

  private playDownshift(sample: Sample, baseRate: number) {
    if (!this.loop) return;
    const now = this.ctx.currentTime;
    try {
      this.accent?.stop(now);
    } catch {
      // Ignore stale accent nodes.
    }
    const accent = this.ctx.createBufferSource();
    accent.buffer = this.loop.buffer;
    accent.loop = false;
    accent.playbackRate.value = clamp(baseRate + 0.12 + sample.gear * 0.01, 0.9, 1.28);
    accent.connect(this.accentGain);
    this.accentGain.gain.cancelScheduledValues(now);
    this.accentGain.gain.setValueAtTime(0.0001, now);
    this.accentGain.gain.linearRampToValueAtTime(0.18, now + 0.035);
    this.accentGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    accent.start(now, 0, Math.min(0.32, this.loop.duration));
    this.accent = accent;
  }
}

function primeAudio() {
  const ctx = getSharedAudioContext();
  if (!ctx) return Promise.resolve(false);

  return ctx.resume()
    .then(() => loadProcessedEngineLoop(ctx))
    .then(() => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 96;
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.03);
      return true;
    })
    .catch(() => false);
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

function StandardCharteredLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`sc-lockup ${compact ? "sc-lockup-compact" : ""}`} aria-label="Standard Chartered">
      <svg className="sc-symbol" viewBox="0 0 96 96" aria-hidden="true">
        <path className="sc-blue" d="M44 5c9-6 21 5 15 15L39 51l37 22c10 6 5 21-7 21H17c-12 0-18-15-8-22l21-14L9 44C-1 37 4 22 16 22h21L44 5Z" />
        <path className="sc-green" d="M53 37l21-13c10-6 22 5 16 16l-7 12c-4 8-14 10-22 5l-16-10 8-10ZM43 59 22 72c-10 6-22-5-16-16l7-12c4-8 14-10 22-5l16 10-8 10Z" />
        <path className="sc-cut" d="M24 29h29L40 49l25 15H36L9 47l15-18Z" />
      </svg>
      <span>
        <strong>standard<br />chartered</strong>
        <b>渣打银行</b>
      </span>
    </div>
  );
}

function StandardCharteredHomeLogo({ compact = false }: { compact?: boolean }) {
  return (
    <img
      className={`sc-home-logo ${compact ? "sc-home-logo-compact" : ""}`}
      src={STANDARD_CHARTERED_HOME_LOGO_PATH}
      alt="Standard Chartered 渣打银行"
    />
  );
}

function SpecLogo({ onSecret, iconOnly = false }: { onSecret?: () => void; iconOnly?: boolean }) {
  return (
    <button className={`spec-mark ${iconOnly ? "spec-mark-icon-only" : ""}`} onClick={onSecret} aria-label="SPEC Simulations">
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
        <StandardCharteredHomeLogo compact />
        <div className="topbar-side">
          <SpecLogo onSecret={onSecret} iconOnly />
        </div>
      </header>

      <section className="step-content">
        <div className="step-title-block">
          <span className="step-caption">Standard Chartered challenge</span>
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
        <StandardCharteredLogo compact />
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
  const controllerRef = useRef<EngineAudioController | null>(null);
  const intervalRef = useRef<number | null>(null);
  const [state, setState] = useState<EngineAudioState>(() => {
    const ctx = getSharedAudioContext();
    return ctx ? (ctx.state === "running" ? "idle" : "blocked") : "unavailable";
  });
  const [loop, setLoop] = useState<ProcessedEngineLoop | null>(null);
  const [message, setMessage] = useState("Ready to test.");

  const stopTest = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    controllerRef.current?.stop();
    controllerRef.current = null;
    setState("idle");
    setMessage("Audio test stopped.");
  }, []);

  useEffect(() => () => stopTest(), [stopTest]);

  const startTest = async () => {
    if (controllerRef.current) {
      stopTest();
      return;
    }

    const ctx = getSharedAudioContext();
    if (!ctx) {
      setState("unavailable");
      setMessage("WebAudio is not available in this browser.");
      return;
    }

    const controller = new EngineAudioController(ctx, volume);
    controllerRef.current = controller;
    setState("loading");
    setMessage("Loading bundled engine clip.");

    try {
      await controller.load();
      setLoop(controller.loop);
      await controller.start();
      setState(controller.state);
      setMessage(controller.state === "running" ? "Engine test running." : "Tap test again if the browser blocked audio.");
      const startedAt = performance.now();
      intervalRef.current = window.setInterval(() => {
        const t = (performance.now() - startedAt) / 1000;
        const throttle = 0.45 + Math.sin(t * 1.6) * 0.32;
        controller.update(
          {
            t,
            distance: 0,
            throttle: clamp(throttle) * 100,
            brake: Math.sin(t * 0.75) > 0.68 ? 1 : 0,
            speed: 160 + throttle * 100,
            rpm: 6500 + clamp(throttle) * 4200,
            gear: 4 + Math.round(clamp(throttle) * 3)
          },
          { brake: Math.sin(t * 0.75) > 0.68 ? 1 : 0, throttle: clamp(throttle) },
          false
        );
      }, 80);
    } catch (error) {
      controller.stop();
      controllerRef.current = null;
      setState("unavailable");
      setMessage(error instanceof Error ? error.message : "Engine audio failed to load.");
    }
  };

  useEffect(() => {
    controllerRef.current?.setVolume(volume);
  }, [volume]);

  return (
    <div className="audio-diagnostics">
      <div>
        <h2>Audio</h2>
        <div className="mapping-summary">
          <span>Context</span>
          <strong>{getSharedAudioContext()?.state ?? "none"}</strong>
          <span>Engine</span>
          <strong>{state}</strong>
          <span>Loop</span>
          <strong>{loop ? `${loop.duration.toFixed(2)}s from ${loop.sourceDuration.toFixed(2)}s clip` : "Not loaded"}</strong>
          <span>Region</span>
          <strong>{loop ? `${loop.startTime.toFixed(2)}-${loop.endTime.toFixed(2)}s` : "Pending"}</strong>
        </div>
        <p className="small-copy">{message}</p>
      </div>
      <div>
        <div className="operator-actions">
          <Button onClick={startTest}>{controllerRef.current ? "Stop engine" : "Test engine"}</Button>
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
  onComplete,
  onQuit
}: {
  segment: Segment;
  reference: Sample[];
  calibration: Calibration;
  audioVolume: number;
  onComplete: (run: RunSample[], breakdown: ScoreBreakdown) => void;
  onQuit: () => void;
}) {
  const pedals = useLivePedals(calibration);
  const pedalsRef = useRef(pedals);
  const [run, setRun] = useState<RunSample[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(3);
  const [audioState, setAudioState] = useState<EngineAudioState>("idle");
  const pausedRef = useRef(false);
  const audioReadyRef = useRef(false);
  const countdownDoneRef = useRef(false);
  const elapsedRef = useRef(0);
  const lastPaintAt = useRef(0);
  const lastSampleAt = useRef(0);
  const runStartedAt = useRef<number | null>(null);
  const pauseStartedAt = useRef<number | null>(null);
  const totalPausedMs = useRef(0);
  const runRef = useRef<RunSample[]>([]);
  const completedRef = useRef(false);
  const audioRef = useRef<EngineAudioController | null>(null);
  const duration = reference[reference.length - 1].t;

  useEffect(() => {
    pedalsRef.current = pedals;
  }, [pedals]);

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
          setCountdown(3 - second);
          return;
        }
        countdownDoneRef.current = true;
        setCountdown(null);
      }, second * 1000)
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const armAudio = useCallback(() => {
    const controller = audioRef.current;
    if (!controller) {
      setAudioState("unavailable");
      return;
    }
    controller.resume().then(() => {
      audioReadyRef.current = true;
      setAudioState(controller.state);
    }).catch(() => {
      audioReadyRef.current = true;
      setAudioState("blocked");
    });
  }, []);

  useEffect(() => {
    const ctx = getSharedAudioContext();
    let audioCancelled = false;
    audioReadyRef.current = true;
    if (ctx) {
      const controller = new EngineAudioController(ctx, audioVolume);
      audioRef.current = controller;
      setAudioState("loading");
      controller.load()
        .then(() => controller.start())
        .then(() => {
          if (audioCancelled) return;
          audioReadyRef.current = true;
          setAudioState(controller.state);
        })
        .catch(() => {
          if (audioCancelled) return;
          audioRef.current?.stop();
          audioRef.current = null;
          audioReadyRef.current = true;
          setAudioState("unavailable");
        });
    } else {
      audioReadyRef.current = true;
      setAudioState("unavailable");
    }

    let frame = 0;
    const tick = (now: number) => {
      const runActive = countdownDoneRef.current && audioReadyRef.current;

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

      audioRef.current?.update(ref, currentPedals, pausedRef.current || !countdownDoneRef.current);

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
      audioCancelled = true;
      cancelAnimationFrame(frame);
      audioRef.current?.stop();
      audioRef.current = null;
    };
  }, [audioVolume, duration, onComplete, reference]);

  useEffect(() => {
    audioRef.current?.setVolume(audioVolume);
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
    : audioState === "loading"
      ? "Engine loading"
      : audioState === "blocked"
        ? "Trace live · audio blocked"
        : paused
          ? "Paused"
          : prompt;

  return (
    <main className="run-screen">
      <div className="broadcast-grid-bg" aria-hidden="true" />
      <header className="run-header">
        <div className="run-brand-stack">
          <StandardCharteredHomeLogo compact />
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
        {countdown === null && audioState === "blocked" ? (
          <button className="audio-unlock" onClick={armAudio}>
            Tap to enable engine
          </button>
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
          <Button variant="ghost" onClick={armAudio}>
            Engine {audioState}
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
        <StandardCharteredHomeLogo compact />
        <Eyebrow>Result</Eyebrow>
      </header>
      <section className="result-content">
        <div className="result-title-block">
          <span className="step-caption">Standard Charter Challenge</span>
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
        <StandardCharteredHomeLogo compact />
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
              <strong>{entry.initials || "YOU"}</strong>
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
          <StandardCharteredHomeLogo />
          <SpecLogo />
          <Eyebrow tag>Standard Chartered</Eyebrow>
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
          <StandardCharteredHomeLogo />
          <SpecLogo />
          <Eyebrow tag>Standard Chartered</Eyebrow>
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
  const livePedals = useLivePedals(calibration);

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
      initials: "YOU",
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
      (current) => capLeaderboard(current.map((entry) => (entry.id === lastEntryId ? { ...entry, initials: initials || "YOU" } : entry)))
    );
  };

  if (screen === "run") {
    return (
      <RunScreen
        segment={segment}
        reference={reference}
        calibration={calibration}
        audioVolume={audioVolume}
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
        onReady={() => {
          void primeAudio().finally(() => setScreen("run"));
        }}
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
        onNext={() => {
          void primeAudio().finally(() => setScreen("run"));
        }}
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
        <StandardCharteredHomeLogo />
        <h1>Footwork Challenge</h1>
        <p className="italic-line">Brake late. Release clean. Power out.</p>
        <SpecLogo onSecret={openSecret} iconOnly />
        <Button onClick={() => setScreen("track")}>Start challenge</Button>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<AppRoot />);
