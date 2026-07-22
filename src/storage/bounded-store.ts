/**
 * Generic Map-backed store with a size cap and optional TTL.
 * Replaces the duplicated rotateEndpoints()/rotateJsonResponses() logic
 * from the original monolith with one tested implementation.
 */
export class BoundedStore<K, V extends { timestamp: number }> {
  private readonly store = new Map<K, V>();

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs?: number,
  ) {}

  set(key: K, value: V): void {
    this.store.set(key, value);
    this.rotate();
  }

  get(key: K): V | undefined {
    return this.store.get(key);
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Force TTL/size cleanup without inserting anything — call this before reading
   *  (getSummary/export) so a collector that's been idle doesn't show stale entries. */
  prune(): void {
    this.rotate();
  }

  get size(): number {
    return this.store.size;
  }

  values(): V[] {
    return Array.from(this.store.values());
  }

  entries(): Array<[K, V]> {
    return Array.from(this.store.entries());
  }

  private rotate(): void {
    if (this.ttlMs) {
      const now = Date.now();
      for (const [key, value] of this.store) {
        if (now - value.timestamp > this.ttlMs) {
          this.store.delete(key);
        }
      }
    }

    if (this.store.size > this.maxSize) {
      const sorted = this.entries().sort((a, b) => a[1].timestamp - b[1].timestamp);
      const excess = this.store.size - this.maxSize;
      for (let i = 0; i < excess; i++) {
        this.store.delete(sorted[i][0]);
      }
    }
  }
}

/**
 * Fixed-capacity FIFO list — for the plain arrays (networkRequests, errors,
 * per-type event buffers) that only ever need "drop the oldest".
 */
export class BoundedList<T> {
  private items: T[] = [];
  private dropped = 0;

  constructor(private readonly maxSize: number) {}

  push(item: T): void {
    if (this.items.length >= this.maxSize) {
      this.items.shift();
      this.dropped++;
    }
    this.items.push(item);
  }

  get length(): number {
    return this.items.length;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  toArray(): T[] {
    return [...this.items];
  }

  tail(n: number): T[] {
    return this.items.slice(-n);
  }

  clear(): void {
    this.items = [];
    this.dropped = 0;
  }
}
