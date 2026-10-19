// LOD fetch queue (ARCHITECTURE.md section 8). Priority: selected entity,
// its children, visible neighbours, then predicted level. Bounded
// concurrency (4 desktop / 2 mobile-low), AbortController cancellation, and
// sequence matching so stale tiles never replace the current snapshot.
export interface TileJob {
  key: string;
  priority: number;
  run: (signal: AbortSignal) => Promise<void>;
}

export class TileQueue {
  private running = 0;
  private pending: TileJob[] = [];
  private controllers = new Map<string, AbortController>();
  /** Latest accepted sequence per scope; stale completions are dropped. */
  generation = 0;
  /** Called after every settle so diagnostics never stick (was: stuck "1"). */
  onSettled: (() => void) | null = null;

  constructor(private concurrency: number) {}

  setConcurrency(n: number): void {
    this.concurrency = n;
  }

  /** Cancel everything (navigation or snapshot changed). */
  cancelAll(): void {
    this.generation += 1;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.pending = [];
  }

  enqueue(job: TileJob): void {
    this.cancelKey(job.key);
    this.pending.push(job);
    this.pending.sort((a, b) => a.priority - b.priority);
    void this.pump();
  }

  cancelKey(key: string): void {
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
    this.pending = this.pending.filter((job) => job.key !== key);
  }

  pendingCount(): number {
    return this.pending.length + this.running;
  }

  private async pump(): Promise<void> {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) break;
      const controller = new AbortController();
      this.controllers.set(job.key, controller);
      this.running += 1;
      const generation = this.generation;
      try {
        await job.run(controller.signal);
      } catch {
        /* aborted or failed: parent geometry stays visible */
      } finally {
        this.running -= 1;
        if (this.generation === generation) this.controllers.delete(job.key);
        this.onSettled?.();
        void this.pump();
      }
    }
  }
}
