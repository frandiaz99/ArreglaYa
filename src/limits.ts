/** Mapa en memoria con vencimiento y tamaño máximo (descarta lo más viejo). */
export class TtlCache<K, V> {
  private map = new Map<K, { value: V; expires: number }>();
  constructor(
    private ttlMs: number,
    private maxEntries: number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.map.delete(key); // reinsertar = pasa a ser el más nuevo
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      this.map.delete(this.map.keys().next().value as K);
    }
  }
}

export class RateLimitedError extends Error {
  constructor(
    public retryAfterSec: number,
    /** true solo en el primer pedido rechazado de la ventana: sirve para avisar una sola vez. */
    public firstRejection: boolean,
  ) {
    super("Demasiados pedidos");
  }
}

/** Límite de pedidos por clave (IP o número de WhatsApp) en ventanas fijas. */
export class RateLimiter {
  private windows: TtlCache<string, { count: number; resetAt: number }>;

  constructor(
    private limit: number,
    private windowMs: number,
  ) {
    this.windows = new TtlCache(windowMs, 100_000);
  }

  /** Lanza RateLimitedError si se pasó del límite. */
  hit(key: string): void {
    const now = Date.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    if (w.count > this.limit) {
      throw new RateLimitedError(Math.ceil((w.resetAt - now) / 1000), w.count === this.limit + 1);
    }
  }
}

const HOUR = 60 * 60 * 1000;
export const diagnosisLimiter = new RateLimiter(Number(process.env.DIAGNOSES_PER_HOUR ?? 10), HOUR);
export const guideLimiter = new RateLimiter(Number(process.env.GUIDES_PER_HOUR ?? 3), HOUR);

export const MAX_TEXT_CHARS = 500;
