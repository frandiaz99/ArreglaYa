import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { TRADES, type Trade } from "./diagnose.js";
import type { Provider } from "./ranking.js";

mkdirSync("data", { recursive: true });
const db = new DatabaseSync("data/arreglaya.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    trade TEXT NOT NULL,
    phone TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    service_radius_km REAL NOT NULL,
    rating_sum REAL NOT NULL DEFAULT 0,
    rating_count INTEGER NOT NULL DEFAULT 0,
    avg_response_minutes REAL NOT NULL DEFAULT 60,
    jobs_accepted INTEGER NOT NULL DEFAULT 0,
    jobs_completed INTEGER NOT NULL DEFAULT 0,
    available_now INTEGER NOT NULL DEFAULT 0,
    emergency_service INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    licensed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_providers_trade ON providers(trade);

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL REFERENCES providers(id),
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

type Row = Record<string, string | number | null>;

function toProvider(r: Row): Provider {
  return {
    id: Number(r.id),
    name: String(r.name),
    trade: r.trade as Trade,
    phone: String(r.phone),
    lat: Number(r.lat),
    lng: Number(r.lng),
    serviceRadiusKm: Number(r.service_radius_km),
    ratingSum: Number(r.rating_sum),
    ratingCount: Number(r.rating_count),
    avgResponseMinutes: Number(r.avg_response_minutes),
    jobsAccepted: Number(r.jobs_accepted),
    jobsCompleted: Number(r.jobs_completed),
    availableNow: r.available_now === 1,
    emergencyService: r.emergency_service === 1,
    verified: r.verified === 1,
    licensed: r.licensed === 1,
  };
}

export function providersByTrade(trade: Trade): Provider[] {
  return (db.prepare("SELECT * FROM providers WHERE trade = ?").all(trade) as Row[]).map(toProvider);
}

/** Solo se aceptan reseñas de trabajos hechos por la plataforma (ver README → Confianza). */
export function addReview(providerId: number, stars: number, comment?: string): void {
  db.prepare("INSERT INTO reviews (provider_id, stars, comment) VALUES (?, ?, ?)").run(providerId, stars, comment ?? null);
  db.prepare("UPDATE providers SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id = ?").run(
    stars,
    providerId,
  );
}

// ---- Datos de demostración: profesionales FICTICIOS en CABA ----

const BARRIOS: [string, number, number][] = [
  ["Palermo", -34.5889, -58.4306],
  ["Belgrano", -34.5627, -58.4563],
  ["Caballito", -34.6186, -58.4415],
  ["Almagro", -34.6093, -58.4214],
  ["Recoleta", -34.5875, -58.3974],
  ["Villa Crespo", -34.5994, -58.4378],
  ["Flores", -34.6283, -58.4637],
  ["San Telmo", -34.6212, -58.3731],
  ["Núñez", -34.5446, -58.4635],
  ["Villa Urquiza", -34.5733, -58.4874],
];

/** PRNG determinista para que la demo sea reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedDemoProviders(): void {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM providers").get() as { n: number };
  if (n > 0) return;

  const rand = mulberry32(42);
  const insert = db.prepare(`INSERT INTO providers
    (name, trade, phone, lat, lng, service_radius_km, rating_sum, rating_count, avg_response_minutes,
     jobs_accepted, jobs_completed, available_now, emergency_service, verified, licensed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  let i = 0;
  for (const trade of TRADES.filter((t) => t !== "otro")) {
    for (const [barrio, lat, lng] of BARRIOS) {
      i++;
      const reviews = Math.floor(rand() * 120);
      const avg = 3.3 + rand() * 1.7;
      const accepted = reviews + Math.floor(rand() * 20);
      insert.run(
        `[DEMO] ${trade} ${barrio}`,
        trade,
        `+54 9 11 0000-${String(i).padStart(4, "0")}`,
        lat + (rand() - 0.5) * 0.02,
        lng + (rand() - 0.5) * 0.02,
        5 + Math.floor(rand() * 10),
        Math.round(avg * reviews),
        reviews,
        5 + Math.floor(rand() * 120),
        accepted,
        Math.floor(accepted * (0.75 + rand() * 0.25)),
        rand() < 0.4 ? 1 : 0,
        rand() < 0.3 ? 1 : 0,
        rand() < 0.7 ? 1 : 0,
        rand() < 0.8 ? 1 : 0,
      );
    }
  }
}
