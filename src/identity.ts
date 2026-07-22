export interface AgentIdentity {
  sessionId: string;
  agentId: string;
  agentType: string;
  expiresAt: number;
}

export class ClaudeIdentityStore {
  readonly #entries = new Map<string, AgentIdentity>();
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #maxEntries: number;

  constructor(ttlMs: number, options: { now?: () => number; maxEntries?: number } = {}) {
    this.#ttlMs = ttlMs;
    this.#now = options.now ?? Date.now;
    this.#maxEntries = options.maxEntries ?? 10_000;
  }

  register(sessionId: string, agentId: string, agentType: string): void {
    this.cleanup();
    if (this.#entries.size >= this.#maxEntries) {
      const oldest = [...this.#entries.entries()].sort((left, right) => left[1].expiresAt - right[1].expiresAt)[0];
      if (oldest) this.#entries.delete(oldest[0]);
    }
    this.#entries.set(key(sessionId, agentId), { sessionId, agentId, agentType, expiresAt: this.#now() + this.#ttlMs });
  }

  resolve(sessionId: string | undefined, agentId: string | undefined): string | undefined {
    if (!sessionId || !agentId) return undefined;
    const entry = this.#entries.get(key(sessionId, agentId));
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key(sessionId, agentId));
      return undefined;
    }
    return entry.agentType;
  }

  remove(sessionId: string, agentId: string): boolean {
    return this.#entries.delete(key(sessionId, agentId));
  }

  cleanup(): number {
    const before = this.#entries.size;
    const now = this.#now();
    for (const [entryKey, entry] of this.#entries) if (entry.expiresAt <= now) this.#entries.delete(entryKey);
    return before - this.#entries.size;
  }

  get size(): number {
    this.cleanup();
    return this.#entries.size;
  }
}

function key(sessionId: string, agentId: string): string {
  return `${sessionId.length}:${sessionId}${agentId}`;
}
