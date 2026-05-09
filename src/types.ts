export type Sample = {
  t: number;
  distance: number;
  throttle: number;
  brake: number;
  speed: number;
  rpm: number;
  gear: number;
};

export type DriverTrace = {
  code: string;
  name: string;
  team: string;
  number: string;
  color: string;
  lap: number;
  lapTime: number;
  samples: Sample[];
};

export type Segment = {
  id: string;
  name: string;
  type: "corner" | "segment" | "full";
  startDistance: number;
  endDistance: number;
};

export type TrackFixture = {
  id: string;
  name: string;
  event: string;
  session: string;
  year: number;
  source: string;
  segments: Segment[];
  drivers: DriverTrace[];
};

export type RunSample = {
  t: number;
  brake: number;
  throttle: number;
};

export type ScoreBreakdown = {
  score: number;
  brakeTimingMs: number;
  releaseShape: number;
  throttlePickup: number;
  smoothness: number;
};

export type LeaderboardEntry = {
  id: string;
  key: string;
  initials: string;
  score: number;
  driver: string;
  segment: string;
  createdAt: string;
  breakdown: ScoreBreakdown;
};
