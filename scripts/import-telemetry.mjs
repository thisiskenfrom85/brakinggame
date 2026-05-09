import fs from "node:fs/promises";
import path from "node:path";

const BASE =
  "https://raw.githubusercontent.com/TracingInsights-Archive/2026/main/Chinese%20Grand%20Prix/Qualifying";
const OUT = path.resolve("public/data/chinese-gp-qualifying.json");
const CURATED_DRIVERS = ["PIA", "NOR", "VER", "LEC", "HAM", "RUS", "ALO", "SAI"];

async function fetchJson(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed ${response.status}: ${url}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const wait = 600 * attempt;
      console.warn(`Retry ${attempt}/4 for ${url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fastestValidLap(laptimes) {
  let best = null;
  for (let i = 0; i < laptimes.lap.length; i += 1) {
    const lapTime = asNumber(laptimes.time[i]);
    const lap = laptimes.lap[i];
    const deleted = laptimes.del?.[i] === true;
    const accurate = laptimes.iacc?.[i] !== false;
    if (!lapTime || deleted || !accurate) continue;
    if (!best || lapTime < best.lapTime) {
      best = { lap, lapTime };
    }
  }
  return best;
}

function downsample(samples, max = 420) {
  if (samples.length <= max) return samples;
  const result = [];
  for (let i = 0; i < max; i += 1) {
    const index = Math.round((i / (max - 1)) * (samples.length - 1));
    result.push(samples[index]);
  }
  return result;
}

function normalizeLap(tel) {
  const time = tel.time;
  const distanceOffset = tel.distance[0] || 0;
  const samples = time.map((t, index) => ({
    t: Number(t.toFixed(3)),
    distance: Number((tel.distance[index] - distanceOffset).toFixed(2)),
    throttle: Number(Math.max(0, Math.min(100, tel.throttle[index] ?? 0)).toFixed(1)),
    brake: Number(Math.max(0, Math.min(1, tel.brake[index] ?? 0)).toFixed(3)),
    speed: Number((tel.speed[index] ?? 0).toFixed(1)),
    rpm: Math.round(tel.rpm[index] ?? 0),
    gear: Math.round(tel.gear[index] ?? 0)
  }));
  return downsample(samples);
}

function buildSegments(corners, maxDistance) {
  const byNumber = new Map(corners.CornerNumber.map((corner, index) => [corner, corners.Distance[index]]));
  const around = (corner, before, after) => {
    const center = byNumber.get(corner);
    return {
      startDistance: Math.max(0, center - before),
      endDistance: Math.min(maxDistance, center + after)
    };
  };

  return [
    { id: "t1", name: "T1 Entry", type: "corner", ...around(1, 180, 190) },
    { id: "t1-t4", name: "T1-T4 Snail", type: "segment", startDistance: Math.max(0, byNumber.get(1) - 180), endDistance: byNumber.get(4) + 170 },
    { id: "t6", name: "T6 Hairpin", type: "corner", ...around(6, 220, 190) },
    { id: "t11-t13", name: "T11-T13 Launch", type: "segment", startDistance: byNumber.get(11) - 180, endDistance: byNumber.get(13) + 220 },
    { id: "t14", name: "T14 Hairpin", type: "corner", ...around(14, 340, 260) },
    { id: "full", name: "Full Track", type: "full", startDistance: 0, endDistance: maxDistance }
  ].map((segment) => ({
    ...segment,
    startDistance: Number(segment.startDistance.toFixed(2)),
    endDistance: Number(segment.endDistance.toFixed(2))
  }));
}

async function main() {
  const [driversJson, cornersJson] = await Promise.all([
    fetchJson(`${BASE}/drivers.json`),
    fetchJson(`${BASE}/corners.json`)
  ]);

  const drivers = [];
  const selectedDrivers = driversJson.drivers.filter((driver) => CURATED_DRIVERS.includes(driver.driver));
  for (const driver of selectedDrivers) {
    try {
      const laptimes = await fetchJson(`${BASE}/${driver.driver}/laptimes.json`);
      const best = fastestValidLap(laptimes);
      if (!best) continue;
      const telemetry = await fetchJson(`${BASE}/${driver.driver}/${best.lap}_tel.json`);
      drivers.push({
        code: driver.driver,
        name: `${driver.fn} ${driver.ln}`,
        team: driver.team,
        number: driver.dn,
        color: `#${driver.tc}`,
        lap: best.lap,
        lapTime: Number(best.lapTime.toFixed(3)),
        samples: normalizeLap(telemetry.tel)
      });
      console.log(`Imported ${driver.driver} lap ${best.lap}`);
    } catch (error) {
      console.warn(`Skipped ${driver.driver}: ${error.message}`);
    }
  }

  drivers.sort((a, b) => a.lapTime - b.lapTime);
  const maxDistance = Math.max(...drivers.flatMap((driver) => driver.samples.map((sample) => sample.distance)));

  const fixture = {
    id: "2026-chinese-gp-qualifying",
    name: "Shanghai International Circuit",
    event: "Chinese GP 2026",
    session: "Qualifying",
    year: 2026,
    source: "TracingInsights-Archive/2026",
    segments: buildSegments(cornersJson, maxDistance),
    drivers
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, `${JSON.stringify(fixture)}\n`);
  console.log(`Wrote ${OUT} (${drivers.length} drivers)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
