/**
 * Test setup. The jsdom build vitest pulls in exposes a `localStorage` object
 * without working methods, so persisted-store tests fall over. Install a small
 * in-memory Storage so the real persist path (write → read-back) exercises
 * end-to-end without depending on jsdom internals.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

/**
 * jsdom implements neither the Pointer Capture API nor `scrollIntoView`, and
 * Radix's `Select` calls both while opening its listbox. Without them a test
 * cannot drive any Radix dropdown at all — the trigger throws before the
 * content mounts. These are no-op shims, not behaviour: they only let the
 * component reach the state a user would see.
 */
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
}

const memory = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  value: memory,
  writable: true,
  configurable: true,
});
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: memory,
    writable: true,
    configurable: true,
  });
}
