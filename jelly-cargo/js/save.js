/* Saving.

   Two separate things:
     - the run in progress, so closing the tab does not throw away a good haul
     - a profile of bests and lifetime totals that survives every run

   Both live in localStorage, and both can be exported as a text code you can
   paste into the game on another computer. There is no server anywhere. */
window.JC = window.JC || {};
(function (JC) {
  "use strict";

  var KEY_RUN = "brokengems.jellycargo.run";
  var KEY_META = "brokengems.jellycargo.profile";
  var VERSION = 1;

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function write(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); return true; }
    catch (e) { return false; }
  }

  JC.Save = {
    available: (function () {
      try {
        localStorage.setItem("brokengems.probe", "1");
        localStorage.removeItem("brokengems.probe");
        return true;
      } catch (e) { return false; }
    })(),

    // ── run in progress ─────────────────────────────────────────────────────
    /* The world is regenerated from the seed on load, so only the run's own
       state has to be written down. */
    snapshot: function (G) {
      return {
        v: VERSION,
        seed: G.seed,
        x: Math.round(G.truck.pos().x),
        distance: Math.round(G.distance),
        leg: G.leg,
        legStart: Math.round(G.legStart),
        legLen: Math.round(G.legLen),
        stopX: Math.round(G.stopX),
        pullsThisLeg: G.pullsThisLeg,
        pullCount: G.pullCount,
        gold: G.gold,
        kills: G.kills,
        time: Math.round(G.time),
        truckHp: Math.round(G.truckHp),
        cargoHp: Math.round(G.cargoHp),
        abilities: JSON.parse(JSON.stringify(G.abilities.owned)),
        order: G.abilities.order.slice(),
        gear: G.gear.map(function (g) {
          return g.kind === "stat"
            ? { kind: "stat", id: g.id, n: g.n, name: g.name }
            : { kind: "gear", id: g.id, mul: g.mul, gradeName: g.gradeName, name: g.name };
        }),
        crates: G.truck.crates.map(function (c) { return c.userData.cargo; }),
        saved: Date.now()
      };
    },

    saveRun: function (G) {
      if (!G || G.over) return false;
      return write(KEY_RUN, JC.Save.snapshot(G));
    },

    loadRun: function () {
      var s = read(KEY_RUN);
      if (!s || s.v !== VERSION) return null;
      return s;
    },

    hasRun: function () { return !!JC.Save.loadRun(); },

    clearRun: function () {
      try { localStorage.removeItem(KEY_RUN); } catch (e) {}
    },

    /* Rebuild a live game from a snapshot. Terrain comes back from the seed,
       then the truck is placed where it left off. */
    restore: function (G, s) {
      var i;

      G.terrain.ensure(s.x + 2600);
      var gy = G.terrain.heightAt(s.x);
      if (gy > 90000) {                        // landed on a chasm; back up
        for (i = 0; i < 400 && gy > 90000; i++) { s.x -= 24; gy = G.terrain.heightAt(s.x); }
      }

      var cur = G.truck.pos();
      var dx = s.x - cur.x, dy = (gy - 130) - cur.y;
      G.truck.chassis.translate(dx, dy);
      G.truck.wheels.forEach(function (w) { w.translate(dx, dy); });
      G.truck.chassis.pts.forEach(function (p) { p.px = p.x; p.py = p.y; });
      G.truck.wheels.forEach(function (w) {
        w.pts.forEach(function (p) { p.px = p.x; p.py = p.y; });
      });

      G.abilities.owned = JSON.parse(JSON.stringify(s.abilities || {}));
      G.abilities.order = (s.order || []).filter(function (id) { return JC.ABILITIES[id]; });
      G.gear = (s.gear || []).filter(function (g) {
        return g.kind === "stat" ? !!JC.statById(g.id) : !!JC.gearById(g.id);
      });

      G.leg = s.leg || 0;
      G.legStart = s.legStart || 0;
      G.legLen = s.legLen || G.legLen;
      G.stopX = s.stopX || (s.x + G.legLen);
      G.pullsThisLeg = s.pullsThisLeg || 0;
      G.pullCount = s.pullCount || 0;
      G.gold = s.gold || 0;
      G.kills = s.kills || 0;
      G.time = s.time || 0;
      G.distance = s.distance || 0;

      G.recomputeStats();

      // reload the bed
      G.truck.unloadAll();
      var crates = s.crates || [];
      for (i = 0; i < crates.length && i < G.stats.cargoSlots; i++) {
        G.truck.loadCrate(JC.CARGO[crates[i]] ? crates[i] : "boxes");
      }

      G.truckHp = JC.clamp(s.truckHp, 1, G.stats.truckHp);
      G.cargoHp = JC.clamp(s.cargoHp, 0, G.stats.cargoHp);
      G.renderer.cam.x = s.x;
      G.renderer.cam.y = gy - 130;
      return G;
    },

    // ── lifetime profile ────────────────────────────────────────────────────
    profile: function () {
      var p = read(KEY_META);
      if (!p || p.v !== VERSION) {
        p = { v: VERSION, runs: 0, bestDistance: 0, bestLeg: 0, bestKills: 0,
              totalKills: 0, totalGold: 0, totalDistance: 0, seen: {} };
      }
      return p;
    },

    recordRun: function (G) {
      var p = JC.Save.profile();
      p.runs++;
      p.bestDistance = Math.max(p.bestDistance, Math.round(G.distance));
      p.bestLeg = Math.max(p.bestLeg, G.leg);
      p.bestKills = Math.max(p.bestKills, G.kills);
      p.totalKills += G.kills;
      p.totalGold += G.gold;
      p.totalDistance += Math.round(G.distance);
      G.abilities.order.forEach(function (id) { p.seen[id] = true; });
      write(KEY_META, p);
      return p;
    },

    seenCount: function () { return Object.keys(JC.Save.profile().seen).length; },

    resetProfile: function () {
      try { localStorage.removeItem(KEY_META); } catch (e) {}
    },

    // ── transfer codes (this is how you move between computers) ─────────────
    toCode: function (obj) {
      var bytes = new TextEncoder().encode(JSON.stringify(obj));
      var bin = "";
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/=+$/, "");
    },

    fromCode: function (code) {
      try {
        var clean = String(code).replace(/\s+/g, "");
        var bin = atob(clean);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch (e) { return null; }
    },

    /* One code carrying both the run and the profile. */
    exportAll: function (G) {
      return JC.Save.toCode({
        v: VERSION,
        run: G && !G.over ? JC.Save.snapshot(G) : JC.Save.loadRun(),
        profile: JC.Save.profile()
      });
    },

    importAll: function (code) {
      var data = JC.Save.fromCode(code);
      if (!data || data.v !== VERSION) return { ok: false, why: "That code is not from this game." };
      if (data.profile) write(KEY_META, data.profile);
      if (data.run) write(KEY_RUN, data.run);
      return { ok: true, hasRun: !!data.run };
    }
  };

})(window.JC);
