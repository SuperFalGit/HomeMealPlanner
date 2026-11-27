#!/usr/bin/env python3
"""Regenerate recipes/*.md from data/recipes.json (the source of truth).

Usage:  python scripts/build_recipe_md.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "recipes.json"
OUT = ROOT / "recipes"


def render(r: dict) -> str:
    lines = [f"# {r['title']}", "", f"**Chef:** {r['chef']}  "]

    timing = []
    if r.get("serves"):
        timing.append(f"Serves {r['serves']}")
    if r.get("prepMins"):
        timing.append(f"Prep {r['prepMins']} mins")
    if r.get("cookMins"):
        timing.append(f"Cook {r['cookMins']} mins")
    if timing:
        lines.append(f"**{' | '.join(timing)}**  ")

    tags = list(r.get("protein", [])) + list(r.get("tags", []))
    if r.get("type2"):
        tags.append("type2")
    tags = list(dict.fromkeys(tags))
    if tags:
        lines.append(f"**Tags:** {', '.join(tags)}")
    else:
        lines[-1] = lines[-1].rstrip()

    lines += ["", "## Ingredients", ""]
    lines += [f"- {i}" for i in r.get("ingredients", [])]

    method = r.get("method") or []
    if method:
        lines += ["", "## Method", ""]
        lines += [f"{n}. {step}" for n, step in enumerate(method, 1)]

    if r.get("eat") or r.get("limit"):
        lines.append("")
        if r.get("eat"):
            lines.append(f"**Eat:** {r['eat']}" + ("  " if r.get("limit") else ""))
        if r.get("limit"):
            lines.append(f"**Limit:** {r['limit']}")

    if r.get("notes"):
        lines += ["", f"> {r['notes']}"]

    return "\n".join(lines) + "\n"


def main() -> None:
    recipes = json.loads(DATA.read_text(encoding="utf-8"))["recipes"]
    OUT.mkdir(exist_ok=True)
    changed = 0
    for r in recipes:
        path = OUT / f"{r['id']}.md"
        text = render(r)
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8", newline="\n")
            changed += 1
    print(f"{len(recipes)} recipes, {changed} markdown file(s) written to {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
