#!/usr/bin/env python3
"""Convert plain-text recipe files into recipes.json entries.

Same rules as the drag-and-drop importer in the app (js/planner.js parseRecipeText):
  * name the file "Chef - Recipe Title.txt" (or "Ginos Recipe Title.txt" for a known chef)
  * ingredients first, one per line; "For the sauce:" style lines start a sub-section
  * then an optional numbered method ("1. ...", "2) ...", "Step 3: ...")
  * optional "Serves 4", "Prep 10 mins", "Cook 25 mins", "Eat: ..." and "Limit: ..." lines

Usage:
  python scripts/add_recipe.py "Jamie - Miso Salmon.txt"            # print the JSON entry
  python scripts/add_recipe.py *.txt --write                          # add to data/recipes.json + regenerate recipes/*.md
  python scripts/add_recipe.py file.txt --chef "Jamie Oliver" --write
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "recipes.json"

SECTION_RE = re.compile(r"^((?:Sauce|Salad|Mash|Infused milk|To finish|To serve|Dressing|Marinade|Topping|Glaze|Filling|For the [a-z ]+)|[A-Z][a-z]+(?: [a-z]+){0,2}):\s+(.+)$")
STEP_RE = re.compile(r"^(?:step\s*)?(\d{1,2})\s*[.):]\s*(.*)$", re.I)
STEP_WORD_RE = re.compile(r"^step\s+(\d{1,2})\s*[-:.]?\s*(.*)$", re.I)
CONTINUES_RE = re.compile(r"([,(\-–]|\b(and|or|of|with|into|in|to|for|the|a|cut|finely|roughly|thinly|thin|thick|small|large|plus|about))$", re.I)

PROTEIN_RULES = [
    ("chicken", r"\bchicken\b(?!\s+(stock|broth|gravy|bouillon))"),
    ("turkey", r"\bturkey\b"),
    ("beef", r"\b(beef|steak|brisket)\b(?!\s+(stock|broth))"),
    ("pork", r"\b(pork|bacon|pancetta|chorizo|gammon)\b(?!\s+(stock|broth))"),
    ("lamb", r"\blamb\b(?!\s+(stock|broth))"),
    ("sausage", r"\bsausages?\b"),
    ("fish", r"\b(salmon|cod|haddock|tuna|sea bass|bass|mackerel|trout|hake|pollock|plaice|sardines?|white fish|fish fillets?)\b"),
    ("seafood", r"\b(prawns?|shrimps?|lobster|mussels?|squid|scallops?|crab|clams?|calamari)\b"),
]
MEAT = {"chicken", "turkey", "beef", "pork", "lamb", "sausage", "fish", "seafood"}


def slugify(s: str) -> str:
    s = re.sub(r"['’]", "", s.lower()).replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def title_case(s: str) -> str:
    small = {"and", "or", "with", "of", "the", "in", "on", "a", "n"}
    words = [w.lower() if w.lower() in small else w[:1].upper() + w[1:] for w in s.split()]
    out = " ".join(words)
    return out[:1].upper() + out[1:]


def name_from_filename(filename: str, known_chefs: list[str]) -> tuple[str, str]:
    base = re.sub(r"\s+", " ", Path(filename).stem.replace("_", " ")).strip()
    chef, title = "", base
    parts = re.split(r"\s+-\s+", base)
    if len(parts) >= 2:
        chef, title = parts[0].strip(), " - ".join(parts[1:]).strip()
    chef_part = chef or base
    for known in known_chefs + ["Type2"]:
        for form in (known, known.split(" ")[0]):
            stem = re.escape(form[:-1] if form.endswith("s") else form)
            m = re.match(stem + r"s?'?s?\b\s*", chef_part, re.I)
            if m:
                if not chef:
                    title = base[m.end():].strip() or base
                chef = known
                break
        else:
            continue
        break
    chef = re.sub(r"'s$|s'$", "", chef)
    return chef, title_case(title)


def parse(text: str, filename: str, known_chefs: list[str], existing_ids: set[str], default_chef: str = "Iain") -> tuple[dict, list[str]]:
    warnings: list[str] = []
    chef, title = name_from_filename(filename, known_chefs)
    ingredients: list[str] = []
    method: list[str] = []
    mode, section = "ingredients", None
    meta: dict = {}
    lines = text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", " ").split("\n")
    before_header = any(re.match(r"^\s*ingredients\s*:?\s*$", l, re.I) for l in lines)
    title_from_text = ""

    for raw in lines:
        line = re.sub(r"\s+", " ", re.sub(r"^[-*•▪●]\s+", "", raw.strip()))
        if not line:
            continue
        if m := re.match(r"^serves\s*:?\s*(\d+)", line, re.I):
            meta["serves"] = int(m[1]); continue
        if m := re.match(r"^prep(?:aration)?(?:\s*time)?\s*:?\s*(\d+)\s*min", line, re.I):
            meta["prepMins"] = int(m[1]); continue
        if m := re.match(r"^cook(?:ing)?(?:\s*time)?\s*:?\s*(\d+)\s*min", line, re.I):
            meta["cookMins"] = int(m[1]); continue
        if m := re.match(r"^eat\s*:\s*(.+)$", line, re.I):
            meta["eat"] = m[1]; continue
        if m := re.match(r"^limit\s*:\s*(.+)$", line, re.I):
            meta["limit"] = m[1]; continue
        if re.match(r"^ingredients\s*:?$", line, re.I):
            before_header, mode = False, "ingredients"; continue
        if re.match(r"^(method|instructions|directions|steps|how to make( it)?)\s*:?$", line, re.I):
            before_header, mode = False, "method"; continue
        if before_header:
            title_from_text = title_from_text or line.rstrip(":"); continue
        if m := (STEP_RE.match(line) or STEP_WORD_RE.match(line)):
            mode = "method"
            method.append(m[2] or "")
            continue
        if mode == "method":
            if method and (method[-1] == "" or re.match(r"^[a-z]", line)):
                method[-1] = (method[-1] + " " + line).strip()
            elif method and not re.search(r"[.!?)]$", method[-1]):
                method[-1] += " " + line
            else:
                method.append(line)
            continue
        if (m := re.match(r"^(?:for the\s+)?([A-Za-z][A-Za-z ]{1,24}):$", line, re.I)) and not re.search(r"\d", line):
            section = m[1].strip().capitalize()
            continue
        if ingredients and re.match(r"^[a-z(]", line) and CONTINUES_RE.search(ingredients[-1]):
            ingredients[-1] += " " + line
            continue
        ingredients.append(f"{section}: {line}" if section and not SECTION_RE.match(line) else line)

    if not title and title_from_text:
        title = title_case(title_from_text)
    if not chef:
        warnings.append("Couldn't tell the chef from the filename - using %r (override with --chef)." % default_chef)
    chef = chef or default_chef
    type2 = chef == "Type2" or bool(meta.get("eat") or meta.get("limit"))
    if type2:
        chef = "Type2"
    if not ingredients:
        warnings.append("No ingredients found.")
    if not method:
        warnings.append("No numbered method found - saved with ingredients only.")

    text_all = title + "\n" + "\n".join(ingredients)
    protein = [p for p, rx in PROTEIN_RULES if re.search(rx, text_all, re.I)]
    if not protein:
        if re.search(r"\b(omelette|frittata|eggs?)\b", title, re.I):
            protein = ["egg"]
        elif re.search(r"\b(halloumi|cheese|paneer|feta)\b", title, re.I):
            protein = ["cheese"]
        elif re.search(r"\btofu\b", title, re.I):
            protein = ["tofu"]
    tags = []
    if not MEAT.intersection(protein):
        tags.append("vegetarian")
    for tag, rx, src in [
        ("pasta", r"\b(pasta|spaghetti|penne|macaroni|linguine|tagliatelle|fusilli|rigatoni|lasagne|orzo)\b", text_all),
        ("rice", r"\brice\b", text_all),
        ("curry", r"\bcurry\b", title),
        ("soup", r"\bsoup\b", title),
        ("stir-fry", r"\bstir[- ]?fry\b", title),
        ("tray-bake", r"\btray ?bake\b", title),
        ("air-fryer", r"\bair[- ]?fry", text_all),
    ]:
        if re.search(rx, src, re.I):
            tags.append(tag)
    if {"fish", "seafood"} & set(protein):
        tags.append("fish-seafood")

    base_id = slugify(("type2" if type2 else chef.split(" ")[0]) + " " + title)
    rid, n = base_id, 2
    while rid in existing_ids:
        rid, n = f"{base_id}-{n}", n + 1

    recipe = {"id": rid, "title": title, "chef": chef, "collection": "Type2" if type2 else "Chefs",
              "type2": type2, "protein": protein, "tags": tags}
    for k in ("serves", "prepMins", "cookMins"):
        if meta.get(k):
            recipe[k] = meta[k]
    recipe["ingredients"] = ingredients
    recipe["method"] = [s for s in method if s]
    if type2:
        recipe["eat"] = meta.get("eat", "")
        recipe["limit"] = meta.get("limit", "")
    recipe["sourceFile"] = Path(filename).name
    return recipe, warnings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", help=".txt recipe files")
    ap.add_argument("--chef", help="chef name to use (overrides the filename)")
    ap.add_argument("--write", action="store_true", help="append to data/recipes.json and regenerate recipes/*.md")
    args = ap.parse_args()

    data = json.loads(DATA.read_text(encoding="utf-8"))
    known_chefs = sorted({r["chef"] for r in data["recipes"] if not r.get("type2")})
    ids = {r["id"] for r in data["recipes"]}
    new = []
    for f in args.files:
        path = Path(f)
        recipe, warnings = parse(path.read_text(encoding="utf-8-sig"), path.name, known_chefs, ids)
        if args.chef:
            recipe["chef"] = args.chef
        ids.add(recipe["id"])
        new.append(recipe)
        for w in warnings:
            print(f"  ! {path.name}: {w}", file=sys.stderr)

    if not args.write:
        print(json.dumps(new if len(new) > 1 else new[0], indent=2, ensure_ascii=False))
        print("\n(dry run - add --write to save to data/recipes.json)", file=sys.stderr)
        return 0

    data["recipes"].extend(new)
    DATA.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"Added {len(new)} recipe(s): " + ", ".join(r["id"] for r in new))
    sys.path.insert(0, str(Path(__file__).parent))
    import build_recipe_md
    build_recipe_md.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
