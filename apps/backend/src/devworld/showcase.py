"""Deterministic showcase fixture (synthetic, explicitly labeled).

Richer sibling repositories for the demo world: hundreds of files across
real top-level folders and nested districts, with multi-commit histories
that genuinely add, remove, rename and modify entities. The original
tiny-world repos (r1-r3) are untouched; focused temporal tests keep using
``WorldHistory()`` without showcase specs. Slot order (r1,r2,r3,s1,s2,s3)
keeps the original country anchors stable.
"""

from __future__ import annotations

import hashlib
import random

from .synthetic import CommitState, FileState, RepoSpec, Symbol

SEED = 20260618
SHOWCASE_REPO_KEYS = ("s1", "s2", "s3")


def _stable_int(*parts: str) -> int:
    """Deterministic integer (never use salted ``hash()`` for fixture data)."""
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:16], 16)


_NOUNS = [
    "cart",
    "catalog",
    "checkout",
    "ledger",
    "parcel",
    "route",
    "signal",
    "beacon",
    "harbor",
    "lantern",
    "compass",
    "anchor",
    "voyager",
    "harbor",
    "meadow",
    "cinder",
]
_VERBS = ["sync", "render", "parse", "index", "fetch", "emit", "merge", "prune"]


def _py_class(name: str) -> tuple[str, list[Symbol]]:
    src = (
        f"class {name}:\n"
        f'    """Synthetic showcase class."""\n\n'
        f"    def build(self):\n"
        f"        return 1\n\n"
        f"    def refresh(self):\n"
        f"        return 2\n"
    )
    symbols = [
        Symbol(key="", kind="class", name=name, start_line=1, end_line=8),
        Symbol(
            key="",
            kind="function",
            name="build",
            parent_symbol="__self__",
            start_line=4,
            end_line=5,
        ),
        Symbol(
            key="",
            kind="function",
            name="refresh",
            parent_symbol="__self__",
            start_line=7,
            end_line=8,
        ),
    ]
    return src, symbols


def _py_funcs(stem: str) -> tuple[str, list[Symbol]]:
    src = f"def load_{stem}():\n    return True\n\n\ndef save_{stem}():\n    return True\n"
    return src, [
        Symbol(key="", kind="function", name=f"load_{stem}", start_line=1, end_line=2),
        Symbol(key="", kind="function", name=f"save_{stem}", start_line=5, end_line=6),
    ]


def _tsx_comp(name: str) -> tuple[str, list[Symbol]]:
    src = (
        f"export function {name}(props: {{ title: string }}) {{\n"
        f"  return <section>{{props.title}}</section>;\n"
        f"}}\n\n"
        f"export function format{name}(value: number): string {{\n"
        f"  return `${{value}}`;\n"
        f"}}\n"
    )
    return src, [
        Symbol(key="", kind="component", name=name, start_line=1, end_line=3),
        Symbol(key="", kind="function", name=f"format{name}", start_line=5, end_line=7),
    ]


def _ts_mod(stem: str) -> tuple[str, list[Symbol]]:
    src = (
        f"export function get{stem}(): number {{\n  return 1;\n}}\n\n"
        f"export function set{stem}(v: number): void {{\n  void v;\n}}\n"
    )
    name = stem[:1].upper() + stem[1:]
    return src, [
        Symbol(key="", kind="function", name=f"get{name}", start_line=1, end_line=3),
        Symbol(key="", kind="function", name=f"set{name}", start_line=5, end_line=7),
    ]


def _doc(title: str) -> tuple[str, list[Symbol]]:
    return f"# {title}\n\nSynthetic showcase document.\n", []


class LogicalFile:
    """One file identity across commits (rename keeps the key, changes path)."""

    def __init__(
        self,
        repo: str,
        fid: int,
        path: str,
        language: str | None,
        source: str,
        symbols: list[Symbol],
        created: int,
        removed: int | None = None,
    ) -> None:
        self.key = f"{repo}:file:s{fid:04d}"
        self.path = path
        self.language = language
        self.source = source
        self.symbols = symbols
        self.created = created
        self.removed = removed
        self.renames: dict[int, str] = {}
        self.modified: set[int] = set()

    def with_symbol_keys(self) -> "LogicalFile":
        fixed: list[Symbol] = []
        for i, sym in enumerate(self.symbols):
            parent = None
            if sym.parent_symbol == "__self__":
                parent = f"{self.key}:sym:0"
            key = f"{self.key}:sym:{i}"
            fixed.append(
                Symbol(
                    key=key,
                    kind=sym.kind,  # type: ignore[arg-type]
                    name=sym.name,
                    parent_symbol=parent,
                    start_line=sym.start_line,
                    end_line=sym.end_line,
                )
            )
        self.symbols = fixed
        return self


def _title_case(stem: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in stem.split("_"))


