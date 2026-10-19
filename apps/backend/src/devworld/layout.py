"""Deterministic geography (ARCHITECTURE.md section 7, DATA.md section 8).

Country slots are allocated in stable repository-key order on a golden-angle
spiral. Anchors are fixed within layout epoch 1: new countries take unused
slots and historical absence never repacks neighbours. Weights use clamped
log1p(source_bytes) so spatial memory wins over exact proportionality.
"""

from __future__ import annotations

import hashlib
import math

from .history import WorldHistory

GLOBE_RADIUS = 1.0
GOLDEN_ANGLE = math.pi * (3.0 - math.sqrt(5.0))
MIN_WEIGHT = 0.6
MAX_WEIGHT = 3.0
MIN_ISLAND = 0.16  # radians, keeps tiny countries selectable


def repo_source_bytes(history: WorldHistory, repo_key: str) -> int:
    """Source bytes at the captured head (derived metadata, not quality)."""
    head = history.repos[repo_key]["head_oid"]
    members = history.membership[(repo_key, head)]
    total = 0
    for ver in members.values():
        if ver["kind"] == "file":
            total += int(ver["metrics"].get("source_bytes", 0))
    return total


def country_weight(source_bytes: int) -> float:
    """Clamped logarithmic weight for country area."""
    return max(MIN_WEIGHT, min(MAX_WEIGHT, math.log1p(max(0, source_bytes))))


def country_anchor(slot: int) -> tuple[float, float]:
    """Deterministic (latitude, longitude) in radians for a slot."""
    if 3 <= slot < 6:
        # Keep the original tiny-world anchors, and use their antipodes for
        # the three showcase countries. Clamping the old formula put every
        # country after slot 3 on the very same south-pole coordinate.
        lat, lon = country_anchor(slot - 3)
        return -lat, (lon + 2.0 * math.pi) % (2.0 * math.pi) - math.pi
    if slot >= 6:
        y = 0.94 * (1.0 - 2.0 * ((slot * 0.618033988749895) % 1.0))
        return math.asin(y), (slot * GOLDEN_ANGLE + math.pi) % (2.0 * math.pi) - math.pi
    # Golden-angle spiral keeps slots spread; stable per slot forever.
    lat = math.asin(max(-1.0, min(1.0, 1.0 - (slot + 0.5) * 0.55)))
    lon = (slot * GOLDEN_ANGLE) % (2.0 * math.pi)
    if lon > math.pi:
        lon -= 2.0 * math.pi
    return lat, lon


def anchor_xyz(slot: int, radius: float = GLOBE_RADIUS) -> tuple[float, float, float]:
    lat, lon = country_anchor(slot)
    x = radius * math.cos(lat) * math.cos(lon)
    y = radius * math.sin(lat)
    z = radius * math.cos(lat) * math.sin(lon)
    return (x, y, z)


def build_layout(history: WorldHistory) -> dict[str, dict]:
    """Return per-repository layout records keyed by repo key."""
    layout: dict[str, dict] = {}
    ordered = sorted(history.repos)
    for slot, repo_key in enumerate(ordered):
        weight = country_weight(repo_source_bytes(history, repo_key))
        lat, lon = country_anchor(slot)
        xyz = anchor_xyz(slot)
        # Stable per-repo jitter so sibling parcels differ deterministically.
        jitter = (int(hashlib.sha256(repo_key.encode()).hexdigest()[:8], 16) % 1000) / 1000.0
        layout[repo_key] = {
            "slot": slot,
            "anchor": {"lat": lat, "lon": lon, "xyz": list(xyz)},
            "weight": weight,
            "radius": max(MIN_ISLAND, 0.34 * math.sqrt(weight)),
            "jitter": jitter,
            "layout_epoch": 1,
        }
    return layout


def child_position(
    layout: dict[str, dict], repo_key: str, index: int, total: int, level: int
) -> tuple[float, float, float]:
    """Deterministic tangent-frame offset for a child instance.

    Positions live near the country anchor so distant views stay cheap;
    the client blends into a local tangent frame when close.
    """
    rec = layout[repo_key]
    ax, ay, az = rec["anchor"]["xyz"]
    spread = rec["radius"] * (0.35 + 0.15 * level)
    # A proper tangent basis works at the poles too. Spread the coarse city
    # across the parcel instead of stacking all buildings in a narrow ring.
    helper = (1.0, 0.0, 0.0) if abs(ay) > 0.9 else (0.0, 1.0, 0.0)
    ux, uy, uz = (
        ay * helper[2] - az * helper[1],
        az * helper[0] - ax * helper[2],
        ax * helper[1] - ay * helper[0],
    )
    length = math.sqrt(ux * ux + uy * uy + uz * uz)
    ux, uy, uz = ux / length, uy / length, uz / length
    vx, vy, vz = ay * uz - az * uy, az * ux - ax * uz, ax * uy - ay * ux
    radius = min(0.32, spread) * math.sqrt((index + 0.5) / max(1, total))
    angle = index * GOLDEN_ANGLE + rec["jitter"]
    ox, oy = math.cos(angle) * radius, math.sin(angle) * radius
    px, py, pz = ax + ux * ox + vx * oy, ay + uy * ox + vy * oy, az + uz * ox + vz * oy
    length = math.sqrt(px * px + py * py + pz * pz)
    return px / length * 1.02, py / length * 1.02, pz / length * 1.02
