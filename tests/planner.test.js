/*
 * Tests for js/planner.js. Run either:
 *   - in a browser: open tests/index.html via the local server, or
 *   - with Node:    node tests/planner.test.js
 */
(function (root) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports && typeof require === 'function';
  var P = isNode ? require('../js/planner.js') : root.Planner;

  var results = [];
  function test(name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, error: e && e.message || String(e) }); }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function eq(a, b, msg) {
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja !== jb) throw new Error((msg ? msg + ': ' : '') + 'expected ' + jb + ', got ' + ja);
  }

  // A small fixed pool so results are predictable.
  function R(id, chef, protein, tags, extra) {
    var r = { id: id, title: id, chef: chef, collection: chef === 'Type2' ? 'Type2' : 'Chefs', type2: chef === 'Type2', protein: protein, tags: tags || [], ingredients: ['x'], method: [] };
    Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }
  var POOL = [
    R('c1', 'Jamie', ['chicken'], []),
    R('c2', 'Gino', ['chicken'], ['oven']),
    R('c3', 'Jamie', ['chicken'], ['curry']),
    R('f1', 'Gino', ['fish'], ['fish-seafood']),
    R('s1', 'Bikers', ['seafood'], ['pasta', 'fish-seafood']),
    R('v1', 'Bikers', ['cheese'], ['vegetarian', 'pasta']),
    R('v2', 'Nigella', ['egg'], ['vegetarian']),
    R('v3', 'Nigella', [], ['vegetarian', 'side-dish']),
    R('t1', 'Type2', ['turkey'], []),
    R('t2', 'Type2', ['fish'], ['fish-seafood']),
    R('t3', 'Type2', ['egg'], ['vegetarian'])
  ];
  var byId = {};
  POOL.forEach(function (r) { byId[r.id] = r; });
  function ids(assignment) { return Object.keys(assignment).map(function (d) { return assignment[d]; }); }
  function base(extra) {
    var o = { days: [0, 1, 2, 3, 4], pool: 'all', mixType2: 2, chefs: null, mustHaves: {}, vegetarianOnly: false, exclude: [], avoidRecent: true, servings: 2 };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }

  test('fills exactly the ticked days with no duplicates', function () {
    for (var seed = 1; seed <= 30; seed++) {
      var r = P.generatePlan(POOL, base({ days: [0, 2, 4, 6] }), { rng: P.seededRng(seed) });
      assert(r.ok, 'seed ' + seed + ' failed');
      eq(Object.keys(r.assignment).map(Number).sort(), [0, 2, 4, 6]);
      var list = ids(r.assignment);
      eq(list.length, new Set(list).size, 'duplicates');
    }
  });

  test('pool: chefs only / Type2 only', function () {
    var a = P.generatePlan(POOL, base({ pool: 'chefs', days: [0, 1, 2] }), { rng: P.seededRng(2) });
    assert(a.ok && ids(a.assignment).every(function (id) { return !byId[id].type2; }), 'chefs only');
    var b = P.generatePlan(POOL, base({ pool: 'type2', days: [0, 1, 2] }), { rng: P.seededRng(2) });
    assert(b.ok && ids(b.assignment).every(function (id) { return byId[id].type2; }), 'type2 only');
  });

  test('pool: mix gives exactly N Type2 meals', function () {
    for (var seed = 1; seed <= 20; seed++) {
      var r = P.generatePlan(POOL, base({ pool: 'mix', mixType2: 2 }), { rng: P.seededRng(seed) });
      assert(r.ok, 'seed ' + seed);
      eq(ids(r.assignment).filter(function (id) { return byId[id].type2; }).length, 2, 'type2 count');
    }
  });

  test('mix asking for more Type2 than exist explains why', function () {
    var r = P.generatePlan(POOL, base({ pool: 'mix', mixType2: 4 }), { rng: P.seededRng(1) });
    assert(!r.ok);
    assert(/Only 3 unused Type2 recipes left/.test(r.problems.join(' ')), r.problems.join(' | '));
  });

  test('chef filter applies to chef recipes', function () {
    var r = P.generatePlan(POOL, base({ pool: 'chefs', chefs: ['Jamie', 'Nigella'], days: [0, 1, 2] }), { rng: P.seededRng(4) });
    assert(r.ok);
    ids(r.assignment).forEach(function (id) { assert(['Jamie', 'Nigella'].indexOf(byId[id].chef) !== -1, id); });
  });

  test('must-haves are honoured', function () {
    for (var seed = 1; seed <= 25; seed++) {
      var r = P.generatePlan(POOL, base({ mustHaves: { chicken: 2, 'fish-seafood': 1 } }), { rng: P.seededRng(seed) });
      assert(r.ok, 'seed ' + seed);
      var list = ids(r.assignment).map(function (id) { return byId[id]; });
      assert(list.filter(function (x) { return P.hasCategory(x, 'chicken'); }).length >= 2, 'chicken');
      assert(list.filter(function (x) { return P.hasCategory(x, 'fish-seafood'); }).length >= 1, 'fish');
    }
  });

  test('impossible must-have says exactly why and offers used meals', function () {
    var r = P.generatePlan(POOL, base({ mustHaves: { chicken: 3 } }), { history: ['c1', 'c2'], rng: P.seededRng(1) });
    assert(!r.ok);
    var msg = r.problems.join(' ');
    assert(/Only 1 unused chicken dish left/.test(msg), msg);
    assert(/2 more were used recently/.test(msg), msg);
    assert(r.fixableByUsed === true, 'fixable by including used');
  });

  test('exclusions: vegetarian only, no fish/seafood, no pasta, no side dishes', function () {
    var v = P.generatePlan(POOL, base({ vegetarianOnly: true, days: [0, 1, 2], exclude: [] }), { rng: P.seededRng(3) });
    assert(v.ok && ids(v.assignment).every(function (id) { return P.hasCategory(byId[id], 'vegetarian'); }), 'veg');
    for (var seed = 1; seed <= 15; seed++) {
      var r = P.generatePlan(POOL, base({ exclude: ['fish-seafood', 'pasta', 'side-dish'] }), { rng: P.seededRng(seed) });
      assert(r.ok, 'seed ' + seed);
      ids(r.assignment).forEach(function (id) {
        var x = byId[id];
        assert(!P.hasCategory(x, 'fish-seafood') && x.tags.indexOf('pasta') === -1 && x.tags.indexOf('side-dish') === -1, id);
      });
    }
  });

  test('not enough recipes is reported, never silently relaxed', function () {
    var r = P.generatePlan(POOL, base({ vegetarianOnly: true, days: [0, 1, 2, 3, 4] }), { rng: P.seededRng(1) });
    assert(!r.ok);
    assert(/Only 4 unused recipes match your choices, but you asked for 5 more meals/.test(r.problems[0]), r.problems[0]);
  });

  test('avoid recent excludes history; turning it off allows them', function () {
    var hist = ['c1', 'c2', 'c3', 'f1', 's1', 'v1'];
    var r = P.generatePlan(POOL, base({ days: [0, 1, 2, 3, 4] }), { history: hist, rng: P.seededRng(5) });
    assert(r.ok);
    ids(r.assignment).forEach(function (id) { assert(hist.indexOf(id) === -1, id + ' was used'); });
    var all = P.generatePlan(POOL, base({ days: [0, 1, 2, 3, 4, 5, 6], avoidRecent: false }), { history: hist, rng: P.seededRng(5) });
    assert(all.ok);
  });

  test('no protein repeated on consecutive days when avoidable', function () {
    for (var seed = 1; seed <= 40; seed++) {
      var r = P.generatePlan(POOL, base({ days: [0, 1, 2, 3, 4, 5], mustHaves: { chicken: 3 } }), { rng: P.seededRng(seed) });
      assert(r.ok, 'seed ' + seed);
      eq(r.clashes, 0, 'seed ' + seed + ' clashes');
      eq(P.countClashes(r.assignment, byId), 0);
    }
  });

  test('locked days are kept', function () {
    var r = P.generatePlan(POOL, base(), { locked: { 0: 'v3', 3: 'c2' }, rng: P.seededRng(9) });
    assert(r.ok);
    eq(r.assignment[0], 'v3');
    eq(r.assignment[3], 'c2');
  });

  test('swapDay changes only that day and picks something new', function () {
    var plan = { 0: 'c1', 1: 'v1', 2: 'f1' };
    for (var seed = 1; seed <= 15; seed++) {
      var r = P.swapDay(POOL, base({ days: [0, 1, 2] }), plan, 1, { rng: P.seededRng(seed) });
      assert(r.ok, 'seed ' + seed);
      eq(r.assignment[0], 'c1');
      eq(r.assignment[2], 'f1');
      assert(r.assignment[1] !== 'v1' && r.assignment[1] !== 'c1' && r.assignment[1] !== 'f1', 'new pick ' + r.assignment[1]);
    }
  });

  test('swapDay can add a meal to an empty day', function () {
    var r = P.swapDay(POOL, base({ days: [0] }), { 0: 'c1' }, 4, { rng: P.seededRng(1) });
    assert(r.ok && r.assignment[4] && r.assignment[4] !== 'c1');
  });

  test('swapDay reports when nothing else fits', function () {
    var r = P.swapDay(POOL, base({ pool: 'type2', days: [0, 1, 2] }), { 0: 't1', 1: 't2', 2: 't3' }, 1, { rng: P.seededRng(1) });
    assert(!r.ok && r.problems.length, 'should fail');
  });

  test('groupIngredients splits sub-sections and keeps CHECK lines as-is', function () {
    var g = P.groupIngredients([
      '1 tbsp oil', 'Mash: 200g carrots', 'Zest of 1/2 lemon (CHECK: original reads \'1/\')', 'Mash: 25g butter', 'To serve: lime wedges'
    ]);
    eq(g.map(function (x) { return x.section; }), [null, 'Mash', 'To serve']);
    eq(g[0].items.map(function (x) { return x.text; }), ['1 tbsp oil', 'Zest of 1/2 lemon (CHECK: original reads \'1/\')']);
    eq(g[1].items.map(function (x) { return x.text; }), ['200g carrots', '25g butter']);
    eq(g[1].items[0].index, 1);
  });

  test('servingsNote flags a mismatch only', function () {
    eq(P.servingsNote({ serves: 4 }, 4), null);
    eq(P.servingsNote({}, 2), null);
    assert(/Serves 4/.test(P.servingsNote({ serves: 4 }, 2)));
  });

  test('parseRecipeText: chef from filename, ingredients, numbered method, Type2 guidance', function () {
    var txt = [
      'Serves 4', 'Prep 10 mins', 'Cook 25 mins',
      '- 300g raw king prawns', '200g brown rice', '2 carrots, cut into thin', 'matchsticks',
      'For the sauce:', '3 tbsp soy sauce', 'Juice of 1 lime',
      '',
      'Method', '1. Cook the rice.', '2) Fry the prawns until', 'pink.', 'Step 3: Serve.',
      'Eat: rice, carrots', 'Limit: prawns'
    ].join('\r\n');
    var res = P.parseRecipeText(txt, 'Type2 - Prawn and Rice Bowl.txt', { knownChefs: ['Jamie Oliver'], existingIds: [] });
    var r = res.recipe;
    eq(r.title, 'Prawn and Rice Bowl');
    eq(r.chef, 'Type2');
    eq(r.type2, true);
    eq(r.collection, 'Type2');
    eq(r.serves, 4); eq(r.prepMins, 10); eq(r.cookMins, 25);
    eq(r.ingredients, ['300g raw king prawns', '200g brown rice', '2 carrots, cut into thin matchsticks', 'Sauce: 3 tbsp soy sauce', 'Sauce: Juice of 1 lime']);
    eq(r.method, ['Cook the rice.', 'Fry the prawns until pink.', 'Serve.']);
    eq(r.eat, 'rice, carrots'); eq(r.limit, 'prawns');
    eq(r.protein, ['seafood']);
    assert(r.tags.indexOf('rice') !== -1 && r.tags.indexOf('fish-seafood') !== -1, r.tags.join());
    eq(r.id, 'type2-prawn-and-rice-bowl');
  });

  test('parseRecipeText: possessive chef names and unique ids', function () {
    var res = P.parseRecipeText('4 chicken thighs\n1 onion\nchicken stock', 'Jamies Sticky Chicken.txt', { knownChefs: ['Jamie Oliver', 'Hairy Bikers'], existingIds: ['jamie-sticky-chicken'] });
    eq(res.recipe.chef, 'Jamie Oliver');
    eq(res.recipe.title, 'Sticky Chicken');
    eq(res.recipe.id, 'jamie-sticky-chicken-2');
    eq(res.recipe.protein, ['chicken']);
    eq(res.recipe.ingredients.length, 3, 'lowercase lines are not merged unless the previous line is unfinished');
    var hb = P.parseRecipeText('1 leek', 'Hairy Bikers Leek Soup.txt', { knownChefs: ['Jamie Oliver', 'Hairy Bikers'] });
    eq(hb.recipe.chef, 'Hairy Bikers');
    eq(hb.recipe.title, 'Leek Soup');
    assert(hb.recipe.tags.indexOf('vegetarian') !== -1 && hb.recipe.tags.indexOf('soup') !== -1);
    assert(hb.warnings.some(function (w) { return /No numbered method/.test(w); }));
  });

  test('chicken stock alone does not make a dish chicken', function () {
    eq(P.inferProteins('Root Mash', ['200ml vegetable or chicken stock']), []);
  });

  test('upcomingMonday', function () {
    eq(P.upcomingMonday(new Date(2026, 10, 27)), '2026-11-30'); // Friday -> next Monday
    eq(P.upcomingMonday(new Date(2026, 10, 30)), '2026-11-30'); // Monday stays
  });

  // Run against the real data too, when available.
  function realDataTests(data) {
    test('real data: every recipe is valid with a unique id', function () {
      var seen = {};
      data.recipes.forEach(function (r) {
        eq(P.validateRecipe(r), [], r.id);
        assert(!seen[r.id], 'duplicate id ' + r.id);
        seen[r.id] = true;
      });
    });
    test('real data: default settings produce a 5-meal plan', function () {
      var r = P.generatePlan(data.recipes, P.DEFAULT_OPTIONS, { rng: P.seededRng(11) });
      assert(r.ok, (r.problems || []).join());
      eq(Object.keys(r.assignment).length, 5);
    });
    test('real data: 7 meals, 1 chicken + 1 fish/seafood, mix of 2 Type2', function () {
      var opts = Object.assign({}, P.DEFAULT_OPTIONS, { days: [0, 1, 2, 3, 4, 5, 6], pool: 'mix', mixType2: 2, mustHaves: { chicken: 1, 'fish-seafood': 1 } });
      for (var seed = 1; seed <= 20; seed++) {
        var r = P.generatePlan(data.recipes, opts, { rng: P.seededRng(seed) });
        assert(r.ok, 'seed ' + seed + ': ' + (r.problems || []).join());
      }
    });
  }

  function report() {
    var failed = results.filter(function (r) { return !r.ok; });
    return { passed: results.length - failed.length, failed: failed.length, results: results };
  }

  if (isNode) {
    var fs = require('fs'), path = require('path');
    realDataTests(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'recipes.json'), 'utf8')));
    var rep = report();
    rep.results.forEach(function (r) { console.log((r.ok ? '  ok   ' : '  FAIL ') + r.name + (r.ok ? '' : '\n         ' + r.error)); });
    console.log('\n' + rep.passed + ' passed, ' + rep.failed + ' failed');
    process.exitCode = rep.failed ? 1 : 0;
  } else {
    root.PlannerTests = { realDataTests: realDataTests, report: report };
  }
})(typeof self !== 'undefined' ? self : this);
