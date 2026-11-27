/* HomeMealPlanner - localStorage persistence. */
(function (root) {
  'use strict';

  var PREFIX = 'hmp.';
  var memory = {};
  var ephemeral = false; // demo mode: keep everything in memory only

  function read(key, fallback) {
    try {
      var raw = ephemeral ? memory[key] : root.localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    var raw = JSON.stringify(value);
    if (ephemeral) { memory[key] = raw; return; }
    try { root.localStorage.setItem(PREFIX + key, raw); } catch (e) { memory[key] = raw; }
  }

  function remove(key) {
    delete memory[key];
    if (!ephemeral) try { root.localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  }

  var Store = {
    setEphemeral: function (on) { ephemeral = !!on; },

    getSettings: function () { return read('settings', null); },
    setSettings: function (s) { write('settings', s); },

    /** History is seeded from data/history.json the first time the app runs. */
    hasHistory: function () { return read('history', null) !== null; },
    getHistory: function () { var h = read('history', null); return h && Array.isArray(h.used) ? h.used.slice() : []; },
    setHistory: function (ids) {
      var unique = ids.filter(function (id, i) { return id && ids.indexOf(id) === i; });
      write('history', { used: unique, updated: new Date().toISOString() });
    },

    getPlan: function () { return read('plan', null); },
    setPlan: function (p) { if (p) write('plan', p); else remove('plan'); },

    getCustomRecipes: function () { var c = read('custom', []); return Array.isArray(c) ? c : []; },
    setCustomRecipes: function (list) { write('custom', list); },

    getShopping: function () { return read('shopping', { ticks: {}, extras: '' }); },
    setShopping: function (s) { write('shopping', s); },

    getPrefs: function () { return read('prefs', { inkSaver: false }); },
    setPrefs: function (p) { write('prefs', p); }
  };

  root.Store = Store;
})(typeof self !== 'undefined' ? self : this);
