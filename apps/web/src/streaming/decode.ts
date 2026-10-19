// Instance payload decoder (DATA.md section 8). Validates stride, lengths,
// finite values, material bounds and checksum BEFORE allocating scene
// resources; a tile that fails validation never reaches the renderer.
export const STRIDE_BYTES = 40;
const MATERIALS = ["ocean", "country", "state", "district", "building", "floor", "room"] as const;
export type MaterialName = (typeof MATERIALS)[number];

export interface DecodedInstance {
  position: [number, number, number];
  scale: [number, number, number];
  material: MaterialName;
  pick: number;
  flags: number;
}

export async function sha256Hex(payload: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function decodeInstances(payload: ArrayBuffer, expectedCount: number): DecodedInstance[] {
  if (!Number.isInteger(expectedCount) || expectedCount < 0 || expectedCount > 26214) {
    throw new Error("tile exceeds the 1 MiB instance budget");
  }
  if (payload.byteLength !== expectedCount * STRIDE_BYTES) {
    throw new Error(`tile length ${payload.byteLength} != ${expectedCount} * ${STRIDE_BYTES}`);
  }
  const view = new DataView(payload);
  const out: DecodedInstance[] = [];
  for (let i = 0; i < expectedCount; i++) {
    const o = i * STRIDE_BYTES;
    const position: [number, number, number] = [
      view.getFloat32(o, true),
      view.getFloat32(o + 4, true),
      view.getFloat32(o + 8, true),
    ];
    const scale: [number, number, number] = [
      view.getFloat32(o + 12, true),
      view.getFloat32(o + 16, true),
      view.getFloat32(o + 20, true),
    ];
    for (const value of [...position, ...scale]) {
      if (!Number.isFinite(value)) throw new Error("non-finite transform in tile");
    }
    if (scale.some((value) => value <= 0 || value > 2)) throw new Error("invalid instance scale");
    const material = view.getUint32(o + 24, true);
    const pick = view.getUint32(o + 28, true);
    const flags = view.getUint32(o + 32, true);
    const reserved = view.getUint32(o + 36, true);
    if (material >= MATERIALS.length) throw new Error(`material index ${material} out of bounds`);
    if (reserved !== 0) throw new Error("reserved slot must be zero");
    out.push({ position, scale, material: MATERIALS[material], pick, flags });
  }
  return out;
}

export interface TileHeader {
  format_version: number;
  endianness: string;
  snapshot_id: string;
  tile_id: string;
  stride_bytes: number;
  instance_count: number;
  content_sha256: string;
  picks: string[];
}

export async function decodeTile(
  payload: ArrayBuffer,
  header: TileHeader,
  expectedHash: string,
): Promise<DecodedInstance[]> {
  if (
    header.format_version !== 1 ||
    header.endianness !== "little" ||
    header.stride_bytes !== STRIDE_BYTES
  ) {
    throw new Error("unsupported tile format");
  }
  if (!Array.isArray(header.picks) || header.picks.some((id) => typeof id !== "string" || !id)) {
    throw new Error("invalid pick table");
  }
  const instances = decodeInstances(payload, header.instance_count);
  if (instances.some((instance) => instance.pick >= header.picks.length))
    throw new Error("pick index out of bounds");
  if (header.content_sha256 !== expectedHash || (await sha256Hex(payload)) !== expectedHash) {
    throw new Error("tile checksum mismatch");
  }
  return instances;
}
