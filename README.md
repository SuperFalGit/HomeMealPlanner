# HomeMealPlanner

Use Claude to cut down the time spent on the weekly meal plan and shopping list.

## What's here
| Path | What it is |
|---|---|
| `data/recipes.json` | All 26 recipes in structured form — the app's data source |
| `recipes/` | Readable Markdown copy of each recipe |
| `data/history.json` | Meals already used (so they aren't picked again) |
| `docs/weekly-planner-paper.jpg` | The paper fridge planner the printed plan mirrors |
| `CLAUDE.md` | The build brief Claude Code reads automatically |

## Building the app with Claude Code (VS Code)
1. Clone this repo and open the folder in VS Code.
2. Open Claude Code and say: **"Build the app described in CLAUDE.md."**
3. Run it locally: `python -m http.server 8000` then open http://localhost:8000

## Recipe pool
- **Chefs:** Gino D'Acampo, Hairy Bikers, Jamie Oliver, Nigella Lawson, Yinka, Navi, Iain
- **Type2:** 5 recipes with Eat/Limit guidance

Several recipes only have ingredient lists (no method). A few lines are marked `CHECK:`
where the original text was unclear — worth a quick look.
