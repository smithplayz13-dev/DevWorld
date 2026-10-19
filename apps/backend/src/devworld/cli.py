"""DevWorld CLI: ``seed-demo`` and ``export-openapi`` (WORKFLOW.md M0)."""

from __future__ import annotations

import argparse
import json
import sys


def cmd_seed_demo(_args: argparse.Namespace) -> int:
    from .history import WorldHistory
    from .layout import build_layout

    history = WorldHistory()
    layout = build_layout(history)
    total_files = sum(
        len([v for v in members.values() if v["kind"] == "file"])
        for members in history.membership.values()
    )
    print(
        f"seeded demo world: {len(history.repos)} countries, "
        f"{total_files} file versions, layout epoch 1"
    )
    for key, rec in layout.items():
        print(f"  {history.repos[key]['name']}: slot={rec['slot']} weight={rec['weight']:.2f}")
    return 0


def cmd_export_openapi(args: argparse.Namespace) -> int:
    from .api.main import create_app

    schema = create_app().openapi()
    args.output.write_text(json.dumps(schema, indent=2) + "\n")
    print(f"wrote {args.output}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="devworld")
    sub = parser.add_subparsers(dest="command", required=True)
    seed = sub.add_parser("seed-demo", help="Print the synthetic demo world summary.")
    seed.set_defaults(func=cmd_seed_demo)
    export = sub.add_parser("export-openapi", help="Export the OpenAPI schema.")
    export.add_argument(
        "--output",
        type=__import__("pathlib").Path,
        default=__import__("pathlib").Path("packages/contracts/openapi.json"),
    )
    export.set_defaults(func=cmd_export_openapi)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
