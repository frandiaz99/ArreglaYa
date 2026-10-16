import { test } from "node:test";
import assert from "node:assert/strict";
import { bayesianRating, haversineKm, rankProviders, type Provider } from "../src/ranking.js";

const base: Provider = {
  id: 0,
  name: "x",
  trade: "plomero",
  phone: "",
  lat: -34.6037,
  lng: -58.3816,
  serviceRadiusKm: 10,
  ratingSum: 0,
  ratingCount: 0,
  avgResponseMinutes: 30,
  jobsAccepted: 10,
  jobsCompleted: 9,
  availableNow: false,
  emergencyService: false,
  verified: false,
  licensed: true,
};
const user = { lat: -34.6037, lng: -58.3816 };
const p = (over: Partial<Provider>): Provider => ({ ...base, ...over });

test("un 5.0 con 2 reseñas no le gana a un 4.8 con 200", () => {
  assert.ok(bayesianRating(10, 2) < bayesianRating(4.8 * 200, 200));
});

test("haversine: Obelisco → Palermo ≈ 4-5 km", () => {
  const d = haversineKm(user, { lat: -34.5889, lng: -58.4306 });
  assert.ok(d > 4 && d < 5.5, `distancia ${d}`);
});

test("filtra por oficio y radio de servicio", () => {
  const ranked = rankProviders(
    [
      p({ id: 1 }),
      p({ id: 2, trade: "electricista" }),
      p({ id: 3, lat: -34.9, serviceRadiusKm: 5 }), // ~33 km
    ],
    "plomero",
    "media",
    user,
  );
  assert.deepEqual(ranked.map((r) => r.provider.id), [1]);
});

test("gasistas sin matrícula quedan excluidos", () => {
  const ranked = rankProviders([p({ id: 1, trade: "gasista", licensed: false })], "gasista", "alta", user);
  assert.equal(ranked.length, 0);
});

test("en emergencia gana el cercano y disponible sobre el mejor puntuado lejano", () => {
  const ranked = rankProviders(
    [
      p({ id: 1, ratingSum: 4.9 * 150, ratingCount: 150, lat: -34.66, serviceRadiusKm: 20 }), // ~6 km
      p({ id: 2, ratingSum: 4.3 * 40, ratingCount: 40, availableNow: true, emergencyService: true, avgResponseMinutes: 10 }),
    ],
    "plomero",
    "emergencia",
    user,
  );
  assert.equal(ranked[0].provider.id, 2);
});

test("sin urgencia, la calificación pesa más que unos km de diferencia", () => {
  const ranked = rankProviders(
    [
      p({ id: 1, ratingSum: 3.6 * 80, ratingCount: 80 }),
      p({ id: 2, ratingSum: 4.9 * 120, ratingCount: 120, lat: -34.62 }), // ~2 km
    ],
    "plomero",
    "baja",
    user,
  );
  assert.equal(ranked[0].provider.id, 2);
});
