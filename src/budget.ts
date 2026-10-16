import { db } from "./database.js";
import { costUsd, type Usage } from "./pricing.js";

db.exec(`CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT PRIMARY KEY,
  cost_usd REAL NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0
)`);

const DAILY_BUDGET_USD = Number(process.env.DAILY_BUDGET_USD ?? 5);

export class BudgetExceededError extends Error {}

const today = () => new Date().toISOString().slice(0, 10);

export function spentToday(): number {
  const row = db.prepare("SELECT cost_usd FROM usage_daily WHERE day = ?").get(today()) as
    | { cost_usd: number }
    | undefined;
  return row?.cost_usd ?? 0;
}

/**
 * Corta antes de llamar a la API si ya se gastó el presupuesto del día.
 * Con pedidos en paralelo se puede pasar por unos centavos: el límite duro
 * es el de la consola de Anthropic.
 */
export function assertBudget(): void {
  if (spentToday() >= DAILY_BUDGET_USD) throw new BudgetExceededError("Presupuesto diario agotado");
}

export function recordUsage(model: string, usage: Usage): void {
  db.prepare(
    `INSERT INTO usage_daily (day, cost_usd, requests) VALUES (?, ?, 1)
     ON CONFLICT(day) DO UPDATE SET cost_usd = cost_usd + excluded.cost_usd, requests = requests + 1`,
  ).run(today(), costUsd(model, usage));
}
