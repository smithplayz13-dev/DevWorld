"""Showcase fixture invariants: rich deterministic content, genuine churn.

The showcase repos (s1-s3) are separate from the tiny-world fixtures and
must provide hundreds of files, real add/remove/rename/modify events,
stable identity across renames, and byte-identical rebuilds.
"""

from devworld.history import WorldHistory
from devworld.showcase import SHOWCASE_REPO_KEYS, build_showcase_specs


def _showcase() -> WorldHistory:
    return WorldHistory(build_showcase_specs())


def test_showcase_has_hundreds_of_files():
    history = _showcase()
    total_files = 0
    for repo_key in SHOWCASE_REPO_KEYS:
        head = history.repos[repo_key]["head_oid"]
        members = history.membership[(repo_key, head)]
        files = [v for v in members.values() if v["kind"] == "file"]
        dirs = [v for v in members.values() if v["kind"] == "directory"]
        symbols = [v for v in members.values() if v["kind"] in ("class", "component", "function")]
        assert len(files) > 80, (repo_key, len(files))
        assert len([d for d in dirs if d["directory_depth"] == 1]) >= 3
        assert len(symbols) > 20
        total_files += len(files)
    assert total_files > 300


def test_showcase_history_genuinely_churns():
    history = _showcase()
    ops: set[str] = set()
    for repo_key in SHOWCASE_REPO_KEYS:
        for event in history.events[repo_key]:
            ops.add(event["operation"])
    assert {"added", "removed", "modified", "renamed"} <= ops


def test_showcase_renames_preserve_identity():
    history = _showcase()
    renamed = [e for e in history.events["s1"] if e["operation"] == "renamed"]
    assert renamed
    for event in renamed:
        assert event["before_version_id"] != event["after_version_id"]


def test_showcase_versions_distinguish_modified():
    history = _showcase()
    modified = [e for e in history.events["s1"] if e["operation"] == "modified"]
    assert modified
    event = modified[0]
    assert event["before_version_id"] != event["after_version_id"]
    # Unchanged entities keep their version across commits.
    lineage = history.lineages["s1"]
    first = history.membership[("s1", lineage[0]["oid"])]
    last = history.membership[("s1", lineage[-1]["oid"])]
    common = set(first) & set(last)
    assert common
    stable = [k for k in common if first[k]["version_id"] == last[k]["version_id"]]
    changed = [k for k in common if first[k]["version_id"] != last[k]["version_id"]]
    assert stable and changed


def test_showcase_rebuilds_are_byte_identical():
    first = _showcase()
    second = _showcase()
    for repo_key in SHOWCASE_REPO_KEYS:
        assert first.lineages[repo_key] == second.lineages[repo_key]
        head = first.repos[repo_key]["head_oid"]
        assert first.membership_fingerprint(repo_key, head) == second.membership_fingerprint(
            repo_key, head
        )


def test_showcase_repo_order_keeps_original_anchors():
    from devworld import layout as layout_mod
    from devworld.synthetic import build_specs

    small = layout_mod.build_layout(WorldHistory(build_specs()))
    combined_specs = build_specs() + build_showcase_specs()
    combined = layout_mod.build_layout(WorldHistory(combined_specs))
    for key in ("r1", "r2", "r3"):
        assert combined[key]["slot"] == small[key]["slot"]
        assert combined[key]["anchor"] == small[key]["anchor"]
