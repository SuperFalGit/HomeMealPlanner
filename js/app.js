/* HomeMealPlanner - UI controller. Selection logic lives in planner.js. */
(function () {
  'use strict';
  var P = window.Planner;
  var Store = window.Store;
  var Sheets = window.Sheets;
  var esc = Sheets.esc;

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  var S = {
    baseData: null,
    base: [],
    custom: [],
    recipes: [],
    byId: {},
    settings: null,
    history: [],
    plan: null,
    shopping: { ticks: {}, extras: '' },
    prefs: { inkSaver: false },
    draft: null,
    draftWeek: null,
    wizStep: 1,
    importQueue: [],
    recipeFilter: 'all',
    recipeQuery: '',
    printPrepared: false
  };

  var PROTEIN_CHOICES = ['chicken', 'turkey', 'beef', 'pork', 'lamb', 'sausage', 'fish', 'seafood', 'egg', 'cheese', 'tofu'];

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  var params = new URLSearchParams(location.search);
  var demo = params.has('demo');
  if (demo) Store.setEphemeral(true);

  init().catch(function (err) {
    console.error(err);
    showFatal('Couldn\'t start the planner: ' + err.message);
  });

  async function init() {
    bindStatic();
    var res;
    try {
      res = await fetch('data/recipes.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (e) {
      showFatal('Couldn\'t load data/recipes.json. Run a local server in this folder (python -m http.server 8000) and open http://localhost:8000 - opening the file directly won\'t work.');
      return;
    }
    S.baseData = await res.json();
    S.base = S.baseData.recipes || [];
    S.custom = Store.getCustomRecipes().filter(function (r) { return !P.validateRecipe(r).length; });
    rebuildRecipes();

    if (!Store.hasHistory()) {
      var seeded = [];
      try {
        var h = await fetch('data/history.json', { cache: 'no-cache' });
        if (h.ok) seeded = ((await h.json()).used) || [];
      } catch (e) { /* no history file - start empty */ }
      Store.setHistory(seeded);
    }
    S.history = Store.getHistory();

    S.settings = Object.assign({}, P.DEFAULT_OPTIONS, Store.getSettings() || {});
    S.plan = Store.getPlan();
    S.shopping = Store.getShopping();
    S.prefs = Store.getPrefs();
    $('#inkSaver').checked = !!S.prefs.inkSaver;
    $('#extras').value = S.shopping.extras || '';

    // ?demo[=nights][&seed=n] builds a throwaway plan without touching saved data (handy for previews/tests).
    if (demo && !S.plan) {
      var nights = Math.min(7, Math.max(1, parseInt(params.get('demo'), 10) || 5));
      var demoOpts = Object.assign({}, S.settings, { days: [0, 1, 2, 3, 4, 5, 6].slice(0, nights) });
      var r = P.generatePlan(S.recipes, demoOpts, { history: S.history, rng: P.seededRng(parseInt(params.get('seed'), 10) || 7) });
      if (r.ok) S.plan = newPlan(r.assignment, P.upcomingMonday(new Date()));
    }

    var tab = (location.hash || '#week').slice(1);
    showTab(['week', 'shop', 'recipes', 'history'].indexOf(tab) !== -1 ? tab : 'week');
    renderAll();
  }

  function rebuildRecipes() {
    var customIds = S.custom.map(function (r) { return r.id; });
    S.recipes = S.base.filter(function (r) { return customIds.indexOf(r.id) === -1; }).concat(S.custom);
    S.byId = {};
    S.recipes.forEach(function (r) { S.byId[r.id] = r; });
  }

  function isCustom(id) { return S.custom.some(function (r) { return r.id === id; }); }

  function showFatal(msg) {
    var main = $('#main');
    var div = document.createElement('div');
    div.className = 'fatal';
    div.innerHTML = '<svg class="ic"><use href="#i-alert"/></svg><p>' + esc(msg) + '</p>';
    main.insertBefore(div, main.firstChild);
    $('#startBtn').disabled = true;
  }

  // ---------------------------------------------------------------------------
  // Plan model helpers
  // ---------------------------------------------------------------------------

  function newPlan(assignment, weekStart) {
    var slots = {};
    Object.keys(assignment).forEach(function (d) { slots[d] = { id: assignment[d], locked: false }; });
    return { weekStart: weekStart, createdAt: new Date().toISOString(), slots: slots, confirmed: false, added: [] };
  }

  function assignmentOf(plan) {
    var a = {};
    if (!plan) return a;
    Object.keys(plan.slots).forEach(function (d) { if (plan.slots[d] && plan.slots[d].id) a[d] = plan.slots[d].id; });
    return a;
  }

  function lockedOf(plan) {
    var a = {};
    Object.keys(plan.slots).forEach(function (d) { if (plan.slots[d].locked) a[d] = plan.slots[d].id; });
    return a;
  }

  function planDays(plan) { return Object.keys(plan.slots).map(Number).sort(function (a, b) { return a - b; }); }

  /** History used for picking: excludes meals this plan itself added, so swapping them back is allowed. */
  function pickHistory() {
    var added = (S.plan && S.plan.added) || [];
    return S.history.filter(function (id) { return added.indexOf(id) === -1; });
  }

  function savePlan(changed) {
    if (changed && S.plan) S.plan.confirmed = false;
    Store.setPlan(S.plan);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function renderAll() {
    renderWeek();
    renderShopping();
    renderRecipes();
    renderHistory();
  }

  function showTab(name) {
    $$('.tab').forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    if (location.hash.slice(1) !== name) history.replaceState(null, '', location.pathname + location.search + '#' + name);
    if (name === 'week') requestAnimationFrame(function () { scalePreviews(); fitPreview(); });
    window.scrollTo(0, 0);
  }

  function renderWeek() {
    var has = !!(S.plan && Object.keys(S.plan.slots).length);
    $('#hero').hidden = has;
    $('#weekView').hidden = !has;
    var unused = S.recipes.filter(function (r) { return S.history.indexOf(r.id) === -1; }).length;
    $('#heroMeta').textContent = S.recipes.length + ' recipes in your pool · ' + unused + ' not used recently';
    if (!has) return;

    var plan = S.plan;
    $('#weekLabel').textContent = plan.weekStart ? 'Week of ' + Sheets.formatWeek(plan.weekStart) : 'This week';
    var days = planDays(plan);
    $('#planSummary').textContent = days.length + ' evening ' + (days.length === 1 ? 'meal' : 'meals') + ' · ' +
      days.map(function (d) { return P.DAY_SHORT[d]; }).join(', ');
    var status = $('#planStatus');
    status.textContent = plan.confirmed ? 'Confirmed' : 'Draft - not yet confirmed';
    status.className = 'pill ' + (plan.confirmed ? 'pill-ok' : 'pill-draft');
    var confirmBtn = $('#confirmBtn');
    confirmBtn.disabled = plan.confirmed;
    confirmBtn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>' + (plan.confirmed ? 'Week confirmed' : 'Confirm week');
    $('#rerollBtn').disabled = days.every(function (d) { return plan.slots[d].locked; });

    var list = $('#dayList');
    var html = '';
    var options = recipeOptionsHtml();
    for (var d = 0; d < 7; d++) {
      var slot = plan.slots[d];
      var date = Sheets.shortDate(plan.weekStart, d);
      if (!slot) {
        html += '<li class="day-card is-off"><div class="dc-day"><span class="dc-dow">' + P.DAY_SHORT[d] + '</span><span class="dc-date">' + esc(date) + '</span></div>' +
          '<div class="dc-main"><span class="muted">No meal planned</span></div>' +
          '<div class="dc-actions"><button class="btn btn-ghost btn-sm" data-add="' + d + '"><svg class="ic"><use href="#i-plus"/></svg>Add meal</button></div></li>';
        continue;
      }
      var r = S.byId[slot.id];
      var prev = plan.slots[d - 1] && S.byId[plan.slots[d - 1].id];
      var clash = r && prev && P.sharesProtein(prev, r);
      var note = r && P.servingsNote(r, S.settings.servings);
      var mins = r ? (r.prepMins || 0) + (r.cookMins || 0) : 0;
      html += '<li class="day-card' + (slot.locked ? ' is-locked' : '') + '" data-day="' + d + '">' +
        '<div class="dc-day"><span class="dc-dow">' + P.DAY_SHORT[d] + '</span><span class="dc-date">' + esc(date) + '</span></div>' +
        '<div class="dc-main">' +
        (r ? '<button class="dc-title" type="button" data-view="' + esc(r.id) + '">' + esc(r.title) + '</button>' +
          '<div class="dc-meta"><span class="chip chip-chef"><svg class="ic"><use href="#i-hat"/></svg>' + esc(r.chef) + '</span>' +
          (r.type2 ? '<span class="chip chip-t2">Type2</span>' : '') +
          (r.protein || []).map(function (p) { return '<span class="chip">' + esc(p) + '</span>'; }).join('') +
          (mins ? '<span class="dc-time"><svg class="ic"><use href="#i-clock"/></svg>' + mins + ' min</span>' : '') +
          '</div>' +
          (note ? '<p class="dc-note"><svg class="ic"><use href="#i-users"/></svg>' + esc(note) + '</p>' : '') +
          (clash ? '<p class="dc-note"><svg class="ic"><use href="#i-alert"/></svg>Same protein as ' + P.DAYS[d - 1] + '</p>' : '')
          : '<span class="muted">This recipe is no longer in the pool - swap it.</span>') +
        '<select class="dc-pick" data-pick="' + d + '" aria-label="Choose a recipe for ' + P.DAYS[d] + '">' +
        '<option value="">Choose a specific recipe…</option>' + options + '</select>' +
        '</div>' +
        '<div class="dc-actions">' +
        '<button class="icon-btn' + (slot.locked ? ' is-on' : '') + '" type="button" data-lock="' + d + '" aria-pressed="' + slot.locked + '" title="' + (slot.locked ? 'Unlock' : 'Lock this meal') + '"><svg class="ic"><use href="#i-' + (slot.locked ? 'lock' : 'unlock') + '"/></svg><span>' + (slot.locked ? 'Locked' : 'Lock') + '</span></button>' +
        '<button class="icon-btn" type="button" data-swap="' + d + '" title="Swap for another recipe"' + (slot.locked ? ' disabled' : '') + '><svg class="ic"><use href="#i-shuffle"/></svg><span>Swap</span></button>' +
        '<button class="icon-btn subtle" type="button" data-remove="' + d + '" title="Remove this night"' + (days.length <= 1 ? ' disabled' : '') + '><svg class="ic"><use href="#i-x"/></svg></button>' +
        '</div></li>';
    }
    list.innerHTML = html;
    renderPreview();
  }

  function recipeOptionsHtml() {
    var groups = {};
    S.recipes.forEach(function (r) { (groups[r.chef] = groups[r.chef] || []).push(r); });
    return Object.keys(groups).sort().map(function (chef) {
      return '<optgroup label="' + esc(chef) + '">' + groups[chef].slice().sort(function (a, b) { return a.title.localeCompare(b.title); }).map(function (r) {
        var used = S.history.indexOf(r.id) !== -1 ? ' (used)' : '';
        return '<option value="' + esc(r.id) + '">' + esc(r.title + used) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }

  // --- Print preview -------------------------------------------------------

  function renderPreview() {
    var strip = $('#previewStrip');
    if (!S.plan) { strip.innerHTML = ''; return; }
    strip.innerHTML =
      '<figure class="sheet-frame"><div class="sheet-scale">' + Sheets.plannerSheet(S.plan, S.byId, S.settings.servings) + '</div><figcaption>Page 1 · Planner</figcaption></figure>' +
      '<figure class="sheet-frame"><div class="sheet-scale">' + Sheets.essentialsSheet() + '</div><figcaption>Page 2 · Essentials (back)</figcaption></figure>';
    strip.classList.toggle('ink-saver', !!S.prefs.inkSaver);
    scalePreviews();
    fitPreview();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitPreview);
  }

  /** Fit the ingredients column to the page (only possible while the preview is laid out). */
  function fitPreview() {
    var sheet = $('#previewStrip .sheet-planner');
    if (!sheet || !sheet.offsetParent) return;
    var res = Sheets.fitPlanner(sheet);
    var warn = $('#fitWarning');
    warn.hidden = res.fits;
    warn.textContent = res.fits ? '' : 'There are a lot of ingredients this week - the list is at its smallest size and may be cut off. Print the recipe cards or shopping list as well.';
  }

  function scalePreviews() {
    $$('.sheet-frame').forEach(function (frame) {
      var sheet = frame.querySelector('.sheet');
      if (!sheet || !frame.clientWidth) return;
      frame.style.setProperty('--k', frame.clientWidth / sheet.offsetWidth);
    });
  }

  // --- Printing ------------------------------------------------------------

  function preparePrint(mode) {
    var area = $('#print-area');
    var pageStyle = $('#pageStyle') || (function () {
      var s = document.createElement('style');
      s.id = 'pageStyle';
      document.head.appendChild(s);
      return s;
    })();
    document.body.dataset.print = mode;
    area.className = S.prefs.inkSaver ? 'ink-saver' : '';

    if (mode === 'planner') {
      pageStyle.textContent = '@page { size: A4 portrait; margin: 0; }';
      // #print-area is laid out off-screen, so the ingredients can be fitted to the page here.
      area.innerHTML = Sheets.plannerSheet(S.plan || { slots: {}, weekStart: null }, S.byId, S.settings.servings) + Sheets.essentialsSheet();
      Sheets.fitPlanner(area.querySelector('.sheet-planner'));
    } else if (mode === 'cards') {
      pageStyle.textContent = '@page { size: A4 portrait; margin: 12mm; }';
      area.innerHTML = '<div class="cards-print">' + planDays(S.plan).filter(function (d) { return S.byId[S.plan.slots[d].id]; }).map(function (d) {
        return Sheets.recipeCard(S.byId[S.plan.slots[d].id], { day: d, servings: S.settings.servings });
      }).join('') + '</div>';
    } else if (mode === 'shopping') {
      pageStyle.textContent = '@page { size: A4 portrait; margin: 12mm; }';
      var list = P.buildShoppingList(assignmentOf(S.plan), S.byId);
      area.innerHTML = Sheets.shoppingSheet(list, S.shopping.extras, S.plan && S.plan.weekStart);
    }
    S.printPrepared = true;
  }

  function doPrint(mode) {
    if (mode !== 'planner' && !S.plan) { toast('Plan some meals first.'); return; }
    preparePrint(mode);
    window.print();
  }

  // --- Shopping ------------------------------------------------------------

  function shopKey(recipeId, index) { return recipeId + ':' + index; }

  function renderShopping() {
    var wrap = $('#shopList');
    var hasPlan = !!(S.plan && Object.keys(S.plan.slots).length);
    $('#shopEmpty').hidden = hasPlan;
    var list = hasPlan ? P.buildShoppingList(assignmentOf(S.plan), S.byId) : [];
    var total = 0, ticked = 0;
    var item = function (key, html) {
      total++;
      var on = !!S.shopping.ticks[key];
      if (on) ticked++;
      return '<li><label class="tick' + (on ? ' is-on' : '') + '"><input type="checkbox" data-key="' + esc(key) + '"' + (on ? ' checked' : '') + '><span class="tick-box"><svg class="ic"><use href="#i-check"/></svg></span><span class="tick-text">' + html + '</span></label></li>';
    };
    var html = list.map(function (m) {
      return '<section class="card shop-card"><header><span class="day-pill">' + P.DAY_SHORT[m.day] + '</span><div><h3>' + esc(m.recipe.title) + '</h3><p class="muted small">' + esc(m.recipe.chef) + '</p></div></header>' +
        m.groups.map(function (g) {
          return (g.section ? '<h4>' + esc(g.section) + '</h4>' : '') + '<ul class="tick-list">' + g.items.map(function (it) {
            return item(shopKey(m.recipe.id, it.index), Sheets.ingredientHtml(it.text));
          }).join('') + '</ul>';
        }).join('') + '</section>';
    }).join('');
    html += '<section class="card shop-card essentials-card"><header><span class="day-pill alt"><svg class="ic"><use href="#i-cart"/></svg></span><div><h3>Day to day essentials</h3><p class="muted small">Every week</p></div></header><ul class="tick-list">' +
      P.ESSENTIALS.map(function (e) { return item('ess:' + e, esc(e)); }).join('') + '</ul></section>';
    wrap.innerHTML = html;
    $('#shopSummary').textContent = hasPlan
      ? total + ' items · ' + ticked + ' ticked' + (S.plan.weekStart ? ' · week of ' + Sheets.formatWeek(S.plan.weekStart) : '')
      : 'Essentials only until you plan some meals.';
    var badge = $('#shopBadge');
    badge.hidden = !hasPlan || total - ticked === 0;
    badge.textContent = total - ticked;
  }

  // --- Recipes -------------------------------------------------------------

  function renderRecipes() {
    var q = S.recipeQuery.trim().toLowerCase();
    var f = S.recipeFilter;
    var list = S.recipes.filter(function (r) {
      if (f === 'custom' && !isCustom(r.id)) return false;
      if ((f === 'Chefs' || f === 'Type2') && (P.isType2(r) ? 'Type2' : 'Chefs') !== f) return false;
      if (!q) return true;
      return (r.title + ' ' + r.chef + ' ' + (r.tags || []).join(' ') + ' ' + (r.protein || []).join(' ') + ' ' + r.ingredients.join(' ')).toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return a.title.localeCompare(b.title); });

    $('#recipeCount').textContent = S.recipes.length + ' recipes · ' + S.custom.length + ' added here' + (list.length !== S.recipes.length ? ' · showing ' + list.length : '');
    $('#recipeGrid').innerHTML = list.length ? list.map(function (r) {
      var used = S.history.indexOf(r.id) !== -1;
      var mins = (r.prepMins || 0) + (r.cookMins || 0);
      return '<button class="recipe-tile" type="button" data-view="' + esc(r.id) + '">' +
        '<span class="rt-top"><span class="rt-chef">' + esc(r.chef) + '</span>' +
        (isCustom(r.id) ? '<span class="badge badge-new">Added</span>' : '') +
        (used ? '<span class="badge">Used</span>' : '') + '</span>' +
        '<span class="rt-title">' + esc(r.title) + '</span>' +
        '<span class="rt-chips">' + (r.type2 ? '<span class="chip chip-t2">Type2</span>' : '') +
        (r.protein || []).concat((r.tags || []).filter(function (t) { return t !== 'fish-seafood'; }).slice(0, 2)).map(function (t) { return '<span class="chip">' + esc(P.label(t)) + '</span>'; }).join('') + '</span>' +
        '<span class="rt-foot"><span>' + r.ingredients.length + ' ingredients</span>' +
        (mins ? '<span>' + mins + ' min</span>' : '') +
        '<span>' + (r.method && r.method.length ? r.method.length + ' steps' : 'No method') + '</span></span>' +
        '</button>';
    }).join('') : '<p class="muted empty-inline">No recipes match.</p>';
  }

  function openRecipe(id) {
    var r = S.byId[id];
    if (!r) return;
    var used = S.history.indexOf(id) !== -1;
    var actions = '<div class="rv-actions">' +
      (used ? '<button class="btn btn-ghost btn-sm" type="button" data-unuse="' + esc(id) + '"><svg class="ic"><use href="#i-history"/></svg>Mark as not used</button>' : '') +
      (isCustom(id) ? '<button class="btn btn-danger btn-sm" type="button" data-delete="' + esc(id) + '"><svg class="ic"><use href="#i-trash"/></svg>Delete recipe</button>' : '') +
      '</div>';
    $('#recipeView').innerHTML = Sheets.recipeCard(r, { servings: S.settings.servings }) + actions;
    $('#recipeDialog').showModal();
  }

  // --- History -------------------------------------------------------------

  function renderHistory() {
    $('#historySummary').textContent = S.history.length
      ? S.history.length + ' of ' + S.recipes.length + ' recipes used'
      : 'Nothing used yet - every recipe is up for grabs.';
    $('#historyList').innerHTML = S.history.map(function (id) {
      var r = S.byId[id];
      return '<li><div><b>' + esc(r ? r.title : id) + '</b><span class="muted small">' + esc(r ? r.chef : 'Not in the recipe pool') + '</span></div>' +
        '<button class="icon-btn subtle" type="button" data-unuse="' + esc(id) + '" title="Remove from history"><svg class="ic"><use href="#i-x"/></svg></button></li>';
    }).join('');
    $('#usedCount').textContent = '(' + S.history.length + ' used)';
  }

  // ---------------------------------------------------------------------------
  // Wizard
  // ---------------------------------------------------------------------------

  function openWizard() {
    S.draft = JSON.parse(JSON.stringify(S.settings));
    if (!S.draft.days || !S.draft.days.length) S.draft.days = [0, 1, 2, 3, 4];
    var monday = P.upcomingMonday(new Date());
    S.draftWeek = monday;
    S.wizStep = 1;
    $('#wizProblems').hidden = true;
    renderWizard();
    $('#wizard').showModal();
  }

  function renderWizard() {
    var d = S.draft;
    var step = S.wizStep;
    $$('.wiz-step').forEach(function (el) { el.hidden = Number(el.dataset.step) !== step; });
    $('#wizBar').style.width = (step === 1 ? 50 : 100) + '%';
    $('#wizStep').textContent = 'Step ' + step + ' of 2';
    $('#wizTitle').textContent = step === 1 ? 'How many evening meals?' : 'Fine-tune the picks';
    $('#wizBack').hidden = step === 1;
    $('#wizQuick').hidden = step !== 1;
    $('#wizQuick').innerHTML = 'Preferences<svg class="ic"><use href="#i-right"/></svg>';
    $('#wizNext').innerHTML = '<svg class="ic"><use href="#i-sparkle"/></svg>Create my plan';
    $('#wizNext').disabled = !d.days.length;

    // Step 1
    $('#mealsOut').textContent = d.days.length;
    $('#mealsHint').textContent = (d.days.length === 1 ? 'evening meal' : 'evening meals') + ' this week';
    $('#mealsMinus').disabled = d.days.length <= 1;
    $('#mealsPlus').disabled = d.days.length >= 7;
    $('#dayChips').innerHTML = P.DAYS.map(function (name, i) {
      var on = d.days.indexOf(i) !== -1;
      return '<button type="button" class="day-chip' + (on ? ' is-on' : '') + '" data-daychip="' + i + '" aria-pressed="' + on + '"><b>' + name.slice(0, 3) + '</b><small>' + esc(Sheets.shortDate(S.draftWeek, i)) + '</small></button>';
    }).join('');
    $('#weekStart').value = S.draftWeek;
    $('#servOut').textContent = d.servings;
    $('#servMinus').disabled = d.servings <= 1;

    // Step 2
    $$('#poolSeg button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.pool === d.pool); });
    $('#mixRow').hidden = d.pool !== 'mix';
    d.mixType2 = Math.min(d.mixType2, d.days.length);
    $('#mixOut').textContent = d.mixType2;
    $('#mixMinus').disabled = d.mixType2 <= 0;
    $('#mixPlus').disabled = d.mixType2 >= d.days.length;
    $('#chefBlock').hidden = d.pool === 'type2';
    $('#chefChips').innerHTML = P.allChefs(S.recipes).map(function (c) {
      var on = !Array.isArray(d.chefs) || d.chefs.indexOf(c) !== -1;
      return '<button type="button" class="chip-btn' + (on ? ' is-on' : '') + '" data-chef="' + esc(c) + '" aria-pressed="' + on + '">' + esc(c) + '</button>';
    }).join('');

    var cats = P.allCategories(S.recipes).filter(function (c) { return c !== 'fish' && c !== 'seafood'; });
    $('#mustGrid').innerHTML = cats.map(function (c) {
      var n = d.mustHaves[c] || 0;
      return '<div class="must' + (n ? ' is-on' : '') + '"><span>' + esc(P.label(c)) + '</span><div class="stepper tiny">' +
        '<button type="button" class="icon-btn round" data-must="' + esc(c) + '" data-delta="-1"' + (n <= 0 ? ' disabled' : '') + ' aria-label="Fewer ' + esc(P.label(c)) + '"><svg class="ic"><use href="#i-minus"/></svg></button>' +
        '<output>' + n + '</output>' +
        '<button type="button" class="icon-btn round" data-must="' + esc(c) + '" data-delta="1"' + (n >= d.days.length ? ' disabled' : '') + ' aria-label="More ' + esc(P.label(c)) + '"><svg class="ic"><use href="#i-plus"/></svg></button>' +
        '</div></div>';
    }).join('');

    $('#vegOnly').checked = !!d.vegetarianOnly;
    var exKeys = P.allCategories(S.recipes).filter(function (c) { return c !== 'vegetarian'; }).concat(P.allTags(S.recipes));
    $('#excludeChips').innerHTML = exKeys.map(function (k) {
      var on = d.exclude.indexOf(k) !== -1;
      return '<button type="button" class="chip-btn ex' + (on ? ' is-on' : '') + '" data-ex="' + esc(k) + '" aria-pressed="' + on + '">' + (on ? '<svg class="ic"><use href="#i-x"/></svg>' : '') + esc(P.label(k)) + '</button>';
    }).join('');
    $('#avoidRecent').checked = !!d.avoidRecent;

    var match = P.eligibleRecipes(S.recipes, d);
    var unused = match.filter(function (r) { return S.history.indexOf(r.id) === -1; });
    var usable = d.avoidRecent ? unused.length : match.length;
    var pc = $('#poolCount');
    pc.innerHTML = '<b>' + match.length + '</b> recipes match' + (d.avoidRecent ? ' · <b>' + unused.length + '</b> not used recently' : '');
    pc.classList.toggle('is-low', usable < d.days.length);
  }

  function setMeals(n) {
    var d = S.draft;
    n = Math.max(1, Math.min(7, n));
    var order = [0, 1, 2, 3, 4, 5, 6];
    while (d.days.length < n) {
      var next = order.filter(function (i) { return d.days.indexOf(i) === -1; })[0];
      d.days.push(next);
    }
    while (d.days.length > n) d.days.sort(function (a, b) { return a - b; }).pop();
    d.days.sort(function (a, b) { return a - b; });
  }

  function createPlanFromWizard() {
    var d = S.draft;
    var res = P.generatePlan(S.recipes, d, { history: S.history });
    if (!res.ok) {
      showProblems($('#wizProblems'), res, {
        includeUsed: function () { d.avoidRecent = false; renderWizard(); createPlanFromWizard(); },
        resetHistory: function () { resetHistory(); renderWizard(); createPlanFromWizard(); }
      });
      return;
    }
    S.settings = JSON.parse(JSON.stringify(d));
    Store.setSettings(S.settings);
    S.plan = newPlan(res.assignment, S.draftWeek);
    savePlan(false);
    S.shopping.ticks = {};
    Store.setShopping(S.shopping);
    $('#wizard').close();
    showTab('week');
    renderAll();
    toast(planDays(S.plan).length + ' meals picked' + (res.clashes ? ' (couldn\'t avoid a protein repeat on back-to-back nights)' : ''));
  }

  /** Render "why it failed" with options to include used meals or reset history - never relax silently. */
  function showProblems(container, res, handlers) {
    var canUse = S.history.length > 0;
    container.innerHTML = '<p class="problems-title"><svg class="ic"><use href="#i-alert"/></svg>Can\'t build that plan</p><ul>' +
      res.problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' +
      (canUse ? '<div class="problems-actions">' +
        (res.fixableByUsed ? '<button type="button" class="btn btn-sm btn-accent" data-fix="used">Include recently used meals</button>' : '') +
        '<button type="button" class="btn btn-sm btn-ghost" data-fix="reset">Reset history</button></div>' : '');
    container.hidden = false;
    container.onclick = function (e) {
      var b = e.target.closest('[data-fix]');
      if (!b) return;
      container.hidden = true;
      if (b.dataset.fix === 'used') handlers.includeUsed();
      else confirmDialog('Reset meal history?', 'Every recipe becomes available again. You can export the history first if you want a copy.', 'Reset history', handlers.resetHistory);
    };
    container.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------------------------------------------------------------------------
  // Week actions
  // ---------------------------------------------------------------------------

  function swap(day) {
    var res = P.swapDay(S.recipes, S.settings, assignmentOf(S.plan), day, { history: pickHistory() });
    if (!res.ok) {
      var div = document.createElement('div');
      alertDialog('Can\'t swap ' + P.DAYS[day], div, []);
      showProblems(div, res, {
        includeUsed: function () {
          var opts = Object.assign({}, S.settings, { avoidRecent: false });
          var r2 = P.swapDay(S.recipes, opts, assignmentOf(S.plan), day, {});
          $('#alertDialog').close();
          if (r2.ok) applySwap(day, r2.assignment[day]); else toast('Still no alternative - try changing your preferences.');
        },
        resetHistory: function () {
          resetHistory();
          $('#alertDialog').close();
          swap(day);
        }
      });
      return;
    }
    applySwap(day, res.assignment[day]);
  }

  function applySwap(day, id) {
    var isNew = !S.plan.slots[day];
    S.plan.slots[day] = { id: id, locked: false };
    savePlan(true);
    renderAll();
    var r = S.byId[id];
    toast((isNew ? 'Added ' : 'Swapped in ') + (r ? r.title : 'a new recipe'));
  }

  function rerollUnlocked() {
    var opts = Object.assign({}, S.settings, { days: planDays(S.plan) });
    var res = P.generatePlan(S.recipes, opts, { history: pickHistory(), locked: lockedOf(S.plan) });
    if (!res.ok) {
      var div = document.createElement('div');
      alertDialog('Can\'t re-roll', div, []);
      showProblems(div, res, {
        includeUsed: function () {
          $('#alertDialog').close();
          var r2 = P.generatePlan(S.recipes, Object.assign({}, opts, { avoidRecent: false }), { locked: lockedOf(S.plan) });
          if (r2.ok) applyAssignment(r2.assignment); else toast('Still can\'t - try changing your preferences.');
        },
        resetHistory: function () { resetHistory(); $('#alertDialog').close(); rerollUnlocked(); }
      });
      return;
    }
    applyAssignment(res.assignment);
    toast('Re-rolled the unlocked nights');
  }

  function applyAssignment(assignment) {
    Object.keys(assignment).forEach(function (d) {
      var locked = S.plan.slots[d] && S.plan.slots[d].locked;
      S.plan.slots[d] = { id: assignment[d], locked: !!locked };
    });
    savePlan(true);
    renderAll();
  }

  function confirmWeek() {
    var ids = planDays(S.plan).map(function (d) { return S.plan.slots[d].id; }).filter(function (id) { return S.byId[id]; });
    var added = S.plan.added || [];
    var dropped = added.filter(function (id) { return ids.indexOf(id) === -1; });
    S.history = S.history.filter(function (id) { return dropped.indexOf(id) === -1; });
    var fresh = ids.filter(function (id) { return S.history.indexOf(id) === -1; });
    S.history = S.history.concat(fresh);
    Store.setHistory(S.history);
    S.plan.added = added.filter(function (id) { return ids.indexOf(id) !== -1; }).concat(fresh);
    S.plan.confirmed = true;
    savePlan(false);
    renderAll();
    toast('Week confirmed - ' + ids.length + ' meals marked as used');
  }

  function resetHistory() {
    S.history = [];
    Store.setHistory([]);
    if (S.plan) S.plan.added = [];
    savePlan(false);
    renderAll();
    toast('History cleared');
  }

  function unuse(id) {
    S.history = S.history.filter(function (h) { return h !== id; });
    Store.setHistory(S.history);
    if (S.plan && S.plan.added) S.plan.added = S.plan.added.filter(function (h) { return h !== id; });
    savePlan(false);
    renderAll();
  }

  // ---------------------------------------------------------------------------
  // Importing recipes (.txt drag & drop)
  // ---------------------------------------------------------------------------

  async function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var txt = files.filter(function (f) { return /\.txt$/i.test(f.name) || f.type === 'text/plain'; });
    if (files.length && !txt.length) { toast('Only .txt recipe files can be added'); return; }
    if (txt.length < files.length) toast('Skipped ' + (files.length - txt.length) + ' non-.txt file(s)');
    for (var i = 0; i < txt.length; i++) {
      var text = await txt[i].text();
      var ids = S.recipes.map(function (r) { return r.id; }).concat(S.importQueue.map(function (q) { return q.recipe.id; }));
      var parsed = P.parseRecipeText(text, txt[i].name, { knownChefs: P.allChefs(S.recipes), existingIds: ids });
      var dup = S.recipes.filter(function (r) { return r.title.toLowerCase() === parsed.recipe.title.toLowerCase(); })[0];
      if (dup) parsed.warnings.unshift('A recipe called "' + dup.title + '" (' + dup.chef + ') is already in the pool - saving adds a second copy.');
      S.importQueue.push(parsed);
    }
    if (S.importQueue.length && !$('#importDialog').open) showImport();
  }

  function showImport() {
    var item = S.importQueue[0];
    if (!item) { $('#importDialog').close(); return; }
    var r = item.recipe;
    $('#impStep').textContent = 'New recipe' + (S.importQueue.length > 1 ? ' · ' + S.importQueue.length + ' to review' : '') + (r.sourceFile ? ' · ' + r.sourceFile : '');
    var w = $('#impWarnings');
    w.hidden = !item.warnings.length;
    w.innerHTML = item.warnings.map(function (x) { return '<p><svg class="ic"><use href="#i-alert"/></svg>' + esc(x) + '</p>'; }).join('');
    $('#impTitleIn').value = r.title;
    $('#impChef').value = r.chef;
    $('#chefList').innerHTML = P.allChefs(S.recipes).concat(['Type2']).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
    $('#impServes').value = r.serves || '';
    $('#impPrep').value = r.prepMins || '';
    $('#impCook').value = r.cookMins || '';
    $('#impType2').checked = !!r.type2;
    $('#impT2Row').hidden = !r.type2;
    $('#impEat').value = r.eat || '';
    $('#impLimit').value = r.limit || '';
    var proteins = PROTEIN_CHOICES.slice();
    S.recipes.forEach(function (x) { (x.protein || []).forEach(function (p) { if (proteins.indexOf(p) === -1) proteins.push(p); }); });
    $('#impProtein').innerHTML = proteins.map(function (p) {
      var on = r.protein.indexOf(p) !== -1;
      return '<button type="button" class="chip-btn' + (on ? ' is-on' : '') + '" data-prot="' + esc(p) + '" aria-pressed="' + on + '">' + esc(p) + '</button>';
    }).join('');
    $('#impTags').value = r.tags.join(', ');
    $('#impIngredients').value = r.ingredients.join('\n');
    $('#impMethod').value = r.method.join('\n');
    if (!$('#importDialog').open) $('#importDialog').showModal();
    $('#importDialog .wiz-body').scrollTop = 0;
  }

  function saveImport() {
    var item = S.importQueue[0];
    if (!item) return;
    var lines = function (v) { return v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); };
    var type2 = $('#impType2').checked;
    var chef = $('#impChef').value.trim() || 'Iain';
    if (type2) chef = 'Type2';
    var title = $('#impTitleIn').value.trim();
    var protein = $$('#impProtein .is-on').map(function (b) { return b.dataset.prot; });
    var tags = $('#impTags').value.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    var ids = S.recipes.map(function (r) { return r.id; });
    var baseId = P.slugify((type2 ? 'type2' : chef.split(' ')[0]) + ' ' + title);
    var id = baseId, n = 2;
    while (ids.indexOf(id) !== -1) id = baseId + '-' + (n++);

    var r = { id: id, title: title, chef: chef, collection: type2 ? 'Type2' : 'Chefs', type2: type2, protein: protein, tags: tags };
    var num = function (sel) { var v = parseInt($(sel).value, 10); return v > 0 ? v : null; };
    if (num('#impServes')) r.serves = num('#impServes');
    if (num('#impPrep')) r.prepMins = num('#impPrep');
    if (num('#impCook')) r.cookMins = num('#impCook');
    r.ingredients = lines($('#impIngredients').value);
    r.method = lines($('#impMethod').value);
    if (type2) { r.eat = $('#impEat').value.trim(); r.limit = $('#impLimit').value.trim(); }
    if (item.recipe.sourceFile) r.sourceFile = item.recipe.sourceFile;
    r.addedInApp = new Date().toISOString().slice(0, 10);

    var errors = P.validateRecipe(r);
    if (errors.length) { toast(errors.join(' · ')); return; }
    S.custom.push(r);
    Store.setCustomRecipes(S.custom);
    rebuildRecipes();
    S.importQueue.shift();
    renderAll();
    toast('Added "' + r.title + '" to your recipe pool');
    if (S.importQueue.length) showImport(); else $('#importDialog').close();
  }

  function deleteCustom(id) {
    S.custom = S.custom.filter(function (r) { return r.id !== id; });
    Store.setCustomRecipes(S.custom);
    rebuildRecipes();
    renderAll();
    toast('Recipe deleted');
  }

  // ---------------------------------------------------------------------------
  // Export / import
  // ---------------------------------------------------------------------------

  function download(filename, data) {
    var blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportRecipes() {
    var out = Object.assign({}, S.baseData, {
      recipes: S.recipes.map(function (r) {
        var copy = Object.assign({}, r);
        delete copy.addedInApp;
        return copy;
      })
    });
    download('recipes.json', out);
    toast('Downloaded recipes.json - replace data/recipes.json with it and commit');
  }

  function exportHistory() {
    download('history.json', {
      notes: 'Meals already used in past weekly plans. The app excludes these from random picks until the pool runs out or they are reset. Add ids from recipes.json.',
      used: S.history
    });
  }

  async function importHistory(file) {
    try {
      var data = JSON.parse(await file.text());
      var used = Array.isArray(data) ? data : data.used;
      if (!Array.isArray(used) || !used.every(function (x) { return typeof x === 'string'; })) throw new Error('expected { "used": [ids] }');
      S.history = used.filter(function (id, i) { return used.indexOf(id) === i; });
      Store.setHistory(S.history);
      renderAll();
      toast('Imported ' + S.history.length + ' used meals');
    } catch (e) {
      toast('Couldn\'t read that file: ' + e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Dialog helpers, toast
  // ---------------------------------------------------------------------------

  function alertDialog(title, content, actions) {
    $('#alertTitle').textContent = title;
    var text = $('#alertText');
    text.innerHTML = '';
    if (typeof content === 'string') text.innerHTML = '<p>' + esc(content) + '</p>';
    else text.appendChild(content);
    var bar = $('#alertActions');
    bar.innerHTML = '';
    (actions.length ? actions : [{ label: 'Close' }]).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.cls || 'btn-ghost');
      b.textContent = a.label;
      b.addEventListener('click', function () { $('#alertDialog').close(); if (a.onClick) a.onClick(); });
      bar.appendChild(b);
    });
    if (!$('#alertDialog').open) $('#alertDialog').showModal();
  }

  function confirmDialog(title, text, okLabel, onOk) {
    alertDialog(title, text, [{ label: 'Cancel' }, { label: okLabel, cls: 'btn-danger', onClick: onOk }]);
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 3200);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  function bindStatic() {
    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { showTab(t.dataset.tab); }); });
    $('#startBtn').addEventListener('click', openWizard);
    $('#newPlanBtn').addEventListener('click', openWizard);
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="start"]')) openWizard();
      var close = e.target.closest('[data-close]');
      if (close) close.closest('dialog').close();
    });
    // Click on the dimmed backdrop closes a dialog.
    $$('dialog').forEach(function (dlg) {
      dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    });

    // Wizard
    $('#mealsMinus').addEventListener('click', function () { setMeals(S.draft.days.length - 1); renderWizard(); });
    $('#mealsPlus').addEventListener('click', function () { setMeals(S.draft.days.length + 1); renderWizard(); });
    $('#dayChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-daychip]');
      if (!b) return;
      var i = Number(b.dataset.daychip), days = S.draft.days, at = days.indexOf(i);
      if (at === -1) days.push(i); else days.splice(at, 1);
      days.sort(function (a, c) { return a - c; });
      renderWizard();
    });
    $('#weekStart').addEventListener('change', function (e) {
      if (!e.target.value) return;
      // Snap to the Monday of the chosen week.
      var p = e.target.value.split('-').map(Number);
      var dt = new Date(p[0], p[1] - 1, p[2]);
      dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
      S.draftWeek = P.isoDate(dt);
      renderWizard();
    });
    $('#servMinus').addEventListener('click', function () { S.draft.servings = Math.max(1, S.draft.servings - 1); renderWizard(); });
    $('#servPlus').addEventListener('click', function () { S.draft.servings = Math.min(12, S.draft.servings + 1); renderWizard(); });
    $('#poolSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pool]');
      if (b) { S.draft.pool = b.dataset.pool; renderWizard(); }
    });
    $('#mixMinus').addEventListener('click', function () { S.draft.mixType2 = Math.max(0, S.draft.mixType2 - 1); renderWizard(); });
    $('#mixPlus').addEventListener('click', function () { S.draft.mixType2 = Math.min(S.draft.days.length, S.draft.mixType2 + 1); renderWizard(); });
    $('#chefChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-chef]');
      if (!b) return;
      var all = P.allChefs(S.recipes);
      var sel = Array.isArray(S.draft.chefs) ? S.draft.chefs.slice() : all.slice();
      var at = sel.indexOf(b.dataset.chef);
      if (at === -1) sel.push(b.dataset.chef); else sel.splice(at, 1);
      S.draft.chefs = sel.length === all.length ? null : sel;
      renderWizard();
    });
    $('#mustGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-must]');
      if (!b) return;
      var c = b.dataset.must;
      var n = Math.max(0, Math.min(S.draft.days.length, (S.draft.mustHaves[c] || 0) + Number(b.dataset.delta)));
      if (n) S.draft.mustHaves[c] = n; else delete S.draft.mustHaves[c];
      renderWizard();
    });
    $('#excludeChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-ex]');
      if (!b) return;
      var at = S.draft.exclude.indexOf(b.dataset.ex);
      if (at === -1) S.draft.exclude.push(b.dataset.ex); else S.draft.exclude.splice(at, 1);
      renderWizard();
    });
    $('#vegOnly').addEventListener('change', function (e) { S.draft.vegetarianOnly = e.target.checked; renderWizard(); });
    $('#avoidRecent').addEventListener('change', function (e) { S.draft.avoidRecent = e.target.checked; renderWizard(); });
    $('#wizQuick').addEventListener('click', function () { S.wizStep = 2; $('#wizProblems').hidden = true; renderWizard(); });
    $('#wizBack').addEventListener('click', function () { S.wizStep = 1; $('#wizProblems').hidden = true; renderWizard(); });
    $('#wizNext').addEventListener('click', createPlanFromWizard);
    $('#wizardForm').addEventListener('submit', function (e) { e.preventDefault(); });

    // Week board
    $('#dayList').addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-swap]'))) swap(Number(b.dataset.swap));
      else if ((b = e.target.closest('[data-add]'))) swap(Number(b.dataset.add));
      else if ((b = e.target.closest('[data-lock]'))) {
        var slot = S.plan.slots[b.dataset.lock];
        slot.locked = !slot.locked;
        savePlan(false);
        renderWeek();
      } else if ((b = e.target.closest('[data-remove]'))) {
        delete S.plan.slots[b.dataset.remove];
        savePlan(true);
        renderAll();
      } else if ((b = e.target.closest('[data-view]'))) openRecipe(b.dataset.view);
    });
    $('#dayList').addEventListener('change', function (e) {
      var sel = e.target.closest('[data-pick]');
      if (!sel || !sel.value) return;
      var d = sel.dataset.pick;
      var dupDay = Object.keys(S.plan.slots).filter(function (k) { return k !== d && S.plan.slots[k].id === sel.value; })[0];
      if (dupDay != null) { toast('That recipe is already on ' + P.DAYS[dupDay]); sel.value = ''; return; }
      S.plan.slots[d] = { id: sel.value, locked: true }; // a hand-picked meal is locked so re-rolls keep it
      savePlan(true);
      renderAll();
      toast('Locked in ' + S.byId[sel.value].title + ' for ' + P.DAYS[d]);
    });
    $('#rerollBtn').addEventListener('click', rerollUnlocked);
    $('#confirmBtn').addEventListener('click', confirmWeek);
    $('#printPlannerBtn').addEventListener('click', function () { doPrint('planner'); });
    $('#printCardsBtn').addEventListener('click', function () { doPrint('cards'); });
    $('#inkSaver').addEventListener('change', function (e) {
      S.prefs.inkSaver = e.target.checked;
      Store.setPrefs(S.prefs);
      $('#previewStrip').classList.toggle('ink-saver', S.prefs.inkSaver);
    });

    // Shopping
    $('#shopList').addEventListener('change', function (e) {
      var cb = e.target.closest('[data-key]');
      if (!cb) return;
      if (cb.checked) S.shopping.ticks[cb.dataset.key] = true; else delete S.shopping.ticks[cb.dataset.key];
      Store.setShopping(S.shopping);
      renderShopping();
    });
    $('#extras').addEventListener('input', function (e) { S.shopping.extras = e.target.value; Store.setShopping(S.shopping); });
    $('#clearTicksBtn').addEventListener('click', function () { S.shopping.ticks = {}; Store.setShopping(S.shopping); renderShopping(); });
    $('#printShopBtn').addEventListener('click', function () { doPrint('shopping'); });

    // Recipes
    $('#recipeGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]');
      if (b) openRecipe(b.dataset.view);
    });
    $('#recipeSearch').addEventListener('input', function (e) { S.recipeQuery = e.target.value; renderRecipes(); });
    $('#recipeFilter').addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter]');
      if (!b) return;
      S.recipeFilter = b.dataset.filter;
      $$('#recipeFilter button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      renderRecipes();
    });
    $('#recipeView').addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-delete]'))) {
        var id = b.dataset.delete;
        $('#recipeDialog').close();
        confirmDialog('Delete this recipe?', 'It will be removed from your recipe pool on this device.', 'Delete', function () { deleteCustom(id); });
      } else if ((b = e.target.closest('[data-unuse]'))) {
        unuse(b.dataset.unuse);
        openRecipe(b.dataset.unuse);
        toast('Marked as not used');
      }
    });
    $('#exportRecipesBtn').addEventListener('click', exportRecipes);

    var dz = $('#dropzone');
    $('#txtInput').addEventListener('change', function (e) { handleFiles(e.target.files); e.target.value = ''; });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#txtInput').click(); } });

    // Drag & drop anywhere on the page
    var depth = 0;
    var hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; };
    window.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('#dropOverlay').hidden = false; });
    window.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) $('#dropOverlay').hidden = true; });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      $('#dropOverlay').hidden = true;
      handleFiles(e.dataTransfer.files);
    });

    // Import dialog
    $('#impType2').addEventListener('change', function (e) {
      $('#impT2Row').hidden = !e.target.checked;
      if (e.target.checked) $('#impChef').value = 'Type2';
    });
    $('#impProtein').addEventListener('click', function (e) {
      var b = e.target.closest('[data-prot]');
      if (!b) return;
      b.classList.toggle('is-on');
      b.setAttribute('aria-pressed', b.classList.contains('is-on'));
    });
    $('#importForm').addEventListener('submit', function (e) { e.preventDefault(); saveImport(); });
    $('#impSkip').addEventListener('click', function () { S.importQueue.shift(); showImport(); });
    $('#importDialog').addEventListener('close', function () { S.importQueue = []; });

    // History
    $('#historyList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-unuse]');
      if (b) unuse(b.dataset.unuse);
    });
    $('#resetHistoryBtn').addEventListener('click', function () {
      confirmDialog('Reset meal history?', 'Every recipe becomes available for random picks again. Export first if you want a copy.', 'Reset history', resetHistory);
    });
    $('#exportHistoryBtn').addEventListener('click', exportHistory);
    $('#importHistoryBtn').addEventListener('click', function () { $('#historyInput').click(); });
    $('#historyInput').addEventListener('change', function (e) { if (e.target.files[0]) importHistory(e.target.files[0]); e.target.value = ''; });

    // Printing via Ctrl+P prints whatever fits the current tab.
    window.addEventListener('beforeprint', function () {
      if (S.printPrepared) return;
      var tab = ($('.tab.is-active') || {}).dataset;
      preparePrint(tab && tab.tab === 'shop' && S.plan ? 'shopping' : 'planner');
    });
    window.addEventListener('afterprint', function () { S.printPrepared = false; });

    var resizeTimer;
    window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(scalePreviews, 100); });
  }
})();
