import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });
// timeout: esperar en vez de fallar si otro proceso está escribiendo
export const db = new DatabaseSync(process.env.DB_PATH ?? "data/arreglaya.db", { timeout: 5000 });
db.exec("PRAGMA journal_mode = WAL");
