import type { Trade, Urgency } from "./diagnose.js";

export type Provider = {
  id: number;
  name: string;
  trade: Trade;
  phone: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
  ratingSum: number;
  ratingCount: number;
  avgResponseMinutes: number;
  jobsAccepted: number;
  jobsCompleted: number;
  availableNow: boolean;
  emergencyService: boolean;
  verified: boolean;
  licensed: boolean;
};

export type Location = { lat: number; lng: number };

export type RankedProvider = {
  provider: Provider;
  distanceKm: number;
  rating: number;
  score: number;
  reasons: string[];
};

/** Prior de la plataforma: un profesional sin reseñas arranca cerca del promedio. */
const PRIOR_MEAN = 4.2;
const PRIOR_WEIGHT = 10;

export function bayesianRating(sum: number, count: number): number {
  return (PRIOR_MEAN * PRIOR_WEIGHT + sum) / (PRIOR_WEIGHT + count);
}

export function haversineKm(a: Location, b: Location): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** En urgencias la distancia pesa más: un plomero a 2 km vale mucho más que uno a 10 km. */
const DISTANCE_SCALE_KM: Record<Urgency, number> = { emergencia: 3, alta: 5, media: 8, baja: 12 };

const WEIGHTS: Record<Urgency, { rating: number; distance: number; response: number; completion: number; available: number }> = {
  emergencia: { rating: 0.2, distance: 0.3, response: 0.2, completion: 0.05, available: 0.25 },
  alta: { rating: 0.3, distance: 0.25, response: 0.2, completion: 0.1, available: 0.15 },
  media: { rating: 0.4, distance: 0.25, response: 0.1, completion: 0.15, available: 0.1 },
  baja: { rating: 0.45, distance: 0.2, response: 0.05, completion: 0.2, available: 0.1 },
};

export function rankProviders(
  providers: Provider[],
  trade: Trade,
  urgency: Urgency,
  user: Location,
  limit = 3,
): RankedProvider[] {
  const w = WEIGHTS[urgency];
  const ranked: RankedProvider[] = [];

  for (const p of providers) {
    if (p.trade !== trade) continue;
    const distanceKm = haversineKm(user, p);
    if (distanceKm > p.serviceRadiusKm) continue;
    // Gas y electricidad exigen matrícula
    if ((trade === "gasista" || trade === "electricista") && !p.licensed) continue;

    const rating = bayesianRating(p.ratingSum, p.ratingCount);
    const ratingScore = (rating - 1) / 4;
    const distanceScore = Math.exp(-distanceKm / DISTANCE_SCALE_KM[urgency]);
    const responseScore = 1 / (1 + p.avgResponseMinutes / 30);
    // Laplace para no premiar 1/1 = 100 %
    const completionScore = (p.jobsCompleted + 1) / (p.jobsAccepted + 2);
    const availableScore = p.availableNow ? 1 : 0;

    let score =
      w.rating * ratingScore +
      w.distance * distanceScore +
      w.response * responseScore +
      w.completion * completionScore +
      w.available * availableScore;
    if (p.verified) score += 0.05;
    if (urgency === "emergencia" && !p.emergencyService) score *= 0.5;

    const reasons: string[] = [];
    reasons.push(`⭐ ${rating.toFixed(1)} (${p.ratingCount} reseñas)`);
    reasons.push(`📍 a ${distanceKm.toFixed(1)} km`);
    if (p.availableNow) reasons.push("🟢 disponible ahora");
    if (p.avgResponseMinutes <= 20) reasons.push(`⚡ responde en ~${p.avgResponseMinutes} min`);
    if (p.licensed) reasons.push("📜 matriculado");
    if (p.verified) reasons.push("✅ identidad verificada");

    ranked.push({ provider: p, distanceKm, rating, score, reasons });
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}
