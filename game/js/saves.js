/* Save slots. Everything lives in localStorage, keyed per browser. */
window.BG = window.BG || {};
(function (BG) {
  "use strict";

  var KEY = "brokengems.trainai.saves";

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;                  // private mode / sandboxed iframe
    }
  }

  BG.Saves = {
    available: (function () {
      try {
        localStorage.setItem("brokengems.probe", "1");
        localStorage.removeItem("brokengems.probe");
        return true;
      } catch (e) {
        return false;
      }
    })(),

    list: function () {
      return read().sort(function (a, b) { return b.updated - a.updated; });
    },

    get: function (id) {
      return read().filter(function (s) { return s.id === id; })[0] || null;
    },

    create: function (opts) {
      var list = read();
      var save = {
        id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: opts.name || "Save " + (list.length + 1),
        mode: opts.mode,                     // "campaign" | "infinite"
        section: opts.section || "maze",
        level: 1,
        cleared: 0,
        graphs: {},                          // level index -> graph JSON
        created: Date.now(),
        updated: Date.now()
      };
      list.push(save);
      write(list);
      return save;
    },

    save: function (save) {
      save.updated = Date.now();
      var list = read().filter(function (s) { return s.id !== save.id; });
      list.push(save);
      return write(list);
    },

    remove: function (id) {
      write(read().filter(function (s) { return s.id !== id; }));
    },

    /* Graphs are stored per level so an earlier solution is never lost.
       A new level starts from a copy of the previous level's code. */
    graphFor: function (save, level) {
      if (save.graphs[level]) return BG.clone(save.graphs[level]);
      for (var l = level - 1; l >= 1; l--) {
        if (save.graphs[l]) return BG.clone(save.graphs[l]);
      }
      return BG.newGraph();
    },

    putGraph: function (save, level, graph) {
      save.graphs[level] = BG.clone(graph);
      BG.Saves.save(save);
    }
  };

})(window.BG);