def _build_repo(
    rng: random.Random,
    *,
    repo: str,
    name: str,
    github_id: str,
    language: str,
    default_ref: str,
    tree: list[tuple[str, list[str], str]],
    dates: list[str],
    total: int,
) -> RepoSpec:
    """Generate logical files, then materialize three commits with churn."""
    exts = {"tsx": "TSX", "ts": "TypeScript", "py": "Python", "md": "Markdown", "json": "JSON"}
    logical: list[LogicalFile] = []
    for fid in range(total):
        top, subs, ext = tree[fid % len(tree)]
        stem = f"{rng.choice(_NOUNS)}_{rng.choice(_VERBS)}_{fid:03d}"
        sub = rng.choice(subs) if subs else ""
        path = "/".join(p for p in (top, sub, f"{stem}.{ext}") if p)
        lang = exts[ext]
        if ext == "py" and fid % 3 == 0:
            src, syms = _py_class(_title_case(stem))
        elif ext == "py":
            src, syms = _py_funcs(stem)
        elif ext == "tsx":
            src, syms = _tsx_comp(_title_case(stem))
        elif ext == "ts":
            src, syms = _ts_mod(stem)
        elif ext == "md":
            src, syms = _doc(_title_case(stem))
        else:
            src, syms = ('{\n  "synthetic": true\n}\n', [])
        # Stagger creation across commits; a few files arrive late.
        created = 0 if fid % 10 < 6 else (1 if fid % 10 < 9 else 2)
        removed = 2 if fid % 23 == 7 else None
        logical.append(
            LogicalFile(repo, fid, path, lang, src, syms, created, removed).with_symbol_keys()
        )
    # Deterministic churn: renames keep identity, modifications change bytes.
    renamable = [
        f for f in logical if f.created == 0 and f.removed is None and f.path.count("/") >= 2
    ][:6]
    for i, f in enumerate(renamable):
        head, tail = f.path.rsplit("/", 1)
        stem, ext = tail.rsplit(".", 1)
        f.renames[1 if i % 2 == 0 else 2] = f"{head}/{stem}_v2.{ext}"
    for f in logical:
        if f.created <= 1 and f.removed is None and _stable_int(repo, f.key) % 5 == 0:
            f.modified.add(2)
        if f.created == 0 and _stable_int(repo, f.key, "c2") % 7 == 0:
            f.modified.add(1)
    commits: list[CommitState] = []
    for idx, at in enumerate(dates):
        files: list[FileState] = []
        for f in logical:
            if f.created > idx:
                continue
            if f.removed is not None and idx >= f.removed:
                continue
            path = f.path
            for ridx in sorted(f.renames):
                if idx >= ridx:
                    path = f.renames[ridx]
            source = f.source
            if idx in f.modified:
                source += f"\n# showcase revision {idx} for {f.key}\n"
            files.append(
                FileState(
                    key=f.key, path=path, language=f.language, source=source, symbols=f.symbols
                )
            )
        commits.append(CommitState(name=f"c{idx + 1}", committed_at=at, files=files))
    return RepoSpec(
        key=repo,
        name=name,
        github_id=github_id,
        language=language,
        default_ref=default_ref,
        commits=commits,
    )


def build_showcase_specs() -> list[RepoSpec]:
    """Three richly populated synthetic repositories (labeled showcase)."""
    rng = random.Random(SEED)
    storefront = _build_repo(
        rng,
        repo="s1",
        name="storefront",
        github_id="201",
        language="TypeScript",
        default_ref="main",
        tree=[
            ("pages", ["shop", "account", "checkout"], "tsx"),
            ("components", ["catalog", "cart", "common", "layout"], "tsx"),
            ("lib", ["pricing", "search"], "ts"),
            ("styles", [], "ts"),
            ("docs", [], "md"),
        ],
        dates=["2026-02-10T09:00:00Z", "2026-04-22T14:00:00Z", "2026-06-16T10:00:00Z"],
        total=150,
    )
    telemetry = _build_repo(
        rng,
        repo="s2",
        name="telemetry-api",
        github_id="202",
        language="Python",
        default_ref="main",
        tree=[
            ("src/ingest", ["sinks", "sources"], "py"),
            ("src/api", ["routes", "auth"], "py"),
            ("src/models", [], "py"),
            ("src/workers", [], "py"),
            ("tests", ["ingest", "api"], "py"),
            ("docs", [], "md"),
        ],
        dates=["2026-03-05T08:00:00Z", "2026-05-11T16:00:00Z", "2026-06-14T09:00:00Z"],
        total=120,
    )
    forge = _build_repo(
        rng,
        repo="s3",
        name="pixel-forge",
        github_id="203",
        language="TypeScript",
        default_ref="main",
        tree=[
            ("src/core", ["buffers", "pipelines"], "ts"),
            ("src/render", ["passes", "shaders"], "ts"),
            ("src/tools", [], "ts"),
            ("examples", ["basic", "advanced"], "ts"),
            ("docs", [], "md"),
        ],
        dates=["2026-05-25T10:00:00Z", "2026-06-08T13:00:00Z", "2026-06-18T08:00:00Z"],
        total=110,
    )
    return [storefront, telemetry, forge]
