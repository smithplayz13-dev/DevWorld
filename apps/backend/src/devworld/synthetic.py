"""Deterministic synthetic demo world (M0 fixture + M1/M2 vertical slice).

Builds the ``tiny-world`` fixture in code: 3 countries (repositories) with
root files, nested folders, a Python class/method, a TSX component and one
JS rename, plus three exact historical states. All IDs are UUID5 (stable
across runs) and all commit OIDs are seeded SHA-1 hex strings.

This provider stands in for the GitHub adapter until M3 configures a real
GitHub App. Demo data is synthetic; it is never presented as user data.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field

NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://devworld.example/synthetic-v1")
PIPELINE_HASH = hashlib.sha256(b"devworld-synthetic-pipeline-v1").hexdigest()

WORLD_ID = str(uuid.uuid5(NAMESPACE, "world:demo"))
WORLD_VERSION_ID = str(uuid.uuid5(NAMESPACE, "world-version:demo-v1"))
ROOT_ENTITY_ID = str(uuid.uuid5(NAMESPACE, "entity:world-root"))


def eu(key: str) -> str:
    """Stable entity UUID for a logical key."""
    return str(uuid.uuid5(NAMESPACE, f"entity:{key}"))


def ev(entity_key: str, commit_oid: str) -> str:
    """Stable entity-version UUID for an entity at a commit."""
    return str(uuid.uuid5(NAMESPACE, f"version:{entity_key}@{commit_oid}"))


def commit_oid(repo_key: str, name: str) -> str:
    """Seeded 40-char hex Git OID for a synthetic commit."""
    return hashlib.sha1(f"commit:{repo_key}:{name}".encode()).hexdigest()


def _src(lines: list[str]) -> str:
    return "\n".join(lines) + "\n"


@dataclass
class Symbol:
    key: str
    kind: str  # class | component | function
    name: str
    # parent: "file" (top-level) or another symbol key
    parent_symbol: str | None = None
    start_line: int = 1
    end_line: int = 10


@dataclass
class FileState:
    key: str
    path: str
    language: str | None
    source: str
    symbols: list[Symbol] = field(default_factory=list)
    # analysis override, e.g. ("excluded", "binary")
    analysis: str = "ready"
    exclusion_reason: str | None = None


@dataclass
class CommitState:
    name: str
    committed_at: str  # original Git timestamp (may be skewed)
    files: list[FileState]


@dataclass
class RepoSpec:
    key: str  # e.g. "r1"
    name: str
    github_id: str
    language: str
    default_ref: str = "main"
    commits: list[CommitState] = field(default_factory=list)


def _chart_source(with_render: bool) -> str:
    lines = [
        "export function formatTick(value: number): string {",
        "  return `${value}`;",
        "}",
        "",
        "export function Chart(props: { title: string }) {",
        "  return <figure>{props.title}</figure>;",
        "}",
    ]
    if with_render:
        lines += [
            "",
            "export function renderChart(el: Element): void {",
            "  el.setAttribute('data-chart', 'ready');",
            "}",
        ]
    return _src(lines)


R1_LEGEND = _src(
    [
        "export function Legend(items: string[]) {",
        "  return items.map((item) => <span>{item}</span>);",
        "}",
    ]
)
R1_INDEX = _src(
    [
        "export function bootstrap(): void {",
        "  console.log('atlas ready');",
        "}",
    ]
)
R1_README = "# Atlas Web\n\nDemo country for the synthetic world.\n"
R2_MAIN = _src(["def main():", '    print("orbit ready")', ""])
R2_OLD_MAIN = _src(["def main():", '    print("orbit")', ""])
R2_ORBITS = _src(
    [
        "class OrbitCalculator:",
        '    """Compute transfer orbits."""',
        "",
        "    def compute(self, radius: float) -> float:",
        "        return radius * 2.0",
    ]
)
R2_LEGACY = _src(["def run_legacy():", '    print("legacy")', ""])
R3_SCALE = _src(
    [
        "export class Scale {",
        "  normalize(value) {",
        "    return Math.max(0, value);",
        "  }",
        "}",
    ]
)


def build_specs() -> list[RepoSpec]:
    """Author the synthetic repository histories."""
    r1 = RepoSpec(
        key="r1",
        name="atlas-web",
        github_id="101",
        language="TypeScript",
        commits=[
            CommitState(
                name="c1",
                committed_at="2026-03-12T10:00:00Z",
                files=[
                    FileState(
                        key="r1:file:index",
                        path="src/index.ts",
                        language="TypeScript",
                        source=R1_INDEX,
                        symbols=[
                            Symbol(
                                key="r1:sym:bootstrap",
                                kind="function",
                                name="bootstrap",
                                start_line=1,
                                end_line=3,
                            )
                        ],
                    ),
                    FileState(
                        key="r1:file:chart",
                        path="src/components/Chart.tsx",
                        language="TSX",
                        source=_chart_source(False),
                        symbols=[
                            Symbol(
                                key="r1:sym:formatTick",
                                kind="function",
                                name="formatTick",
                                start_line=1,
                                end_line=3,
                            ),
                            Symbol(
                                key="r1:sym:Chart",
                                kind="component",
                                name="Chart",
                                start_line=5,
                                end_line=7,
                            ),
                        ],
                    ),
                    FileState(
                        key="r1:file:readme",
                        path="README.md",
                        language="Markdown",
                        source=R1_README,
                        analysis="unsupported",
                    ),
                ],
            ),
            CommitState(
                name="c2",
                # Clock-skew fixture: child dated BEFORE its parent.
                committed_at="2026-03-10T09:00:00Z",
                files=[
                    FileState(
                        key="r1:file:index",
                        path="src/index.ts",
                        language="TypeScript",
                        source=R1_INDEX,
                        symbols=[
                            Symbol(
                                key="r1:sym:bootstrap",
                                kind="function",
                                name="bootstrap",
                                start_line=1,
                                end_line=3,
                            )
                        ],
                    ),
                    FileState(
                        key="r1:file:chart",
                        path="src/components/Chart.tsx",
                        language="TSX",
                        source=_chart_source(False),
                        symbols=[
                            Symbol(
                                key="r1:sym:formatTick",
                                kind="function",
                                name="formatTick",
                                start_line=1,
                                end_line=3,
                            ),
                            Symbol(
                                key="r1:sym:Chart",
                                kind="component",
                                name="Chart",
                                start_line=5,
                                end_line=7,
                            ),
                        ],
                    ),
                    FileState(
                        key="r1:file:readme",
                        path="README.md",
                        language="Markdown",
                        source=R1_README,
                        analysis="unsupported",
                    ),
                    FileState(
                        key="r1:file:legend",
                        path="src/components/Legend.tsx",
                        language="TSX",
                        source=R1_LEGEND,
                        symbols=[
                            Symbol(
                                key="r1:sym:Legend",
                                kind="component",
                                name="Legend",
                                start_line=1,
                                end_line=3,
                            )
                        ],
                    ),
                ],
            ),
            CommitState(
                name="c3",
                committed_at="2026-06-18T12:00:00Z",
                files=[
                    FileState(
                        key="r1:file:index",
                        path="src/index.ts",
                        language="TypeScript",
                        source=R1_INDEX,
                        symbols=[
                            Symbol(
                                key="r1:sym:bootstrap",
                                kind="function",
                                name="bootstrap",
                                start_line=1,
                                end_line=3,
                            )
                        ],
                    ),
                    FileState(
                        key="r1:file:chart",
                        path="src/components/Chart.tsx",
                        language="TSX",
                        source=_chart_source(True),
                        symbols=[
                            Symbol(
                                key="r1:sym:formatTick",
                                kind="function",
                                name="formatTick",
                                start_line=1,
                                end_line=3,
                            ),
                            Symbol(
                                key="r1:sym:Chart",
                                kind="component",
                                name="Chart",
                                start_line=5,
                                end_line=7,
                            ),
                            Symbol(
                                key="r1:sym:renderChart",
                                kind="function",
                                name="renderChart",
                                start_line=9,
                                end_line=11,
                            ),
                        ],
                    ),
                    FileState(
                        key="r1:file:readme",
                        path="README.md",
                        language="Markdown",
                        source=R1_README,
                        analysis="unsupported",
                    ),
                    FileState(
                        key="r1:file:legend",
                        path="src/components/Legend.tsx",
                        language="TSX",
                        source=R1_LEGEND,
                        symbols=[
                            Symbol(
                                key="r1:sym:Legend",
                                kind="component",
                                name="Legend",
                                start_line=1,
                                end_line=3,
                            )
                        ],
                    ),
                ],
            ),
        ],
    )
    r2 = RepoSpec(
        key="r2",
        name="orbit-api",
        github_id="102",
        language="Python",
        commits=[
            CommitState(
                name="c1",
                committed_at="2026-04-01T08:00:00Z",
                files=[
                    FileState(
                        key="r2:file:main",
                        path="src/main.py",
                        language="Python",
                        source=R2_OLD_MAIN,
                        symbols=[
                            Symbol(
                                key="r2:sym:main",
                                kind="function",
                                name="main",
                                start_line=1,
                                end_line=2,
                            )
                        ],
                    ),
                    FileState(
                        key="r2:file:orbits",
                        path="src/api/orbits.py",
                        language="Python",
                        source=R2_ORBITS,
                        symbols=[
                            Symbol(
                                key="r2:sym:OrbitCalculator",
                                kind="class",
                                name="OrbitCalculator",
                                start_line=1,
                                end_line=5,
                            ),
                            Symbol(
                                key="r2:sym:compute",
                                kind="function",
                                name="compute",
                                parent_symbol="r2:sym:OrbitCalculator",
                                start_line=4,
                                end_line=5,
                            ),
                        ],
                    ),
                    FileState(
                        key="r2:file:legacy",
                        path="src/legacy.py",
                        language="Python",
                        source=R2_LEGACY,
                        symbols=[
                            Symbol(
                                key="r2:sym:run_legacy",
                                kind="function",
                                name="run_legacy",
                                start_line=1,
                                end_line=2,
                            )
                        ],
                    ),
                ],
            ),
            CommitState(
                name="c2",
                committed_at="2026-06-02T15:30:00Z",
                files=[
                    FileState(
                        key="r2:file:main",
                        path="src/main.py",
                        language="Python",
                        source=R2_MAIN,
                        symbols=[
                            Symbol(
                                key="r2:sym:main",
                                kind="function",
                                name="main",
                                start_line=1,
                                end_line=2,
                            )
                        ],
                    ),
                    FileState(
                        key="r2:file:orbits",
                        path="src/api/orbits.py",
                        language="Python",
                        source=R2_ORBITS,
                        symbols=[
                            Symbol(
                                key="r2:sym:OrbitCalculator",
                                kind="class",
                                name="OrbitCalculator",
                                start_line=1,
                                end_line=5,
                            ),
                            Symbol(
                                key="r2:sym:compute",
                                kind="function",
                                name="compute",
                                parent_symbol="r2:sym:OrbitCalculator",
                                start_line=4,
                                end_line=5,
                            ),
                        ],
                    ),
                ],
            ),
        ],
    )
    r3 = RepoSpec(
        key="r3",
        name="star-charts",
        github_id="103",
        language="JavaScript",
        commits=[
            CommitState(
                name="c1",
                committed_at="2026-05-20T11:00:00Z",
                files=[
                    FileState(
                        key="r3:file:scales",
                        path="src/lib/scale.js",
                        language="JavaScript",
                        source=R3_SCALE,
                        symbols=[
                            Symbol(
                                key="r3:sym:Scale",
                                kind="class",
                                name="Scale",
                                start_line=1,
                                end_line=5,
                            ),
                            Symbol(
                                key="r3:sym:normalize",
                                kind="function",
                                name="normalize",
                                parent_symbol="r3:sym:Scale",
                                start_line=2,
                                end_line=4,
                            ),
                        ],
                    ),
                ],
            ),
            CommitState(
                name="c2",
                committed_at="2026-06-18T09:00:00Z",
                files=[
                    # Exact rename: same bytes, same entity key, new path.
                    FileState(
                        key="r3:file:scales",
                        path="src/lib/scales.js",
                        language="JavaScript",
                        source=R3_SCALE,
                        symbols=[
                            Symbol(
                                key="r3:sym:Scale",
                                kind="class",
                                name="Scale",
                                start_line=1,
                                end_line=5,
                            ),
                            Symbol(
                                key="r3:sym:normalize",
                                kind="function",
                                name="normalize",
                                parent_symbol="r3:sym:Scale",
                                start_line=2,
                                end_line=4,
                            ),
                        ],
                    ),
                ],
            ),
        ],
    )
    return [r1, r2, r3]
