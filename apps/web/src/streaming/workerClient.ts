import type { DecodedInstance, TileHeader } from "./decode";

/** One bounded worker per scene; payload ownership transfers off the UI thread. */
export class TileDecoder {
  private worker = new Worker(new URL("./decode.worker.ts", import.meta.url), { type: "module" });
  private nextId = 0;
  private disposed = false;
  private pending = new Map<
    number,
    { resolve: (items: DecodedInstance[]) => void; reject: (reason: Error) => void }
  >();

  constructor() {
    this.worker.onmessage = (
      event: MessageEvent<{ id: number; instances: DecodedInstance[]; error?: string }>,
    ) => {
      const pending = this.pending.get(event.data.id);
      this.pending.delete(event.data.id);
      if (event.data.error) pending?.reject(new Error(event.data.error));
      else pending?.resolve(event.data.instances);
    };
    this.worker.onerror = () => this.dispose();
  }

  decode(payload: ArrayBuffer, header: TileHeader, hash: string): Promise<DecodedInstance[]> {
    if (this.disposed) return Promise.reject(new Error("Tile decoder unavailable"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, payload, header, hash }, [payload]);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error("Tile decoder disposed"));
    this.pending.clear();
  }
}
