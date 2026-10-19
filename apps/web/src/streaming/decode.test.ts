import { describe, expect, it } from "vitest";
import { decodeInstances, decodeTile, sha256Hex, STRIDE_BYTES } from "../streaming/decode";

function payloadFor(count: number, mutate?: (view: DataView) => void): ArrayBuffer {
  const buffer = new ArrayBuffer(count * STRIDE_BYTES);
  const view = new DataView(buffer);
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE_BYTES;
    view.setFloat32(o, 0.1 * i, true);
    view.setFloat32(o + 4, 0.2, true);
    view.setFloat32(o + 8, 0.3, true);
    view.setFloat32(o + 12, 0.05, true);
    view.setFloat32(o + 16, 0.05, true);
    view.setFloat32(o + 20, 0.05, true);
    view.setUint32(o + 24, 4, true); // building
    view.setUint32(o + 28, i, true);
    view.setUint32(o + 32, 0, true);
    view.setUint32(o + 36, 0, true);
  }
  mutate?.(view);
  return buffer;
}

describe("tile decoder", () => {
  it("checks payload integrity and pick references before drawing", async () => {
    const payload = payloadFor(2);
    const hash = await sha256Hex(payload);
    const header = {
      format_version: 1,
      endianness: "little",
      snapshot_id: "snapshot",
      tile_id: "tile",
      stride_bytes: 40,
      instance_count: 2,
      content_sha256: hash,
      picks: ["a", "b"],
    };
    expect(await decodeTile(payload, header, hash)).toHaveLength(2);
    await expect(decodeTile(payload, { ...header, picks: ["a"] }, hash)).rejects.toThrow(
      "pick index",
    );
    await expect(decodeTile(payload, header, "invalid")).rejects.toThrow("checksum");
    await expect(decodeTile(payload, { ...header, stride_bytes: 20 }, hash)).rejects.toThrow(
      "format",
    );
  });

  it("rejects unbounded counts and negative scales", () => {
    expect(() => decodeInstances(new ArrayBuffer(0), 26215)).toThrow("budget");
    expect(() =>
      decodeInstances(
        payloadFor(1, (v) => v.setFloat32(12, -1, true)),
        1,
      ),
    ).toThrow("scale");
  });
  it("decodes valid payloads", () => {
    const decoded = decodeInstances(payloadFor(2), 2);
    expect(decoded).toHaveLength(2);
    expect(decoded[0].material).toBe("building");
    expect(decoded[1].pick).toBe(1);
  });

  it("rejects length, NaN and index violations before allocation", () => {
    expect(() => decodeInstances(payloadFor(2), 3)).toThrow();
    expect(() =>
      decodeInstances(
        payloadFor(1, (v) => v.setFloat32(0, Number.NaN, true)),
        1,
      ),
    ).toThrow();
    expect(() =>
      decodeInstances(
        payloadFor(1, (v) => v.setUint32(24, 99, true)),
        1,
      ),
    ).toThrow();
    expect(() =>
      decodeInstances(
        payloadFor(1, (v) => v.setUint32(36, 1, true)),
        1,
      ),
    ).toThrow();
  });
});
