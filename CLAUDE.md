# HomeMealPlanner — brief for Claude Code

## What this is
A small web app that builds Iain's weekly meal plan and shopping list. It asks a few
setup questions, picks meals at random from the recipe pool, then prints recipe /
ingredient cards and a combined shopping list for the weekly shop.

## The data (already in this repo)
- `data/recipes.json` — **source of truth**. 26 recipes. Each has `id`, `title`, `chef`,
  `collection` ("Chefs" or "Type2"), `type2` flag, `protein[]`, `tags[]`, optional
  `serves`/`prepMins`/`cookMins`, `ingredients[]` (strings), `method[]` (may be empty),
  and for Type2 recipes `eat`/`limit` guidance.
  - Ingredient lines prefixed `Sauce:`, `Salad:`, `Mash:`, `Infused milk:`, `To finish:`,
    `To serve:` belong to a sub-section — render the prefix as a sub-heading.
  - Lines containing `CHECK:` are uncertain transcriptions — show them as-is, don't "fix".
- `recipes/*.md` — human-readable copy of each recipe, generated from the JSON. If you
  change the JSON, regenerate these (write a small script in `scripts/` for it).
- `data/history.json` — ids of meals already used in past weeks.
- `docs/weekly-planner-paper.jpg` — the paper Mon–Sun planner with a Notes column that
  sits on the fridge. The on-screen/printed plan should mirror that layout.

## Tech constraints
- Plain **HTML + CSS + vanilla JS**, no build step, no framework, no backend.
  It must run by opening `index.html` via a simple local server
  (`python -m http.server`) and also work if published to GitHub Pages.
- Load recipes with `fetch('data/recipes.json')`.
- Persist state (used-meal history, last plan) in `localStorage`, seeded from
  `data/history.json` on first run. Provide **Export history** / **Import history**
  buttons (JSON download/upload) so history can be committed back to the repo.
- UK English, metric units.

## User flow
1. **Setup questions** (one screen, sensible defaults remembered from last time):
   - How many meals this week? (3–7, default 5)
   - Which days? (Mon–Sun checkboxes; number of ticked days = number of meals)
   - Which recipe pool? (All / Chefs only / Type2 only / mix with N Type2 meals)
   - Chefs to include (checkbox per chef found in the data)
   - Must-haves, e.g. "at least 1 chicken dish", "at least 1 fish/seafood"
     (driven by `protein` values)
   - Exclusions: vegetarian-only, no seafood, no pasta, etc. (driven by `protein`/`tags`)
   - Avoid recently used meals? (yes by default — excludes ids in history)
   - Servings for the household (used to flag recipes whose `serves` differs)
2. **Generate**: random pick that satisfies the constraints, no duplicates, no protein
   repeated on consecutive days where avoidable. If the pool can't satisfy the request,
   say exactly why (e.g. "only 2 unused chicken dishes left") and offer to include used
   meals or reset history — never silently relax a rule.
3. **Review**: show the week as day cards. Each card has **Swap** (re-roll just that day),
   **Lock**, and a dropdown to pick a specific recipe. "Re-roll unlocked" button.
4. **Confirm**: marks the chosen meals as used in history.
5. **Outputs** (print-friendly CSS, `@media print`, A4):
   - Weekly plan page in the paper-planner layout (Mon–Sun + Notes column).
   - One recipe card per meal: title, chef, ingredients (with sub-sections), method if
     present, Eat/Limit box for Type2 recipes.
   - Combined **shopping list**: all ingredients from the week, grouped by recipe
     (simple and reliable) with a checkbox per line, plus a free-text "extras" box.
     Optional nice-to-have: merge obvious duplicates (e.g. "garlic cloves") — keep it
     conservative; don't invent quantities.

## Design
Clean, friendly, mobile-friendly (it'll be used on a phone in the supermarket).
Soft pastel palette nodding to the paper planner (light blue background, white cards,
fruit-coloured accents). Big tap targets on the shopping list.

## Adding recipes later
Recipes are added by editing `data/recipes.json`. Add a simple `scripts/add_recipe.py`
(or a form in the app that outputs a JSON snippet to paste) so a new `.txt` recipe
(ingredients first, then optional numbered method) can be converted into a JSON entry.

## Definition of done
- `index.html`, `css/`, `js/` in repo root; opens with no console errors.
- All setup options work and are covered by a tiny test page or `node` test script for
  the selection logic (`js/planner.js` should be pure functions, separate from the UI).
- Print preview of plan, cards and shopping list looks right on A4.
- README updated with how to run it.
