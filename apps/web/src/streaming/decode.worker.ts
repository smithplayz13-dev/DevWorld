import { decodeTile, type TileHeader } from "./decode";

self.onmessage = async (
  event: MessageEvent<{ id: number; payload: ArrayBuffer; header: TileHeader; hash: string }>,
) => {
  const { id, payload, header, hash } = event.data;
  try {
    self.postMessage({ id, instances: await decodeTile(payload, header, hash) });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "Tile validation failed",
    });
  }
};
