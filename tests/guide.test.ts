import { test } from "node:test";
import assert from "node:assert/strict";
import { canOfferGuide, mercadoLibreUrl } from "../src/guide.js";
import type { Diagnosis } from "../src/diagnose.js";

const base: Diagnosis = {
  is_home_repair: true,
  trade: "plomero",
  problem_summary: "",
  likely_causes: [],
  urgency: "baja",
  complexity: "simple",
  safety_warning: null,
  diy_possible: true,
  diy_tips: [],
  question_for_user: null,
  reply_message: "",
};

test("ofrece guía para un arreglo simple de plomería", () => {
  assert.equal(canOfferGuide(base), true);
});

test("nunca ofrece guía para gas, aunque el modelo diga que se puede", () => {
  assert.equal(canOfferGuide({ ...base, trade: "gasista" }), false);
});

test("nunca ofrece guía en emergencias", () => {
  assert.equal(canOfferGuide({ ...base, urgency: "emergencia" }), false);
});

test("respeta diy_possible = false", () => {
  assert.equal(canOfferGuide({ ...base, diy_possible: false }), false);
});

test("link de Mercado Libre sin acentos ni símbolos", () => {
  assert.equal(
    mercadoLibreUrl("Flexible para canilla 1/2\" (40 cm)"),
    "https://listado.mercadolibre.com.ar/flexible-para-canilla-1-2-40-cm",
  );
  assert.equal(mercadoLibreUrl("cinta de teflón"), "https://listado.mercadolibre.com.ar/cinta-de-teflon");
});
