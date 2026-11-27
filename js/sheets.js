/* HomeMealPlanner - printable sheets (A4 planner, essentials page, recipe cards, shopping list). */
(function (root) {
  'use strict';
  var P = root.Planner;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Highlight uncertain transcriptions without changing their text. */
  function ingredientHtml(text) {
    var safe = esc(text);
    return /CHECK:/.test(text) ? '<span class="check-note" title="Uncertain transcription">' + safe + '</span>' : safe;
  }

  var FRUIT_RATIO = { orange: 0.56, melon: 0.56, apple: 1.12 };

  function fruit(kind, x, y, w, rot, cls) {
    var h = (w * FRUIT_RATIO[kind]).toFixed(1);
    return '<svg class="fruit ' + (cls || '') + '" style="left:' + x + 'mm;top:' + y + 'mm;width:' + w + 'mm;height:' + h + 'mm;transform:rotate(' + rot + 'deg)" aria-hidden="true"><use href="#f-' + kind + '"/></svg>';
  }

  function dots(x, y) {
    var out = '';
    var pts = [[0, 0], [3, 1.5], [1.5, 4], [5, 4.5], [6.5, 0.5], [3.5, 7]];
    pts.forEach(function (p) {
      out += '<i class="dot" style="left:' + (x + p[0]) + 'mm;top:' + (y + p[1]) + 'mm"></i>';
    });
    return out;
  }

  /** Scattered fruit, echoing the paper planner on the fridge. */
  function decor(variant) {
    var header = variant === 'b'
      ? fruit('apple', 118, 9, 22, -8) + fruit('orange', 146, 6, 26, 200) + fruit('melon', 176, 24, 30, 160) + fruit('orange', 104, 34, 18, 30)
      : fruit('orange', 112, 11, 26, 205) + fruit('apple', 140, 20, 21, 4) + fruit('orange', 170, 9, 25, 160) + fruit('melon', 184, 29, 30, 200);
    var edges =
      fruit('orange', -9, 72, 22, 75, 'edge') +
      fruit('melon', -12, 150, 26, 95, 'edge') +
      fruit('apple', -7, 228, 17, 12, 'edge') +
      fruit('melon', 197, 82, 26, 270, 'edge') +
      fruit('apple', 199, 168, 16, -10, 'edge') +
      fruit('orange', 196, 246, 22, 280, 'edge') +
      fruit('melon', 30, 289, 26, 0, 'edge') +
      fruit('orange', 92, 290, 20, 10, 'edge') +
      fruit('apple', 150, 286, 15, 0, 'edge');
    var spots = dots(96, 8) + dots(160, 40) + dots(188, 6) + dots(4, 40) + dots(200, 120) + dots(3, 196) + dots(120, 286) + dots(200, 214);
    return '<div class="sheet-decor">' + header + edges + spots + '</div>';
  }

  function formatWeek(weekStart) {
    if (!weekStart) return '';
    var d = P.dateForDay(weekStart, 0);
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function shortDate(weekStart, day) {
    if (!weekStart) return '';
    return P.dateForDay(weekStart, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function metaLine(r, servings) {
    var bits = [];
    if (r.chef) bits.push(r.chef);
    var mins = (r.prepMins || 0) + (r.cookMins || 0);
    if (mins) bits.push(mins + ' min');
    if (r.serves) bits.push('serves ' + r.serves);
    return bits.join(' · ');
  }

  function groupsHtml(groups, opts) {
    opts = opts || {};
    return groups.map(function (g) {
      return (g.section ? '<h4>' + esc(g.section) + '</h4>' : '') +
        '<ul>' + g.items.map(function (it) {
          var key = opts.keyPrefix ? opts.keyPrefix + it.index : null;
          return '<li' + (key ? ' data-key="' + esc(key) + '"' : '') + '>' + ingredientHtml(it.text) + '</li>';
        }).join('') + '</ul>';
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Page 1 - weekly planner
  // ---------------------------------------------------------------------------

  function plannerSheet(plan, byId, servings) {
    var rows = '';
    var blocks = '';
    for (var d = 0; d < 7; d++) {
      var slot = plan.slots[d];
      var r = slot && byId[slot.id];
      rows += '<div class="day-row' + (r ? '' : ' is-empty') + '">' +
        '<div class="day-name">' + P.DAYS[d] + '<span class="day-date">' + esc(shortDate(plan.weekStart, d)) + '</span></div>' +
        (r ? '<div class="day-meal">' + esc(r.title) + '</div><div class="day-meta">' + esc(metaLine(r, servings)) +
          (r.type2 ? ' <span class="t2">Type2</span>' : '') + '</div>' : '') +
        '</div>';
      if (r) {
        blocks += '<div class="ing-block"><h3><span class="ing-day">' + P.DAY_SHORT[d] + '</span>' + esc(r.title) + '</h3>' +
          groupsHtml(P.groupIngredients(r.ingredients)) + '</div>';
      }
    }
    return '<article class="sheet sheet-planner">' + decor('a') +
      '<header class="sheet-head"><h1 class="script">Weekly<br>Planner</h1>' +
      '<p class="sheet-week">Evening meals<b>' + esc(plan.weekStart ? 'w/c ' + formatWeek(plan.weekStart) : '') + '</b></p></header>' +
      '<div class="sheet-cols">' +
      '<section class="paper days">' + rows + '</section>' +
      '<section class="paper notes"><h2>Ingredients</h2><div class="ing-body"><div class="ing-flow">' + blocks +
      '</div><div class="ruled"></div></div></section>' +
      '</div></article>';
  }

  // ---------------------------------------------------------------------------
  // Page 2 - day-to-day essentials (back of the planner)
  // ---------------------------------------------------------------------------

  function essentialsSheet(items) {
    var list = (items || P.ESSENTIALS).map(function (name) {
      return '<li><span class="box"></span><span class="ess-name">' + esc(name) + '</span><span class="ess-line"></span></li>';
    }).join('');
    return '<article class="sheet sheet-essentials">' + decor('b') +
      '<header class="sheet-head"><h1 class="script">Day to Day<br>Essentials</h1>' +
      '<p class="sheet-week">Cross off as you go<b>Weekly shop</b></p></header>' +
      '<div class="sheet-cols">' +
      '<section class="paper ess"><ul class="ess-list">' + list + '</ul></section>' +
      '<section class="paper notes"><h2>Notes</h2><div class="ing-body"><div class="ruled"></div></div></section>' +
      '</div></article>';
  }

  /**
   * Shrink the ingredients column until it fits the A4 panel (2 columns if needed).
   * Must run while the sheet is in the DOM. Returns { fits, size, cols }.
   */
  function fitPlanner(sheet) {
    var body = sheet.querySelector('.sheet-planner .ing-body');
    var flow = body && body.querySelector('.ing-flow');
    if (!flow) return { fits: true };
    var avail = body.clientHeight * 0.97;
    var best = null;
    [1, 2].forEach(function (cols) {
      flow.style.columnCount = cols;
      for (var size = 9.5; size >= 5.5; size -= 0.25) {
        flow.style.fontSize = size + 'pt';
        if (flow.scrollHeight <= avail) {
          // Prefer one column unless two columns allow clearly bigger text.
          if (!best || size > best.size + (cols === 2 ? 0.75 : 0)) best = { fits: true, size: size, cols: cols };
          break;
        }
      }
    });
    if (!best) best = { fits: false, size: 5.5, cols: 2 };
    flow.style.columnCount = best.cols;
    flow.style.fontSize = best.size + 'pt';
    return best;
  }

  // ---------------------------------------------------------------------------
  // Recipe card (screen dialog + print)
  // ---------------------------------------------------------------------------

  function recipeCard(r, opts) {
    opts = opts || {};
    var meta = [];
    if (r.chef) meta.push('<span>' + esc(r.chef) + '</span>');
    if (r.serves) meta.push('<span>Serves ' + r.serves + '</span>');
    if (r.prepMins) meta.push('<span>Prep ' + r.prepMins + ' min</span>');
    if (r.cookMins) meta.push('<span>Cook ' + r.cookMins + ' min</span>');
    var note = P.servingsNote(r, opts.servings);
    var method = (r.method && r.method.length)
      ? '<ol class="rc-steps">' + r.method.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'
      : '<p class="rc-nomethod">No method saved for this one - ingredients only.</p>';
    var t2 = (r.type2 && (r.eat || r.limit))
      ? '<div class="rc-t2">' + (r.eat ? '<div><b>Eat</b><p>' + esc(r.eat) + '</p></div>' : '') +
        (r.limit ? '<div class="limit"><b>Limit</b><p>' + esc(r.limit) + '</p></div>' : '') + '</div>'
      : '';
    return '<article class="rcard">' +
      '<header>' + (opts.day != null ? '<p class="rc-day">' + P.DAYS[opts.day] + '</p>' : '') +
      '<h2>' + esc(r.title) + '</h2><p class="rc-meta">' + meta.join('') + '</p>' +
      (note ? '<p class="rc-warn">' + esc(note) + '</p>' : '') + '</header>' +
      '<div class="rc-body"><div class="rc-ing"><h3>Ingredients</h3>' + groupsHtml(P.groupIngredients(r.ingredients)) + '</div>' +
      '<div class="rc-method"><h3>Method</h3>' + method + '</div></div>' + t2 +
      (r.notes ? '<p class="rc-note">' + esc(r.notes) + '</p>' : '') +
      '</article>';
  }

  // ---------------------------------------------------------------------------
  // Shopping list (print)
  // ---------------------------------------------------------------------------

  function shoppingSheet(list, extras, weekStart) {
    var meals = list.map(function (m) {
      return '<section class="sp-meal"><h3><span class="ing-day">' + P.DAY_SHORT[m.day] + '</span>' + esc(m.recipe.title) + '</h3>' +
        m.groups.map(function (g) {
          return (g.section ? '<h4>' + esc(g.section) + '</h4>' : '') + '<ul>' + g.items.map(function (it) {
            return '<li><span class="box"></span>' + ingredientHtml(it.text) + '</li>';
          }).join('') + '</ul>';
        }).join('') + '</section>';
    }).join('');
    var ess = '<section class="sp-meal"><h3>Day to day essentials</h3><ul>' + P.ESSENTIALS.map(function (e) {
      return '<li><span class="box"></span>' + esc(e) + '</li>';
    }).join('') + '</ul></section>';
    var ex = extras && extras.trim()
      ? '<section class="sp-meal"><h3>Extras</h3><ul>' + extras.split(/\n+/).filter(Boolean).map(function (e) {
        return '<li><span class="box"></span>' + esc(e) + '</li>';
      }).join('') + '</ul></section>' : '';
    return '<div class="shop-print"><h1>Shopping list</h1><p class="sp-week">' + esc(weekStart ? 'Week of ' + formatWeek(weekStart) : '') + '</p>' +
      '<div class="sp-cols">' + meals + ess + ex + '</div></div>';
  }

  root.Sheets = {
    esc: esc,
    ingredientHtml: ingredientHtml,
    groupsHtml: groupsHtml,
    metaLine: metaLine,
    formatWeek: formatWeek,
    shortDate: shortDate,
    plannerSheet: plannerSheet,
    essentialsSheet: essentialsSheet,
    fitPlanner: fitPlanner,
    recipeCard: recipeCard,
    shoppingSheet: shoppingSheet
  };
})(typeof self !== 'undefined' ? self : this);
