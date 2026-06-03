/**
 * Tiny in-process TTL cache.
 *
 * Lets concurrent dashboard pollers (multiple tabs / instances all refreshing
 * on the same interval) share ONE expensive SSH round-trip per project instead
 * of each triggering its own. Storing failures too (negative caching) keeps an
 * unreachable host from being re-probed on every single poll — both are how the
 * status endpoints ended up storming :22.
 */
export interface TtlCache<T> {
  /** Returns the cached value, or undefined on miss/expiry. A cached value may
   *  itself be null/falsy, so callers should check `!== undefined`. */
  get(key: string): T | undefined;
  set(key: string, value: T): void;
}

export function createTtlCache<T>(ttlMs: number): TtlCache<T> {
  const store = new Map<string, { ts: number; value: T }>();
  return {
    get(key) {
      const hit = store.get(key);
      if (hit && Date.now() - hit.ts < ttlMs) return hit.value;
      if (hit) store.delete(key); // expired — drop it
      return undefined;
    },
    set(key, value) {
      store.set(key, { ts: Date.now(), value });
    },
  };
}
