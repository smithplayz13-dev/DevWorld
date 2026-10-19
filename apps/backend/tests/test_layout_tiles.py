"""Layout stability and tile codec invariants (TESTING.md)."""

import math

import pytest

from devworld import layout as layout_mod
from devworld import tiles
from devworld.history import WorldHistory


def test_country_anchors_stable_within_epoch():
    first = layout_mod.build_layout(WorldHistory())
    second = layout_mod.build_layout(WorldHistory())
    assert first == second
    slots = sorted(rec["slot"] for rec in first.values())
    assert slots == [0, 1, 2]


def test_new_country_takes_unused_slot():
    history = WorldHistory()
    before = layout_mod.build_layout(history)
    # Simulate a newly included repository: existing anchors must not move.
    history.repos["r9"] = dict(history.repos["r1"])
    history.repos["r9"]["name"] = "new-country"
    head = history.repos["r9"]["head_oid"]
    history.membership[("r9", head)] = history.membership[("r1", head)]
    after = layout_mod.build_layout(history)
    for key in before:
        assert after[key]["anchor"] == before[key]["anchor"]
        assert after[key]["slot"] == before[key]["slot"]


def test_weight_is_clamped_logarithmic():
    assert layout_mod.country_weight(0) == layout_mod.MIN_WEIGHT
    assert layout_mod.country_weight(10**12) == layout_mod.MAX_WEIGHT
    assert layout_mod.country_weight(1000) > layout_mod.country_weight(10)


def test_tile_roundtrip_and_bounds_checks():
    instances = [
        {
            "position": [0.1, 0.2, 0.3],
            "scale": [0.05, 0.05, 0.05],
            "material": 1,
            "pick": 0,
            "flags": 0,
        },
        {
            "position": [-0.4, 0.0, 0.9],
            "scale": [0.02, 0.03, 0.02],
            "material": 4,
            "pick": 7,
            "flags": 0,
        },
    ]
    payload = tiles.encode_instances(instances)
    assert len(payload) == 2 * tiles.STRIDE_BYTES
    decoded = tiles.decode_instances(payload, expected_count=2)
    assert decoded[0]["position"] == pytest.approx([0.1, 0.2, 0.3])
    assert decoded[1]["pick"] == 7
    with pytest.raises(ValueError):
        tiles.decode_instances(payload, expected_count=3)
    with pytest.raises(ValueError):
        tiles.decode_instances(_bad_payload(), expected_count=1)


def _bad_payload() -> bytes:
    import struct

    return struct.pack("<ffffffIIII", math.nan, 0, 0, 1, 1, 1, 0, 0, 0, 0)


def test_rejects_nonfinite_and_bad_material():
    import struct

    with pytest.raises(ValueError):
        tiles.encode_instances(
            [{"position": [math.inf, 0, 0], "scale": [1, 1, 1], "material": 0, "pick": 0}]
        )
    payload = struct.pack("<ffffffIIII", 0, 0, 0, 1, 1, 1, 99, 0, 0, 0)
    with pytest.raises(ValueError):
        tiles.decode_instances(payload, expected_count=1)
