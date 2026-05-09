import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_ARCHIVE = "/private/tmp/tracinginsights-2025";
const ARCHIVE = path.resolve(process.argv[2] ?? process.env.TRACING_INSIGHTS_2025 ?? DEFAULT_ARCHIVE);
const DATA_DIR = path.resolve("public/data/fixtures-2025");
const MANIFEST_OUT = path.resolve("public/data/fixtures-2025-manifest.json");
const YEAR = 2025;
const QUALIFYING = "Qualifying";
const CALENDAR_ORDER = [
  "Australian Grand Prix",
  "Chinese Grand Prix",
  "Japanese Grand Prix",
  "Bahrain Grand Prix",
  "Saudi Arabian Grand Prix",
  "Miami Grand Prix",
  "Emilia Romagna Grand Prix",
  "Monaco Grand Prix",
  "Spanish Grand Prix",
  "Canadian Grand Prix",
  "Austrian Grand Prix",
  "British Grand Prix",
  "Belgian Grand Prix",
  "Hungarian Grand Prix",
  "Dutch Grand Prix",
  "Italian Grand Prix",
  "Azerbaijan Grand Prix",
  "Singapore Grand Prix",
  "United States Grand Prix",
  "Mexico City Grand Prix",
  "São Paulo Grand Prix",
  "Las Vegas Grand Prix",
  "Qatar Grand Prix",
  "Abu Dhabi Grand Prix"
];

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function fastestValidLap(laptimes) {
  let best = null;
  for (let i = 0; i < laptimes.lap.length; i += 1) {
    const lapTime = asNumber(laptimes.time[i]);
    const lap = laptimes.lap[i];
    const deleted = laptimes.del?.[i] === true;
    const accurate = laptimes.iacc?.[i] !== false;
    const pitOut = laptimes.pout?.[i] != null && laptimes.pout?.[i] !== "None";
    const pitIn = laptimes.pin?.[i] != null && laptimes.pin?.[i] !== "None";
    if (!lapTime || deleted || !accurate || pitOut || pitIn) continue;
    if (!best || lapTime < best.lapTime) {
      best = { lap, lapTime };
    }
  }
  return best;
}

function downsample(samples, max = 1000) {
  if (samples.length <= max) return samples;
  const result = [];
  for (let i = 0; i < max; i += 1) {
    const index = Math.round((i / (max - 1)) * (samples.length - 1));
    result.push(samples[index]);
  }
  return result;
}

