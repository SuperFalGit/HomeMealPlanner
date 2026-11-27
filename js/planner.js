/*
 * HomeMealPlanner - selection logic.
 * Pure functions only (no DOM, no storage) so they can be unit-tested.
 * Works as a browser global (window.Planner) or a CommonJS module.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  var ESSENTIALS = [
    'Sugar', 'Milk', 'Eggs', 'Toilet Paper', 'Bleach',
    'Toothpaste', 'Tea Bags', 'Coffee', 'Protein Bars', 'Bin Bags'
  ];

  var DEFAULT_OPTIONS = {
    days: [0, 1, 2, 3, 4],
    pool: 'all',            // 'all' | 'chefs' | 'type2' | 'mix'
    mixType2: 2,            // number of Type2 meals when pool === 'mix'
    chefs: null,            // null = every chef; otherwise array of chef names
    mustHaves: {},          // { category: minimumCount }
    vegetarianOnly: false,
    exclude: ['side-dish'], // categories or tags to leave out
    avoidRecent: true,
    servings: 2
  };

  var LABELS = {
    'fish-seafood': 'fish/seafood',
    'side-dish': 'side dishes',
    '5-ingredient': '5-ingredient',
    'air-fryer': 'air fryer',
    'stir-fry': 'stir-fry',
    'one-pot': 'one-pot',
    'tray-bake': 'tray bake'
  };

  function label(key) { return LABELS[key] || key; }

  function plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }

  function dishWord(cat) {
    // "chicken dish", "fish/seafood dish", "vegetarian dish"
    return label(cat) + ' ' + 'dish';
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  /** Categories a recipe belongs to: its proteins, plus fish-seafood and vegetarian groupings. */
  function categoriesOf(recipe) {
    var cats = {};
    (recipe.protein || []).forEach(function (p) { cats[p] = true; });
    if (cats.fish || cats.seafood) cats['fish-seafood'] = true;
    if ((recipe.tags || []).indexOf('vegetarian') !== -1) cats.vegetarian = true;
    return Object.keys(cats);
  }

  function hasCategory(recipe, cat) { return categoriesOf(recipe).indexOf(cat) !== -1; }

  /** Everything a recipe can be excluded by: categories plus tags. */
  function keysOf(recipe) {
    var keys = categoriesOf(recipe).concat(recipe.tags || []);
    return keys.filter(function (k, i) { return keys.indexOf(k) === i; });
  }

  /** Distinct categories across recipes (for must-have pickers). Ordered by usefulness. */
  function allCategories(recipes) {
    var seen = {};
    recipes.forEach(function (r) { categoriesOf(r).forEach(function (c) { seen[c] = true; }); });
    var preferred = ['chicken', 'fish-seafood', 'vegetarian', 'fish', 'seafood'];
    var rest = Object.keys(seen).filter(function (c) { return preferred.indexOf(c) === -1; }).sort();
    return preferred.filter(function (c) { return seen[c]; }).concat(rest);
  }

  /** Distinct tags across recipes (for exclusion pickers), minus ones covered by categories. */
  function allTags(recipes) {
    var seen = {};
    recipes.forEach(function (r) { (r.tags || []).forEach(function (t) { seen[t] = true; }); });
    delete seen.vegetarian;
    delete seen['fish-seafood'];
    return Object.keys(seen).sort();
  }

  function allChefs(recipes) {
    var seen = {};
    recipes.forEach(function (r) { if (!r.type2 && r.collection !== 'Type2') seen[r.chef] = true; });
    return Object.keys(seen).sort();
  }

  function isType2(r) { return !!(r.type2 || r.collection === 'Type2'); }

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  function normaliseOptions(opts) {
    var o = {};
    Object.keys(DEFAULT_OPTIONS).forEach(function (k) { o[k] = DEFAULT_OPTIONS[k]; });
    Object.keys(opts || {}).forEach(function (k) { if (opts[k] !== undefined) o[k] = opts[k]; });
    o.days = (o.days || []).slice().sort(function (a, b) { return a - b; });
    o.mustHaves = o.mustHaves || {};
    o.exclude = o.exclude || [];
    return o;
  }

  /** Does the recipe pass the pool / chef / exclusion filters? (History is handled separately.) */
  function isEligible(recipe, opts) {
    var t2 = isType2(recipe);
    if (opts.pool === 'chefs' && t2) return false;
    if (opts.pool === 'type2' && !t2) return false;
    if (!t2 && opts.pool !== 'type2' && Array.isArray(opts.chefs) && opts.chefs.indexOf(recipe.chef) === -1) return false;
    if (opts.vegetarianOnly && !hasCategory(recipe, 'vegetarian')) return false;
    var keys = keysOf(recipe);
    for (var i = 0; i < opts.exclude.length; i++) {
      if (keys.indexOf(opts.exclude[i]) !== -1) return false;
    }
    return true;
  }

  function eligibleRecipes(recipes, opts) {
    opts = normaliseOptions(opts);
    return recipes.filter(function (r) { return isEligible(r, opts); });
  }

  // ---------------------------------------------------------------------------
  // Randomness
  // ---------------------------------------------------------------------------

  /** Small seeded PRNG (mulberry32) so tests are repeatable. */
  function seededRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // ---------------------------------------------------------------------------
  // Plan generation
  // ---------------------------------------------------------------------------

  function sharesProtein(a, b) {
    if (!a || !b) return false;
    var pa = a.protein || [], pb = b.protein || [];
    for (var i = 0; i < pa.length; i++) if (pb.indexOf(pa[i]) !== -1) return true;
    return false;
  }

  /** Number of calendar-consecutive days (e.g. Mon then Tue) that repeat a protein. */
  function countClashes(assignment, byId) {
    var n = 0;
    for (var d = 0; d < 6; d++) {
      if (assignment[d] && assignment[d + 1] && sharesProtein(byId[assignment[d]], byId[assignment[d + 1]])) n++;
    }
    return n;
  }

  /**
   * Explain why the request can't be met (empty array = no obvious blocker).
   * `free` = recipes available for the open slots; `fixed` = locked recipes.
   */
  function diagnose(opts, free, fixed, slots, usedMatching) {
    var problems = [];
    var unused = opts.avoidRecent ? 'unused ' : '';
    var usedNote = function (n) {
      return (opts.avoidRecent && n > 0) ? ' (' + n + ' more ' + plural(n, 'was', 'were') + ' used recently)' : '';
    };

    if (free.length < slots) {
      problems.push('Only ' + free.length + ' ' + unused + plural(free.length, 'recipe') +
        ' match your choices, but you asked for ' + slots + ' more ' + plural(slots, 'meal') + '.' +
        usedNote(usedMatching.length));
    }

    if (opts.pool === 'mix') {
      var t2Fixed = fixed.filter(isType2).length;
      var chefFixed = fixed.length - t2Fixed;
      var total = opts.days.length;
      var wantT2 = opts.mixType2;
      if (wantT2 > total) {
        problems.push('You asked for ' + wantT2 + ' Type2 meals but only ' + total + ' ' + plural(total, 'day is', 'days are') + ' ticked.');
      } else {
        var needT2 = wantT2 - t2Fixed, needChef = (total - wantT2) - chefFixed;
        if (needT2 < 0) problems.push('Your locked meals already include ' + t2Fixed + ' Type2 meals, more than the ' + wantT2 + ' you asked for.');
        if (needChef < 0) problems.push('Your locked meals already include ' + chefFixed + ' chef meals, more than the ' + (total - wantT2) + ' the mix allows.');
        var t2Avail = free.filter(isType2).length;
        var chefAvail = free.length - t2Avail;
        if (needT2 > t2Avail) problems.push('Only ' + t2Avail + ' ' + unused + 'Type2 ' + plural(t2Avail, 'recipe') + ' left, but the mix needs ' + needT2 + '.' + usedNote(usedMatching.filter(isType2).length));
        if (needChef > chefAvail) problems.push('Only ' + chefAvail + ' ' + unused + 'chef ' + plural(chefAvail, 'recipe') + ' left, but the mix needs ' + needChef + '.' + usedNote(usedMatching.filter(function (r) { return !isType2(r); }).length));
      }
    }

    Object.keys(opts.mustHaves).forEach(function (cat) {
      var min = opts.mustHaves[cat] || 0;
      if (min <= 0) return;
      var have = fixed.filter(function (r) { return hasCategory(r, cat); }).length;
      var need = min - have;
      if (need <= 0) return;
      var avail = free.filter(function (r) { return hasCategory(r, cat); }).length;
      if (avail < need) {
        problems.push('Only ' + avail + ' ' + unused + dishWord(cat) + (avail === 1 ? '' : 'es') +
          ' left - you asked for at least ' + min + '.' +
          usedNote(usedMatching.filter(function (r) { return hasCategory(r, cat); }).length));
      }
    });

    var totalMin = Object.keys(opts.mustHaves).reduce(function (s, k) { return s + (opts.mustHaves[k] || 0); }, 0);
    if (totalMin > opts.days.length) {
      var overlap = free.concat(fixed).some(function (r) {
        return Object.keys(opts.mustHaves).filter(function (c) { return opts.mustHaves[c] > 0 && hasCategory(r, c); }).length > 1;
      });
      if (!overlap) problems.push('Your must-haves add up to ' + totalMin + ' meals but only ' + opts.days.length + ' ' + plural(opts.days.length, 'day is', 'days are') + ' ticked.');
    }
    return problems;
  }

  /**
   * Pick recipes for the ticked days.
   * @param {Array} recipes all recipes
   * @param {Object} options see DEFAULT_OPTIONS
   * @param {Object} ctx { history: [ids], locked: {dayIndex: id}, excludeIds: [ids], rng }
   * @returns {{ok:true, assignment:Object, clashes:number} | {ok:false, problems:string[], fixableByUsed:boolean}}
   */
  function generatePlan(recipes, options, ctx) {
    ctx = ctx || {};
    var opts = normaliseOptions(options);
    var rng = ctx.rng || Math.random;
    var history = ctx.history || [];
    var locked = ctx.locked || {};
    var excludeIds = ctx.excludeIds || [];
    var byId = {};
    recipes.forEach(function (r) { byId[r.id] = r; });

    if (!opts.days.length) return { ok: false, problems: ['Tick at least one day.'], fixableByUsed: false };

    var lockedDays = opts.days.filter(function (d) { return locked[d] && byId[locked[d]]; });
    var fixed = lockedDays.map(function (d) { return byId[locked[d]]; });
    var fixedIds = fixed.map(function (r) { return r.id; });
    var openDays = opts.days.filter(function (d) { return lockedDays.indexOf(d) === -1; });

    var matching = recipes.filter(function (r) {
      return isEligible(r, opts) && fixedIds.indexOf(r.id) === -1 && excludeIds.indexOf(r.id) === -1;
    });
    var free = matching.filter(function (r) { return !opts.avoidRecent || history.indexOf(r.id) === -1; });
    var usedMatching = matching.filter(function (r) { return free.indexOf(r) === -1; });

    var assignmentBase = {};
    lockedDays.forEach(function (d) { assignmentBase[d] = locked[d]; });

    var problems = diagnose(opts, free, fixed, openDays.length, usedMatching);
    if (problems.length) return fail(problems);

    var total = opts.days.length;
    var t2Target = opts.pool === 'mix' ? opts.mixType2 : null;
    var cats = Object.keys(opts.mustHaves).filter(function (c) { return opts.mustHaves[c] > 0; });

    function quotaOk(chosen, r) {
      if (t2Target === null) return true;
      var t2 = chosen.filter(isType2).length;
      return isType2(r) ? t2 < t2Target : (chosen.length - t2) < (total - t2Target);
    }
    function satisfied(chosen) {
      if (chosen.length !== total) return false;
      if (t2Target !== null && chosen.filter(isType2).length !== t2Target) return false;
      return cats.every(function (c) {
        return chosen.filter(function (r) { return hasCategory(r, c); }).length >= opts.mustHaves[c];
      });
    }

    var best = null;
    for (var attempt = 0; attempt < 300; attempt++) {
      var chosen = fixed.slice();
      var pool = shuffle(free, rng);
      var dead = false;
      var catOrder = shuffle(cats, rng);
      for (var ci = 0; ci < catOrder.length && !dead; ci++) {
        var cat = catOrder[ci];
        while (chosen.filter(function (r) { return hasCategory(r, cat); }).length < opts.mustHaves[cat]) {
          var pick = null;
          for (var pi = 0; pi < pool.length; pi++) {
            if (chosen.indexOf(pool[pi]) === -1 && hasCategory(pool[pi], cat) && quotaOk(chosen, pool[pi])) { pick = pool[pi]; break; }
          }
          if (!pick || chosen.length >= total) { dead = true; break; }
          chosen.push(pick);
        }
      }
      if (dead) continue;
      for (var fi = 0; fi < pool.length && chosen.length < total; fi++) {
        if (chosen.indexOf(pool[fi]) === -1 && quotaOk(chosen, pool[fi])) chosen.push(pool[fi]);
      }
      if (!satisfied(chosen)) continue;

      // Arrange the newly chosen recipes across the open days, avoiding protein repeats on consecutive days.
      var newOnes = chosen.slice(fixed.length);
      for (var arr = 0; arr < 40; arr++) {
        var order = arr === 0 ? newOnes : shuffle(newOnes, rng);
        var assignment = {};
        Object.keys(assignmentBase).forEach(function (k) { assignment[k] = assignmentBase[k]; });
        openDays.forEach(function (d, i) { assignment[d] = order[i].id; });
        var clashes = countClashes(assignment, byId);
        if (!best || clashes < best.clashes) best = { ok: true, assignment: assignment, clashes: clashes };
        if (clashes === 0) return best;
      }
    }
    if (best) return best;

    return fail(['Couldn\'t find a combination that meets all your must-haves together with your other choices. Try lowering a must-have or widening the recipe pool.']);

    function fail(probs) {
      var fixable = false;
      if (opts.avoidRecent && usedMatching.length) {
        var relaxed = {};
        Object.keys(opts).forEach(function (k) { relaxed[k] = opts[k]; });
        relaxed.avoidRecent = false;
        fixable = generatePlan(recipes, relaxed, { locked: locked, excludeIds: excludeIds, rng: seededRng(1) }).ok;
      }
      return { ok: false, problems: probs, fixableByUsed: fixable };
    }
  }

  /** Re-roll a single day, keeping every other day as it is. */
  function swapDay(recipes, options, assignment, day, ctx) {
    ctx = ctx || {};
    var locked = {};
    Object.keys(assignment).forEach(function (d) {
      if (Number(d) !== day && assignment[d]) locked[d] = assignment[d];
    });
    var opts = normaliseOptions(options);
    // Make sure every day in the assignment counts, even if settings changed since.
    var days = Object.keys(assignment).map(Number);
    if (days.indexOf(day) === -1) days.push(day);
    opts.days = days;
    var exclude = (ctx.excludeIds || []).slice();
    if (assignment[day]) exclude.push(assignment[day]);
    // Locked meals may have been hand-picked outside the current filters; don't let quotas count against them.
    return generatePlan(recipes, opts, { history: ctx.history, locked: locked, excludeIds: exclude, rng: ctx.rng });
  }

  // ---------------------------------------------------------------------------
  // Ingredients
  // ---------------------------------------------------------------------------

  var SECTION_RE = /^((?:Sauce|Salad|Mash|Infused milk|To finish|To serve|Dressing|Marinade|Topping|Glaze|Filling|For the [a-z ]+)|[A-Z][a-z]+(?: [a-z]+){0,2}):\s+(.+)$/;

  /** Split "Sauce: 2 tbsp soy" into { section: 'Sauce', text: '2 tbsp soy' }. CHECK notes are never treated as sections. */
  function splitSection(line) {
    var m = SECTION_RE.exec(line);
    if (!m || m[1] === 'CHECK') return { section: null, text: line };
    return { section: m[1], text: m[2] };
  }

  /** Group ingredient lines into [{section, items:[{text, index}]}], preserving order. */
  function groupIngredients(lines) {
    var groups = [];
    var byName = {};
    (lines || []).forEach(function (line, index) {
      var s = splitSection(line);
      var key = s.section || '';
      if (!byName.hasOwnProperty(key)) {
        byName[key] = { section: s.section, items: [] };
        groups.push(byName[key]);
      }
      byName[key].items.push({ text: s.text, index: index });
    });
    // Main (un-prefixed) ingredients first.
    groups.sort(function (a, b) { return (a.section ? 1 : 0) - (b.section ? 1 : 0); });
    return groups;
  }

  /** Note when a recipe's stated servings differ from the household. */
  function servingsNote(recipe, servings) {
    if (!recipe.serves || !servings || recipe.serves === servings) return null;
    return 'Serves ' + recipe.serves + ' - you\'re cooking for ' + servings;
  }

  /** Shopping list grouped by meal, in day order. */
  function buildShoppingList(assignment, byId) {
    return Object.keys(assignment).map(Number).sort(function (a, b) { return a - b; })
      .filter(function (d) { return byId[assignment[d]]; })
      .map(function (d) {
        var r = byId[assignment[d]];
        return { day: d, recipe: r, groups: groupIngredients(r.ingredients) };
      });
  }

  // ---------------------------------------------------------------------------
  // Importing recipes from .txt
  // ---------------------------------------------------------------------------

  function slugify(s) {
    return String(s).toLowerCase()
      .replace(/['\u2019]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function titleCase(s) {
    return s.replace(/\w\S*/g, function (w) {
      return /^(and|or|with|of|the|in|on|a|n)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1);
    }).replace(/^./, function (c) { return c.toUpperCase(); });
  }

  /** Work out chef + title from a filename like "Type2 - Lentil Soup.txt" or "Ginos Pizza Chicken.txt". */
  function nameFromFilename(filename, knownChefs) {
    var base = String(filename || '').replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    var chef = '', title = base;
    var dash = base.split(/\s+-\s+/);
    if (dash.length >= 2) { chef = dash[0].trim(); title = dash.slice(1).join(' - ').trim(); }
    var candidates = (knownChefs || []).concat(['Type2']);
    var chefPart = chef || base;
    for (var i = 0; i < candidates.length; i++) {
      var known = candidates[i];
      var first = known.split(' ')[0];
      var forms = [known, first].map(function (f) {
        return new RegExp('^' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s$/, '') + "s?'?s?\\b\\s*", 'i');
      });
      for (var j = 0; j < forms.length; j++) {
        var m = forms[j].exec(chefPart);
        if (m) {
          if (!chef) title = base.slice(m[0].length).trim() || base;
          chef = known;
          i = candidates.length;
          break;
        }
      }
    }
    if (chef) chef = chef.replace(/'s$|s'$/, '');
    return { chef: chef, title: titleCase(title) };
  }

  var PROTEIN_RULES = [
    ['chicken', /\bchicken\b(?!\s+(stock|broth|gravy|bouillon))/i],
    ['turkey', /\bturkey\b/i],
    ['beef', /\b(beef|steak|brisket)\b(?!\s+(stock|broth))/i],
    ['pork', /\b(pork|bacon|pancetta|chorizo|gammon)\b(?!\s+(stock|broth))/i],
    ['lamb', /\blamb\b(?!\s+(stock|broth))/i],
    ['sausage', /\bsausages?\b/i],
    ['fish', /\b(salmon|cod|haddock|tuna|sea bass|bass|mackerel|trout|hake|pollock|plaice|sardines?|white fish|fish fillets?)\b/i],
    ['seafood', /\b(prawns?|shrimps?|lobster|mussels?|squid|scallops?|crab|clams?|calamari)\b/i]
  ];

  function inferProteins(title, ingredients) {
    var text = title + '\n' + ingredients.join('\n');
    var found = PROTEIN_RULES.filter(function (rule) { return rule[1].test(text); }).map(function (rule) { return rule[0]; });
    if (!found.length) {
      if (/\b(omelette|frittata|eggs?)\b/i.test(title)) found.push('egg');
      else if (/\b(halloumi|cheese|paneer|feta)\b/i.test(title)) found.push('cheese');
      else if (/\btofu\b/i.test(title)) found.push('tofu');
    }
    return found;
  }

  function inferTags(title, ingredients, proteins) {
    var text = title + '\n' + ingredients.join('\n');
    var tags = [];
    var meat = proteins.some(function (p) { return ['chicken', 'turkey', 'beef', 'pork', 'lamb', 'sausage', 'fish', 'seafood'].indexOf(p) !== -1; });
    if (!meat) tags.push('vegetarian');
    if (/\b(pasta|spaghetti|penne|macaroni|linguine|tagliatelle|fusilli|rigatoni|lasagne|orzo)\b/i.test(text)) tags.push('pasta');
    if (/\brice\b/i.test(text)) tags.push('rice');
    if (/\bcurry\b/i.test(title)) tags.push('curry');
    if (/\bsoup\b/i.test(title)) tags.push('soup');
    if (/\bstir[- ]?fry\b/i.test(title)) tags.push('stir-fry');
    if (/\btray ?bake\b/i.test(title)) tags.push('tray-bake');
    if (/\bair[- ]?fry/i.test(text)) tags.push('air-fryer');
    if (proteins.indexOf('fish') !== -1 || proteins.indexOf('seafood') !== -1) tags.push('fish-seafood');
    return tags;
  }

  var STEP_RE = /^(?:step\s*)?(\d{1,2})\s*[.):]\s*(.*)$/i;
  var STEP_WORD_RE = /^step\s+(\d{1,2})\s*[-:.]?\s*(.*)$/i;

  /**
   * Turn a plain-text recipe (ingredients first, then optional numbered method) into a recipe object.
   * Returns { recipe, warnings }.
   */
  function parseRecipeText(text, filename, opts) {
    opts = opts || {};
    var knownChefs = opts.knownChefs || [];
    var existingIds = opts.existingIds || [];
    var warnings = [];
    var named = nameFromFilename(filename, knownChefs);

    var lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n');
    var ingredients = [], method = [];
    var mode = 'ingredients';
    var section = null;
    var meta = { serves: null, prepMins: null, cookMins: null, eat: '', limit: '' };
    var titleFromText = '';
    var sawIngredientHeader = lines.some(function (l) { return /^\s*ingredients\s*:?\s*$/i.test(l); });
    var beforeHeader = sawIngredientHeader;

    lines.forEach(function (raw) {
      var line = raw.trim().replace(/^[-*\u2022\u25aa\u25cf]\s+/, '').replace(/\s+/g, ' ');
      if (!line) return;

      var m;
      if ((m = /^serves\s*:?\s*(\d+)/i.exec(line))) { meta.serves = Number(m[1]); return; }
      if ((m = /^prep(?:aration)?(?:\s*time)?\s*:?\s*(\d+)\s*min/i.exec(line))) { meta.prepMins = Number(m[1]); return; }
      if ((m = /^cook(?:ing)?(?:\s*time)?\s*:?\s*(\d+)\s*min/i.exec(line))) { meta.cookMins = Number(m[1]); return; }
      if ((m = /^eat\s*:\s*(.+)$/i.exec(line))) { meta.eat = m[1]; return; }
      if ((m = /^limit\s*:\s*(.+)$/i.exec(line))) { meta.limit = m[1]; return; }
      if (/^ingredients\s*:?$/i.test(line)) { beforeHeader = false; mode = 'ingredients'; return; }
      if (/^(method|instructions|directions|steps|how to make( it)?)\s*:?$/i.test(line)) { beforeHeader = false; mode = 'method'; return; }

      if (beforeHeader) { if (!titleFromText) titleFromText = line.replace(/:$/, ''); return; }

      if ((m = STEP_RE.exec(line) || STEP_WORD_RE.exec(line))) {
        mode = 'method';
        if (m[2]) method.push(m[2]);
        else method.push('');
        return;
      }

      if (mode === 'method') {
        if (method.length && (method[method.length - 1] === '' || /^[a-z]/.test(line))) {
          method[method.length - 1] = (method[method.length - 1] + ' ' + line).trim();
        } else if (method.length && !/[.!?)]$/.test(method[method.length - 1])) {
          method[method.length - 1] += ' ' + line;
        } else {
          method.push(line);
        }
        return;
      }

      // Sub-section header like "For the sauce:" or "Mash:"
      if ((m = /^(?:for the\s+)?([A-Za-z][A-Za-z ]{1,24}):$/i.exec(line)) && !/\d/.test(line)) {
        section = titleCase(m[1].trim().toLowerCase()).replace(/^./, function (c) { return c.toUpperCase(); });
        return;
      }

      // Wrapped continuation of the previous ingredient
      if (ingredients.length && /^[a-z(]/.test(line) &&
          /([,(\-–]|\b(and|or|of|with|into|in|to|for|the|a|cut|finely|roughly|thinly|thin|thick|small|large|plus|about))$/i.test(ingredients[ingredients.length - 1])) {
        ingredients[ingredients.length - 1] += ' ' + line;
        return;
      }
      ingredients.push(section && !SECTION_RE.test(line) ? section + ': ' + line : line);
    });

    var title = named.title || titleCase(titleFromText) || 'New recipe';
    if (!named.title && titleFromText) title = titleCase(titleFromText);
    var chef = named.chef || opts.defaultChef || 'Iain';
    var type2 = chef === 'Type2' || !!(meta.eat || meta.limit);
    if (type2) chef = 'Type2';

    if (!ingredients.length) warnings.push('No ingredients found - check the file has one ingredient per line.');
    if (!method.length) warnings.push('No numbered method found - the recipe will be saved with ingredients only.');
    if (!named.chef) warnings.push('Couldn\'t tell the chef from the filename - please check it.');

    var protein = inferProteins(title, ingredients);
    var tags = inferTags(title, ingredients, protein);

    var baseId = slugify((type2 ? 'type2' : chef.split(' ')[0]) + ' ' + title);
    var id = baseId, n = 2;
    while (existingIds.indexOf(id) !== -1) id = baseId + '-' + (n++);

    var recipe = {
      id: id,
      title: title,
      chef: chef,
      collection: type2 ? 'Type2' : 'Chefs',
      type2: type2,
      protein: protein,
      tags: tags
    };
    if (meta.serves) recipe.serves = meta.serves;
    if (meta.prepMins) recipe.prepMins = meta.prepMins;
    if (meta.cookMins) recipe.cookMins = meta.cookMins;
    recipe.ingredients = ingredients;
    recipe.method = method.filter(Boolean);
    if (type2) { recipe.eat = meta.eat; recipe.limit = meta.limit; }
    if (filename) recipe.sourceFile = filename;
    return { recipe: recipe, warnings: warnings };
  }

  /** Basic shape check for recipes coming from storage or imports. */
  function validateRecipe(r) {
    var errors = [];
    if (!r || typeof r !== 'object') return ['Not a recipe object'];
    if (!r.id || typeof r.id !== 'string') errors.push('Missing id');
    if (!r.title) errors.push('Missing title');
    if (!Array.isArray(r.ingredients) || !r.ingredients.length) errors.push('Needs at least one ingredient');
    if (r.method && !Array.isArray(r.method)) errors.push('Method must be a list');
    return errors;
  }

  // ---------------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------------

  /** ISO date (yyyy-mm-dd) of the Monday on or after `date`. */
  function upcomingMonday(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var dow = (d.getDay() + 6) % 7; // Mon = 0
    if (dow !== 0) d.setDate(d.getDate() + (7 - dow));
    return isoDate(d);
  }

  function isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function dateForDay(weekStartIso, dayIndex) {
    var p = weekStartIso.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2] + dayIndex);
  }

  return {
    DAYS: DAYS,
    DAY_SHORT: DAY_SHORT,
    ESSENTIALS: ESSENTIALS,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    label: label,
    categoriesOf: categoriesOf,
    hasCategory: hasCategory,
    keysOf: keysOf,
    allCategories: allCategories,
    allTags: allTags,
    allChefs: allChefs,
    isType2: isType2,
    normaliseOptions: normaliseOptions,
    isEligible: isEligible,
    eligibleRecipes: eligibleRecipes,
    seededRng: seededRng,
    shuffle: shuffle,
    sharesProtein: sharesProtein,
    countClashes: countClashes,
    generatePlan: generatePlan,
    swapDay: swapDay,
    splitSection: splitSection,
    groupIngredients: groupIngredients,
    servingsNote: servingsNote,
    buildShoppingList: buildShoppingList,
    slugify: slugify,
    titleCase: titleCase,
    nameFromFilename: nameFromFilename,
    inferProteins: inferProteins,
    inferTags: inferTags,
    parseRecipeText: parseRecipeText,
    validateRecipe: validateRecipe,
    upcomingMonday: upcomingMonday,
    isoDate: isoDate,
    dateForDay: dateForDay
  };
});
