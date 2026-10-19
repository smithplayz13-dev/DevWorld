"""LOD tile codec (DATA.md section 8).

Tile envelope: UTF-8 JSON header + binary instance payload. Each instance is
ten little-endian 32-bit slots (40 bytes stride): position xyz (float32),
scale xyz (float32), material index (uint32), pick index (uint32), flags
(uint32), reserved zero (uint32). Checksums apply to the uncompressed payload.
Decoders must validate lengths, finite values and index bounds before
allocating typed arrays.
"""

from __future__ import annotations

import hashlib
import math
import struct
import uuid

FORMAT_VERSION = 1
STRIDE_BYTES = 40
_MATERIALS = ["ocean", "country", "state", "district", "building", "floor", "room"]

NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://devworld.example/tiles-v1")


def tile_uuid(*parts: str) -> str:
    return str(uuid.uuid5(NAMESPACE, "|".join(parts)))


def material_index(name: str) -> int:
    return _MATERIALS.index(name)


def encode_instances(instances: list[dict]) -> bytes:
    """Encode instance dicts to the 40-byte little-endian payload."""
    buf = bytearray()
    for inst in instances:
        pos = inst["position"]
        scale = inst["scale"]
        for value in (*pos, *scale):
            if not math.isfinite(value):
                raise ValueError("non-finite transform rejected")
        material = int(inst["material"])
        pick = int(inst["pick"])
        flags = int(inst.get("flags", 0))
        if not (0 <= material <= 0xFFFFFFFF and 0 <= pick <= 0xFFFFFFFF):
            raise ValueError("index out of range")
        buf += struct.pack(
            "<ffffffIIII",
            float(pos[0]),
            float(pos[1]),
            float(pos[2]),
            float(scale[0]),
            float(scale[1]),
            float(scale[2]),
            material,
            pick,
            flags,
            0,
        )
    return bytes(buf)


def decode_instances(payload: bytes, *, expected_count: int) -> list[dict]:
    """Validate then decode a payload. Raises ValueError on any violation."""
    if len(payload) != expected_count * STRIDE_BYTES:
        raise ValueError(f"length {len(payload)} != {expected_count} * {STRIDE_BYTES}")
    out: list[dict] = []
    for i in range(expected_count):
        chunk = payload[i * STRIDE_BYTES : (i + 1) * STRIDE_BYTES]
        px, py, pz, sx, sy, sz, mat, pick, flags, reserved = struct.unpack("<ffffffIIII", chunk)
        for value in (px, py, pz, sx, sy, sz):
            if not math.isfinite(value):
                raise ValueError("non-finite transform in payload")
        if mat >= len(_MATERIALS):
            raise ValueError(f"material index {mat} out of bounds")
        if reserved != 0:
            raise ValueError("reserved slot must be zero")
        out.append(
            {
                "position": [px, py, pz],
                "scale": [sx, sy, sz],
                "material": mat,
                "pick": pick,
                "flags": flags,
            }
        )
    return out


def sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def header(
    *,
    snapshot_id: str,
    tile_id: str,
    lod: str,
    instances: list[dict],
    payload: bytes,
) -> dict:
    return {
        "format_version": FORMAT_VERSION,
        "endianness": "little",
        "snapshot_id": snapshot_id,
        "tile_id": tile_id,
        "lod": lod,
        "instance_count": len(instances),
        "stride_bytes": STRIDE_BYTES,
        "content_sha256": sha256_hex(payload),
    }