function normalizeLap(tel) {
  const distanceOffset = tel.distance[0] || 0;
  const samples = tel.time.map((t, index) => ({
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

function buildMapPoints(tel) {
  const raw = tel.time
    .map((_, index) => ({
      x: asNumber(tel.x[index]),
      y: asNumber(tel.y[index]),
      distance: asNumber(tel.distance[index])
    }))
    .filter((point) => point.x != null && point.y != null && point.distance != null);
  const sampled = downsample(raw, 220);
  if (sampled.length < 3) return [];

  const minX = Math.min(...sampled.map((point) => point.x));
  const maxX = Math.max(...sampled.map((point) => point.x));
  const minY = Math.min(...sampled.map((point) => point.y));
  const maxY = Math.max(...sampled.map((point) => point.y));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const boxW = 240;
  const boxH = 150;
  const pad = 14;
  const scale = Math.min((boxW - pad * 2) / width, (boxH - pad * 2) / height);
  const offsetX = (boxW - width * scale) / 2;
  const offsetY = (boxH - height * scale) / 2;
  const distanceOffset = sampled[0].distance ?? 0;

  return sampled.map((point) => ({
    x: Number((offsetX + (point.x - minX) * scale).toFixed(1)),
    y: Number((boxH - offsetY - (point.y - minY) * scale).toFixed(1)),
    distance: Number(((point.distance ?? 0) - distanceOffset).toFixed(2))
  }));
}

function formatTurnName(start, end) {
  return start === end ? `T${start}` : `T${start}-T${end}`;
}

function buildSegments(corners, maxDistance) {
  const cornerPoints = corners.CornerNumber.map((corner, index) => ({
    corner,
    distance: corners.Distance[index]
  }))
    .filter((point) => Number.isFinite(point.corner) && Number.isFinite(point.distance))
    .sort((a, b) => a.distance - b.distance);

  const segments = [];
  let index = 0;
  while (index < cornerPoints.length) {
    const start = cornerPoints[index];
    let endIndex = Math.min(index + 1, cornerPoints.length - 1);
    while (
      endIndex < cornerPoints.length - 1 &&
      (cornerPoints[endIndex].distance - start.distance < 650 || endIndex - index < 2)
    ) {
      endIndex += 1;
    }
    const end = cornerPoints[endIndex];
    const startDistance = Math.max(0, start.distance - 180);
    const endDistance = Math.min(maxDistance, end.distance + 240);
    if (endDistance - startDistance >= 420) {
      const turnName = formatTurnName(start.corner, end.corner);
      segments.push({
        id: slugify(turnName),
        name: turnName,
        type: "segment",
        startDistance: Number(startDistance.toFixed(2)),
        endDistance: Number(endDistance.toFixed(2))
      });
    }
    index = endIndex + 1;
  }

  segments.push({
    id: "full",
    name: "Full Track",
    type: "full",
    startDistance: 0,
    endDistance: Number(maxDistance.toFixed(2))
  });
  return segments;
}

async function importFixture(eventName) {
  const sessionDir = path.join(ARCHIVE, eventName, QUALIFYING);
  const [driversJson, cornersJson] = await Promise.all([
    readJson(path.join(sessionDir, "drivers.json")),
    readJson(path.join(sessionDir, "corners.json"))
  ]);

  const drivers = [];
  let trackMap = [];
  for (const driver of driversJson.drivers) {
    try {
      const laptimes = await readJson(path.join(sessionDir, driver.driver, "laptimes.json"));
      const best = fastestValidLap(laptimes);
      if (!best) continue;
      const telemetry = await readJson(path.join(sessionDir, driver.driver, `${best.lap}_tel.json`));
      const samples = normalizeLap(telemetry.tel);
      if (samples.length < 20) continue;
      if (trackMap.length === 0) {
        trackMap = buildMapPoints(telemetry.tel);
      }
      drivers.push({
        code: driver.driver,
        name: `${driver.fn} ${driver.ln}`,
        team: driver.team,
        number: String(driver.dn),
        color: `#${driver.tc}`,
        lap: best.lap,
        lapTime: Number(best.lapTime.toFixed(3)),
        samples
      });
    } catch (error) {
      console.warn(`Skipped ${eventName} ${driver.driver}: ${error.message}`);
    }
  }

  drivers.sort((a, b) => a.lapTime - b.lapTime);
  const maxDistance = Math.max(...drivers.flatMap((driver) => driver.samples.map((sample) => sample.distance)));
  if (!Number.isFinite(maxDistance) || drivers.length === 0) {
    throw new Error(`No usable drivers for ${eventName}`);
  }

  return {
    id: `${YEAR}-${slugify(eventName)}-qualifying`,
    name: eventName.replace(" Grand Prix", ""),
    event: eventName,
    session: QUALIFYING,
    year: YEAR,
    source: "TracingInsights-Archive/2025",
    map: { points: trackMap },
    segments: buildSegments(cornersJson, maxDistance),
    drivers
  };
}

async function main() {
  const available = new Set(
    (await fs.readdir(ARCHIVE, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );
  const events = CALENDAR_ORDER.filter((event) => available.has(event));
  const fixtures = [];

  for (const eventName of events) {
    const fixture = await importFixture(eventName);
    fixtures.push(fixture);
    console.log(`Imported ${eventName}: ${fixture.drivers.length} drivers, ${fixture.segments.length} segments`);
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  const manifest = [];
  for (const fixture of fixtures) {
    const dataPath = `/data/fixtures-2025/${fixture.id}.json`;
    await fs.writeFile(path.join(DATA_DIR, `${fixture.id}.json`), `${JSON.stringify(fixture)}\n`);
    manifest.push({
      id: fixture.id,
      name: fixture.name,
      event: fixture.event,
      session: fixture.session,
      year: fixture.year,
      source: fixture.source,
      dataPath,
      driverCount: fixture.drivers.length,
      driverCodes: fixture.drivers.map((driver) => driver.code),
      map: fixture.map,
      segments: fixture.segments
    });
  }

  await fs.writeFile(MANIFEST_OUT, `${JSON.stringify(manifest)}\n`);
  console.log(`Wrote ${MANIFEST_OUT} (${fixtures.length} qualifying fixtures)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
