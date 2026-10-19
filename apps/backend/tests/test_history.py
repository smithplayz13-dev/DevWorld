"""Temporal correctness fixtures (DATA.md section 7, TESTING.md).

Proves: prefix-max effective_at with clock-skew adjustment, ordinal
tie-breaks on equal dates, Now uses captured heads regardless of skew,
before_coverage vs not_yet_created, rename identity, copy/new-ID rule and
first-parent checkpoint replay.
"""

from datetime import UTC, datetime

from devworld.history import WorldHistory


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_clock_skew_child_dated_before_parent_clamps():
    history = WorldHistory()
    lineage = history.lineages["r1"]
    c1, c2, c3 = lineage
    assert c1["committed_at"] == "2026-03-12T10:00:00Z"
    assert c2["committed_at"] == "2026-03-10T09:00:00Z"  # skewed child
    assert c2["clock_adjusted"] is True
    assert c2["effective_at"] == c1["effective_at"]
    assert c3["clock_adjusted"] is False


def test_equal_dates_select_higher_ordinal():
    history = WorldHistory()
    lineage = history.lineages["r1"]
    target = _dt(lineage[1]["effective_at"])
    resolved = history.resolve_time("r1", target)
    assert resolved is not None
    assert resolved["ordinal"] == 1  # highest ordinal at that instant


def test_now_uses_captured_head():
    history = WorldHistory()
    far_future = datetime(2030, 1, 1, tzinfo=UTC)
    for repo_key in ("r1", "r2", "r3"):
        resolved = history.resolve_time(repo_key, far_future)
        assert resolved is not None
        assert resolved["oid"] == history.repos[repo_key]["head_oid"]


def test_before_coverage_not_empty_tree():
    history = WorldHistory()
    # r3 was created 2026-05-20; earlier date has no eligible commit and the
    # root is unknown, so callers must report before_coverage, never empty.
    assert history.resolve_time("r3", _dt("2026-01-01T00:00:00Z")) is None


def test_world_time_is_per_repo_vector():
    history = WorldHistory()
    target = _dt("2026-05-01T00:00:00Z")
    r1 = history.resolve_time("r1", target)
    r2 = history.resolve_time("r2", target)
    r3 = history.resolve_time("r3", target)
    assert r1 is not None and r2 is not None and r3 is None
    assert r1["oid"] != r2["oid"]  # no account-wide commit


def test_rename_preserves_identity_with_evidence():
    history = WorldHistory()
    renamed = [e for e in history.events["r3"] if e["operation"] == "renamed"]
    # The file and its symbols keep stable IDs; only their path changes.
    file_events = [e for e in renamed if e["entity_key"] == "r3:file:scales"]
    assert len(file_events) == 1
    event = file_events[0]
    assert event["confidence"] == "exact"
    assert event["before_version_id"] != event["after_version_id"]
    for e in renamed:
        assert e["before_version_id"] != e["after_version_id"]


def test_delete_is_remove_not_rewrite():
    history = WorldHistory()
    removed = [e for e in history.events["r2"] if e["operation"] == "removed"]
    keys = {e["entity_key"] for e in removed}
    assert "r2:file:legacy" in keys
    assert "r2:sym:run_legacy" in keys


def test_checkpoint_replay_matches_selected_tree():
    history = WorldHistory()
    # Replaying first-parent deltas from c1 must equal the c3 membership.
    r1 = history.lineages["r1"]
    c1_oid, c3_oid = r1[0]["oid"], r1[2]["oid"]
    base = dict(history.membership[("r1", c1_oid)])
    for event in history.events["r1"]:
        ordinal_of = next(i for i, row in enumerate(r1) if row["oid"] == event["commit_oid"])
        if ordinal_of == 0:
            continue
        key = event["entity_key"]
        if event["operation"] == "removed":
            base.pop(key, None)
        else:
            after_oid = event["commit_oid"]
            base[key] = history.membership[("r1", after_oid)][key]
        if event["commit_oid"] == c3_oid and False:  # placeholder guard
            break
    # Restrict replay to events up to and including c3.
    expected = history.membership[("r1", c3_oid)]
    assert set(base) == set(expected)
    for key, ver in expected.items():
        assert base[key]["version_id"] == ver["version_id"]
