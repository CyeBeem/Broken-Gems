/* Procedural world.

   The ground is one long heightfield, generated a band at a time as you drive.
   Every band picks a biome, writes its own height profile, then gets a slope
   clamp so the truck can always climb it. The only gaps in the ground are ones
   that come with a bridge, so the route is always navigable. */
window.JC = window.JC || {};
(function (JC) {
  "use strict";

  var STEP = 12;                 // heightfield sample spacing
  var MAX_SLOPE = 0.78;          // ~38 degrees, what the truck can climb
  var BASE = 0;                  // baseline ground height (y grows downward)

  JC.BIOMES = {
    plains:   { name: "Plains",       sky: ["#8FD4F5", "#D8F1FF"], grass: "#6FCF5F", dirt: "#A9703F", far: "#B7E4C7" },
    hills:    { name: "Rolling Hills",sky: ["#7EC8F0", "#CFECFF"], grass: "#63C755", dirt: "#9E6837", far: "#A9DCBB" },
    forest:   { name: "Deep Forest",  sky: ["#86D0F2", "#CDEFDC"], grass: "#4FB84A", dirt: "#7C5230", far: "#7FC48C" },
    mountain: { name: "Mountains",    sky: ["#A8DCF7", "#E8F6FF"], grass: "#8FB8A0", dirt: "#8A94A0", far: "#C6D8E6" },
    canyon:   { name: "Canyon",       sky: ["#FFC98A", "#FFE9C4"], grass: "#D08B54", dirt: "#B4703C", far: "#E8B58A" },
    falls:    { name: "Waterfalls",   sky: ["#8FD8F5", "#D6F3FF"], grass: "#55C48E", dirt: "#8FA4AE", far: "#96D8C0" },
    city:     { name: "City Outskirts", sky: ["#9AD4F0", "#DCEEFB"], grass: "#74C96A", dirt: "#6E7378", far: "#AEC6D8" },
    desert:   { name: "Dunes",        sky: ["#FFD79A", "#FFF0D0"], grass: "#EFCF7A", dirt: "#D8A85A", far: "#F3DCA8" },
    swamp:    { name: "Bogland",      sky: ["#B7D6A8", "#E2F0D8"], grass: "#6FA25C", dirt: "#6A5A3A", far: "#9FC08C" },
    course:   { name: "Obstacle Course", sky: ["#8FD4F5", "#E4F6FF"], grass: "#6FCF5F", dirt: "#A9703F", far: "#B7E4C7" }
  };

  var ORDER = ["plains", "hills", "forest", "course", "mountain", "canyon",
               "falls", "city", "desert", "swamp"];

  // ── terrain ───────────────────────────────────────────────────────────────
  JC.Terrain = function (seed) {
    this.seed = seed;
    this.rng = JC.rng(seed);
    this.n1 = JC.fbm(seed + 11, 4);
    this.n2 = JC.fbm(seed + 97, 3);
    this.h = [];                 // heights, index i -> world x = i * STEP
    this.gap = [];               // parallel flags: true where there is no ground
    this.bands = [];             // { x0, x1, biome }
    this.decor = [];             // visual only
    this.specs = [];             // physics structures waiting to spawn
    this.genI = 0;               // heightfield index generated up to
    this.lastBiome = null;
    this.bandCount = 0;

    // opening stretch: flat and calm, so the first seconds are readable
    this.pushBand("plains", 2600, true);
  };

  var T = JC.Terrain.prototype;

  T.worldX = function (i) { return i * STEP; };
  T.indexAt = function (x) { return Math.floor(x / STEP); };
  T.endX = function () { return this.genI * STEP; };

  T.heightAt = function (x) {
    var fi = x / STEP;
    var i = Math.floor(fi);
    if (i < 0) return this.h[0] !== undefined ? this.h[0] : BASE;
    if (i >= this.h.length - 1) return this.h[this.h.length - 1] || BASE;
    if (this.gap[i] || this.gap[i + 1]) return 100000;      // chasm
    return JC.lerp(this.h[i], this.h[i + 1], fi - i);
  };

  T.slopeAt = function (x) {
    var a = this.heightAt(x - 6), b = this.heightAt(x + 6);
    if (a > 90000 || b > 90000) return 0;
    return (b - a) / 12;
  };

  T.isGap = function (x) {
    var i = this.indexAt(x);
    return !!this.gap[i];
  };

  T.biomeAt = function (x) {
    for (var i = this.bands.length - 1; i >= 0; i--) {
      if (x >= this.bands[i].x0) return this.bands[i].biome;
    }
    return "plains";
  };

  T.bandAt = function (x) {
    for (var i = this.bands.length - 1; i >= 0; i--) {
      if (x >= this.bands[i].x0) return this.bands[i];
    }
    return this.bands[0];
  };

  /* Drop scenery that is far behind, so a long run does not keep paying to
     scan it every frame. Called with the camera position. */
  T.prune = function (behindX) {
    if (this.decor.length < 400) return;
    var keep = [];
    for (var i = 0; i < this.decor.length; i++) {
      if (this.decor[i].x > behindX) keep.push(this.decor[i]);
    }
    this.decor = keep;
  };

  /* Generate ahead of the camera. */
  T.ensure = function (x) {
    while (this.endX() < x + 3200) {
      var b = this.nextBiome();
      this.pushBand(b, this.rng.int(1400, 2800), false);
    }
  };

  T.nextBiome = function () {
    var pool = ORDER.filter(function (b) { return b !== this.lastBiome; }, this);
    // early on, stay gentle
    if (this.bandCount < 2) pool = ["plains", "hills", "forest"];
    else if (this.bandCount < 4) pool = ["plains", "hills", "forest", "course", "city"];
    return this.rng.pick(pool);
  };

  T.pushBand = function (biome, width, opening) {
    var x0 = this.endX();
    var count = Math.max(8, Math.round(width / STEP));
    var startY = this.h.length ? this.h[this.h.length - 1] : BASE;
    var gen = GEN[biome] || GEN.plains;

    var out = gen.call(this, count, startY, opening);
    // out: { hs: [...], gaps: [...], decor: [...], specs: [...] }

    var startIdx = this.h.length;
    for (var i = 0; i < out.hs.length; i++) {
      this.h.push(out.hs[i]);
      this.gap.push(!!(out.gaps && out.gaps[i]));
    }
    // smooth the new band together with the tail of the previous one, so the
    // seam between two biomes is climbable too
    smoothSlope(this.h, this.gap, Math.max(0, startIdx - 10), this.h.length);
    this.genI = this.h.length;

    var band = { x0: x0, x1: this.endX(), biome: biome };
    this.bands.push(band);
    this.bandCount++;
    this.lastBiome = biome;

    var self = this;
    (out.decor || []).forEach(function (d) { d.x += x0; self.decor.push(d); });
    (out.specs || []).forEach(function (s) {
      s.x += x0;
      if (s.x2 !== undefined) s.x2 += x0;        // spans need both ends offset
      self.specs.push(s);
    });
  };

  /* Clamp how steep any one step can be, so the truck can always make it.
     Runs to convergence rather than a fixed few passes — one big step needs
     many sweeps to spread out. Gap edges are skipped; those are meant to be
     cliffs, and they always come with a bridge. */
  function smoothSlope(hs, gaps, from, to) {
    var maxD = STEP * MAX_SLOPE * 0.95;          // a little headroom
    from = from || 0;
    to = to === undefined ? hs.length : to;
    for (var pass = 0; pass < 400; pass++) {
      var changed = false;
      for (var i = from; i < to - 1; i++) {
        if (gaps && (gaps[i] || gaps[i + 1])) continue;
        var d = hs[i + 1] - hs[i];
        if (Math.abs(d) <= maxD) continue;
        var fix = (Math.abs(d) - maxD) * 0.5 * JC.sign(d);
        // never move ground the player may already be standing on
        if (i > from) hs[i] += fix;
        hs[i + 1] -= (i > from ? fix : fix * 2);
        changed = true;
      }
      if (!changed) break;
    }

    /* Backstop. Relaxation is shape-preserving but not guaranteed to
       converge; this single forward pass is, so the climb limit always holds. */
    for (var j = from + 1; j < to; j++) {
      if (gaps && (gaps[j] || gaps[j - 1])) continue;
      var step = hs[j] - hs[j - 1];
      if (step > maxD) hs[j] = hs[j - 1] + maxD;
      else if (step < -maxD) hs[j] = hs[j - 1] - maxD;
    }
  }

  // ── biome generators ──────────────────────────────────────────────────────
  /* Each returns heights relative to nothing in particular — y grows down, so
     smaller numbers are higher ground. They all start from `startY` so bands
     join up seamlessly. */
  var GEN = {};

  GEN.plains = function (n, startY, opening) {
    var hs = [], decor = [], specs = [], r = this.rng, self = this;
    var base = startY;
    for (var i = 0; i < n; i++) {
      var t = i / n;
      var wobble = opening ? 0 : (this.n1(this.h.length * 0.012 + i * 0.012) - 0.5) * 90;
      var settle = i < 12 ? (1 - i / 12) : 0;                 // ease off the join
      hs.push(base + wobble * (1 - settle));
    }
    for (var d = 0; d < Math.floor(n / 9); d++) {
      var x = r.range(0, n * STEP);
      decor.push({ t: r.chance(0.6) ? "tree" : (r.chance(0.5) ? "bush" : "flower"), x: x, s: r.range(0.8, 1.3) });
    }
    if (!opening && r.chance(0.5)) {
      decor.push({ t: "windmill", x: r.range(200, n * STEP - 200), s: r.range(0.9, 1.4) });
    }
    if (!opening && r.chance(0.45)) {
      decor.push({ t: "fence", x: r.range(150, n * STEP - 300), s: 1, len: r.int(4, 9) });
    }
    if (!opening) addCrates.call(this, specs, n, 0.5, null, hs);
    return { hs: hs, decor: decor, specs: specs };
  };

  GEN.hills = function (n, startY) {
    var hs = [], decor = [], specs = [], r = this.rng;
    var f = r.range(0.02, 0.035), amp = r.range(110, 210);
    for (var i = 0; i < n; i++) {
      var v = Math.sin(i * f) * amp + (this.n1(i * 0.02 + this.h.length * 0.01) - 0.5) * 70;
      var settle = i < 14 ? (1 - i / 14) : 0;
      hs.push(startY + v * (1 - settle));
    }
    for (var d = 0; d < Math.floor(n / 11); d++) {
      decor.push({ t: r.chance(0.7) ? "tree" : "rock", x: r.range(0, n * STEP), s: r.range(0.8, 1.4) });
    }
    addCrates.call(this, specs, n, 0.6, null, hs);
    addPuzzle.call(this, specs, n, 0.26, null, hs);
    return { hs: hs, decor: decor, specs: specs };
  };

  GEN.forest = function (n, startY) {
    var hs = [], decor = [], specs = [], r = this.rng;
    for (var i = 0; i < n; i++) {
      var v = (this.n1(i * 0.018 + this.h.length * 0.01) - 0.5) * 150;
      var settle = i < 12 ? (1 - i / 12) : 0;
      hs.push(startY + v * (1 - settle));
    }
    for (var d = 0; d < Math.floor(n / 3.2); d++) {
      decor.push({ t: "pine", x: r.range(0, n * STEP), s: r.range(0.9, 1.9), back: r.chance(0.55) });
    }
    for (var m = 0; m < Math.floor(n / 14); m++) {
      decor.push({ t: "mushroom", x: r.range(0, n * STEP), s: r.range(0.7, 1.3) });
    }
    // fallen logs you can bump over
    var logs = r.int(1, 3);
    for (var l = 0; l < logs; l++) specs.push({ t: "log", x: r.range(200, n * STEP - 200) });
    addCrates.call(this, specs, n, 0.7, null, hs);
    addPuzzle.call(this, specs, n, 0.26, null, hs);
    return { hs: hs, decor: decor, specs: specs };
  };

  GEN.mountain = function (n, startY) {
    var hs = [], decor = [], specs = [], r = this.rng;
    var peak = r.range(0.42, 0.62);
    var height = r.range(420, 780);
    for (var i = 0; i < n; i++) {
      var t = i / n;
      // one big climb and descent, plus rocky detail
      var shape = t < peak ? (t / peak) : (1 - (t - peak) / (1 - peak));
      shape = Math.pow(JC.clamp(shape, 0, 1), 1.25);
      var detail = (this.n2(i * 0.05) - 0.5) * 60;
      var settle = i < 14 ? (1 - i / 14) : 0;
      hs.push(startY - (shape * height + detail) * (1 - settle));
    }
    for (var d = 0; d < Math.floor(n / 7); d++) {
      decor.push({ t: "rock", x: r.range(0, n * STEP), s: r.range(0.9, 2.0) });
    }
    decor.push({ t: "peak", x: n * STEP * peak, s: r.range(1.2, 2.0), back: true });
    decor.push({ t: "peak", x: n * STEP * peak - 420, s: r.range(0.8, 1.3), back: true });
    if (r.chance(0.6)) decor.push({ t: "cablecar", x: r.range(300, n * STEP - 300), s: 1, back: true });
    addCrates.call(this, specs, n, 0.5, null, hs);
    addPuzzle.call(this, specs, n, 0.26, null, hs);
    return { hs: hs, decor: decor, specs: specs };
  };

  GEN.canyon = function (n, startY) {
    var hs = [], gaps = [], decor = [], specs = [], r = this.rng;
    var gapStart = Math.floor(n * r.range(0.34, 0.44));
    var gapLen = r.int(16, 30);                    // ~190-360px chasm
    var gapEnd = gapStart + gapLen;

    for (var i = 0; i < n; i++) {
      var v = (this.n2(i * 0.03) - 0.5) * 70;
      var settle = i < 12 ? (1 - i / 12) : 0;
      hs.push(startY + v * (1 - settle));
      gaps.push(i > gapStart && i < gapEnd);
    }
    // flatten the two lips so the bridge sits level
    var lip = hs[gapStart];
    for (var k = gapStart - 4; k <= gapStart; k++) if (k >= 0) hs[k] = lip;
    for (var k2 = gapEnd; k2 <= gapEnd + 4 && k2 < n; k2++) hs[k2] = lip;

    specs.push({ t: "bridge", x: gapStart * STEP, x2: gapEnd * STEP, y: lip });
    decor.push({ t: "canyonwall", x: gapStart * STEP, w: gapLen * STEP, y: lip, back: true });

    for (var d = 0; d < 3; d++) {
      decor.push({ t: "mesa", x: r.range(0, n * STEP), s: r.range(1.5, 2.6),
                   back: true, depth: d });
    }
    var clear = [[(gapStart - 7) * STEP, (gapEnd + 7) * STEP]];
    addCrates.call(this, specs, n, 0.6, clear, hs);
    addPuzzle.call(this, specs, n, 0.22, clear, hs);
    return { hs: hs, gaps: gaps, decor: decor, specs: specs };
  };

  GEN.falls = function (n, startY) {
    var hs = [], decor = [], specs = [], r = this.rng;
    var dropAt = Math.floor(n * r.range(0.4, 0.55));
    var drop = r.range(180, 320);
    for (var i = 0; i < n; i++) {
      var t = JC.clamp((i - dropAt) / 14, 0, 1);
      var v = JC.smooth(t) * drop + (this.n1(i * 0.03) - 0.5) * 50;
      var settle = i < 12 ? (1 - i / 12) : 0;
      hs.push(startY + v * (1 - settle));
    }
    // a proper basin for the lake, gentle enough to drive out of
    var lakeAt = dropAt + 20, lakeLen = 24, deep = 44;
    for (var q = 0; q < lakeLen && lakeAt + q < n; q++) {
      hs[lakeAt + q] += Math.sin((q / lakeLen) * Math.PI) * deep;
    }
    decor.push({ t: "waterfall", x: (dropAt - 10) * STEP, back: true,
                 h: r.range(300, 430), w: r.range(26, 40) });
    decor.push({ t: "lake", x: (lakeAt + lakeLen / 2) * STEP,
                 w: lakeLen * STEP, deep: deep });
    for (var d = 0; d < Math.floor(n / 8); d++) {
      decor.push({ t: r.chance(0.5) ? "tree" : "rock", x: r.range(0, n * STEP), s: r.range(0.8, 1.5) });
    }

    addCrates.call(this, specs, n, 0.6, null, hs);
    return { hs: hs, decor: decor, specs: specs };
  };

  GEN.city = function (n, startY) {
    var hs = [], decor = [], specs = [], r = this.rng;
    for (var i = 0; i < n; i++) {
      var v = (this.n2(i * 0.01) - 0.5) * 40;
      var settle = i < 10 ? (1 - i / 10) : 0;
      hs.push(startY + v * (1 - settle));
    }
    var bx = 40;
    while (bx < n * STEP - 120) {
      decor.push({ t: "building", x: bx, w: r.range(90, 180), h: r.range(180, 520),
                   c: r.pick(["#E8C46A", "#E88A6A", "#8AB4E8", "#C8A0E8", "#7FD4C0"]),
                   back: true, far: r.chance(0.5) });
      bx += r.range(120, 240);
    }
    for (var s = 0; s < Math.floor(n / 12); s++) {
      decor.push({ t: "lamp", x: r.range(0, n * STEP), s: 1 });
    }
    // a couple of ramps through town
    var ramps = r.int(1, 3);
    for (var q = 0; q < ramps; q++) {
      carveRamp(hs, n, Math.floor(r.range(200, n * STEP - 600) / STEP),
                r.int(14, 19), r.range(38, 60), decor);
    }
    addCrates.call(this, specs, n, 0.9, null, hs);
    return { hs: hs, decor: decor, specs: specs };
  };

  GEN.desert = function (n, startY) {
    var hs = [], decor = [], specs = [], r = this.rng;
    var f = r.range(0.014, 0.024), amp = r.range(90, 170);
    for (var i = 0; i < n; i++) {
      var v = Math.sin(i * f) * amp + Math.sin(i * f * 2.7) * amp * 0.3;
      var settle = i < 12 ? (1 - i / 12) : 0;
      hs.push(startY + v * (1 - settle));
    }
    for (var d = 0; d < Math.floor(n / 10); d++) {
      decor.push({ t: r.chance(0.6) ? "cactus" : "rock", x: r.range(0, n * STEP), s: r.range(0.8, 1.5) });
      if (r.chance(0.25)) decor.push({ t: "mesa", x: r.range(0, n * STEP),
                                       s: r.range(1.4, 2.2), back: true, depth: r.int(0, 2) });
    }
    if (r.chance(0.5)) decor.push({ t: "skull", x: r.range(100, n * STEP - 100), s: 1 });
    addCrates.call(this, specs, n, 0.5, null, hs);
    addPuzzle.call(this, specs, n, 0.26, null, hs);
    return { hs: hs, decor: decor, specs: specs };
  };

  GEN.swamp = function (n, startY) {
    var hs = [], decor = [], specs = [], r = this.rng;
    for (var i = 0; i < n; i++) {
      var v = (this.n1(i * 0.025) - 0.5) * 110 + Math.sin(i * 0.07) * 22;
      var settle = i < 12 ? (1 - i / 12) : 0;
      hs.push(startY + v * (1 - settle));
    }
    var pools = r.int(2, 4);
    for (var p = 0; p < pools; p++) {
      var px0 = Math.floor(r.range(6, n - 30));
      var plen = r.int(12, 20), pdeep = r.range(22, 38);
      for (var pq = 0; pq < plen && px0 + pq < n; pq++) {
        hs[px0 + pq] += Math.sin((pq / plen) * Math.PI) * pdeep;
      }
      decor.push({ t: "lake", x: (px0 + plen / 2) * STEP, w: plen * STEP,
                   deep: pdeep, murk: true });
    }
    for (var d = 0; d < Math.floor(n / 6); d++) {
      decor.push({ t: r.chance(0.5) ? "reed" : "deadtree", x: r.range(0, n * STEP), s: r.range(0.8, 1.6) });
    }
    addCrates.call(this, specs, n, 0.7, null, hs);
    return { hs: hs, decor: decor, specs: specs };
  };

  GEN.course = function (n, startY) {
    var hs = [], decor = [], specs = [], r = this.rng;
    for (var i = 0; i < n; i++) {
      var settle = i < 10 ? (1 - i / 10) : 0;
      hs.push(startY + (this.n2(i * 0.015) - 0.5) * 40 * (1 - settle));
    }
    // a run of deliberate obstacles, spaced so momentum carries you through
    var x = 320;
    while (x < n * STEP - 260) {
      var pick = r.int(0, 3);
      if (pick === 0) carveRamp(hs, n, Math.floor(x / STEP), r.int(14, 20), r.range(40, 68), decor);
      else if (pick === 1) specs.push({ t: "seesaw", x: x, w: r.range(180, 260) });
      else if (pick === 2) specs.push({ t: "boulders", x: x, n: r.int(2, 4) });
      else decor.push({ t: "hoop", x: x, h: r.range(120, 190) });
      decor.push({ t: "cone", x: x - 40, s: 1 });
      decor.push({ t: "cone", x: x + 40, s: 1 });
      x += r.range(620, 900);
    }
    addCrates.call(this, specs, n, 1.0, null, hs);
    return { hs: hs, decor: decor, specs: specs };
  };

  /* A ramp shaped into the heightfield: a steady rise, then a short lip so
     you get a launch off the end. The slope clamp trims anything too steep to
     climb, so this can never become an impassable wall. */
  function carveRamp(hs, n, at, len, height, decor) {
    if (at < 2 || at + len + 6 >= n) return;
    for (var i = 0; i < len; i++) {
      hs[at + i] -= (i / len) * height;
    }
    for (var k = 0; k < 5 && at + len + k < n; k++) {
      hs[at + len + k] -= height * (1 - k / 5);       // the kicker
    }
    if (decor) {
      decor.push({ t: "cone", x: (at - 1) * STEP, s: 1 });
      decor.push({ t: "cone", x: (at + len + 5) * STEP, s: 1 });
    }
  }

  /* Scatter loose crates you can bump into and knock about. */
  function inAny(x, zones) {
    if (!zones) return false;
    for (var i = 0; i < zones.length; i++) {
      if (x > zones[i][0] && x < zones[i][1]) return true;
    }
    return false;
  }

  /* avoid is a list of world-x ranges to keep clear -- bridge mouths, mainly.
     A crate parked on a bridge lip wedges the truck against the chasm with
     nowhere left to go. */
  /* Too steep to shove something up, measured straight off the height field. */
  function steepAt(hs, x) {
    var i = Math.round(x / STEP);
    if (!hs || i < 1 || i >= hs.length) return 0;
    return Math.abs(hs[i] - hs[i - 1]) / STEP;
  }

  /* Keeps a new obstacle clear of the ones already placed, so a random cluster
     cannot pile into a wall the truck has no way past. */
  function roomFor(specs, x, gap) {
    for (var i = 0; i < specs.length; i++) {
      if (specs[i].x !== undefined && Math.abs(specs[i].x - x) < gap) return false;
    }
    return true;
  }

  function addCrates(specs, n, chance, avoid, hs) {
    if (!this.rng.chance(chance)) return;
    var count = this.rng.int(1, 4);
    for (var i = 0; i < count; i++) {
      for (var tries = 0; tries < 18; tries++) {
        var x = this.rng.range(150, n * STEP - 150);
        if (inAny(x, avoid)) continue;
        if (steepAt(hs, x) > 0.3) continue;          // would wall off a climb
        if (!roomFor(specs, x, 240)) continue;
        specs.push({ t: "crate", x: x });
        break;
      }
    }
  }

  /* One physics puzzle in a band, now and then. Every one is built from loose
     bodies you can shove, climb or smash, so none of them can seal the road
     off -- that is the whole reason they are bodies and not terrain. */
  var PUZZLES = ["stack", "dominoes", "pushball"];
  function addPuzzle(specs, n, chance, avoid, hs) {
    if (!this.rng.chance(chance)) return;
    for (var tries = 0; tries < 18; tries++) {
      var x = this.rng.range(600, n * STEP - 600);
      if (inAny(x, avoid)) continue;
      if (steepAt(hs, x) > 0.22) continue;          // wants somewhere workable
      if (!roomFor(specs, x, 420)) continue;
      specs.push({ t: this.rng.pick(PUZZLES), x: x, n: this.rng.int(3, 4) });
      return;
    }
  }

  // ── structure spawning ────────────────────────────────────────────────────
  /* Turns the queued specs into live physics bodies once they are close, and
     retires them once they are well behind. */
  JC.Structures = function (world, terrain) {
    this.world = world;
    this.terrain = terrain;
    this.live = [];
    this.next = 0;
  };

  JC.Structures.prototype.update = function (camX) {
    var t = this.terrain, w = this.world;
    while (this.next < t.specs.length && t.specs[this.next].x < camX + 1800) {
      var s = t.specs[this.next++];
      var made = this.build(s);
      if (made) this.live.push({ spec: s, bodies: made });
    }
    for (var i = this.live.length - 1; i >= 0; i--) {
      var L = this.live[i];
      if (L.spec.x < camX - 1600) {
        L.bodies.forEach(function (b) { w.remove(b); });
        this.live.splice(i, 1);
      }
    }
  };

  JC.Structures.prototype.build = function (s) {
    var t = this.terrain, w = this.world, out = [];
    var gy = t.heightAt(s.x);

    if (s.t === "crate") {
      var b = JC.makeJellyBox(s.x, gy - 26, 40, 40, { match: 0.3, color: "#C98A4B", kind: "prop", friction: 0.22 });
      b.userData.group = "prop";
      out.push(w.add(b));

    } else if (s.t === "log") {
      var lg = JC.makeJellyBox(s.x, gy - 22, 120, 34, { match: 0.42, color: "#8A5A32", kind: "prop", friction: 0.24 });
      lg.userData.group = "prop";
      out.push(w.add(lg));

    } else if (s.t === "boulders") {
      for (var i = 0; i < (s.n || 3); i++) {
        var r = 22 + (i % 2) * 8;
        var bl = JC.makeWheel(s.x + i * 62, gy - r - 4, r, 8,
          { match: 0.75, pressure: 0.5, color: "#9AA7B4", kind: "prop", friction: 0.2 });
        bl.userData.group = "prop";
        out.push(w.add(bl));
      }

    } else if (s.t === "stack") {
      // a tower of crates: barge through it, climb it, or hop it
      for (var st = 0; st < (s.n || 3); st++) {
        var sb = JC.makeJellyBox(s.x, gy - 25 - st * 40, 36, 36,
          { match: 0.32, color: "#C98A4B", kind: "prop", friction: 0.5 });
        sb.userData.group = "prop";
        out.push(w.add(sb));
      }

    } else if (s.t === "dominoes") {
      for (var dm = 0; dm < (s.n || 4); dm++) {
        var dxp = s.x + dm * 52;
        var db = JC.makeJellyBox(dxp, t.heightAt(dxp) - 46, 15, 80,
          { match: 0.55, color: "#B8A05A", kind: "prop", friction: 0.45 });
        db.userData.group = "prop";
        out.push(w.add(db));
      }

    } else if (s.t === "pushball") {
      // heavy, slow and very much in the way, but it always rolls
      var pb = JC.makeWheel(s.x, gy - 46, 42, 10,
        { match: 0.7, pressure: 0.55, color: "#7E8894", kind: "prop", friction: 0.3 });
      pb.userData.group = "prop";
      out.push(w.add(pb));

    } else if (s.t === "seesaw") {
      var half = (s.w || 220) / 2;
      var plank = JC.makeBox(s.x, gy - 34, s.w || 220, 16,
        { match: 0.95, color: "#D98A3C", kind: "prop", friction: 0.7 });
      // pin the middle so it pivots
      var mid = plank.add(s.x, gy - 26, 0);
      mid.m = 0; mid.inv = 0;
      plank.link(0, plank.pts.length - 1, 1);
      plank.link(2, plank.pts.length - 1, 1);
      plank.bake();
      plank.userData.group = "prop";
      out.push(w.add(plank));

    } else if (s.t === "bridge") {
      out = out.concat(this.buildBridge(s));

    }
    return out.length ? out : null;
  };

  /* A rope bridge: two slack cables plus planks slung between them. Verlet
     handles the sag for free, so it dips under the truck's weight. */
  JC.Structures.prototype.buildBridge = function (s) {
    var w = this.world, out = [];
    var x1 = s.x, x2 = s.x2, y = s.y;
    var span = x2 - x1;
    var segs = Math.max(7, Math.round(span / 30));
    var sag = Math.min(22, span * 0.045);   // deep enough to read as rope, shallow enough to drive out of

    var deck = JC.makeRope(x1, y, x2, y, segs, { color: "#7A4B28", mass: 2.4 });
    // start it sagging so it settles quickly rather than twanging
    for (var i = 1; i < deck.pts.length - 1; i++) {
      var t = i / segs;
      var d = Math.sin(t * Math.PI) * sag;
      deck.pts[i].y += d;
      deck.pts[i].py += d;
    }
    deck.friction = 0.85;
    deck.userData.group = "bridge";
    deck.userData.noSelf = true;
    out.push(w.add(deck));

    // planks ride the deck rope, giving the truck something solid underfoot
    for (var k = 0; k < segs; k++) {
      var a = deck.pts[k], b = deck.pts[k + 1];
      var plank = JC.makeBox((a.x + b.x) / 2, (a.y + b.y) / 2 - 5,
                             span / segs * 1.12, 12,
                             { match: 0.95, color: "#9A6438", kind: "plank", friction: 0.85 });
      plank.userData.group = "bridge";
      plank.userData.noSelf = true;
      plank.userData.noTerrain = true;
      plank.userData.rope = { body: deck, i: k };
      w.add(plank);
      out.push(plank);
    }

    // hand ropes, purely for looks
    var railY = y - 62;
    var rail = JC.makeRope(x1, railY, x2, railY, Math.max(5, Math.round(segs / 2)),
                           { color: "#6B4020", mass: 0.6 });
    rail.userData.group = "bridge";
    rail.userData.noSelf = true;
    rail.userData.decor = true;
    rail.userData.ghost = true;              // scenery: sags, but never collides
    rail.userData.noTerrain = true;
    rail.userData.posts = { x1: x1, x2: x2, deck: y, top: railY };
    out.push(w.add(rail));

    return out;
  };

  /* Keep planks stitched to their rope segment each frame. */
  JC.Structures.prototype.lashPlanks = function () {
    for (var i = 0; i < this.live.length; i++) {
      var bodies = this.live[i].bodies;
      for (var j = 0; j < bodies.length; j++) {
        var b = bodies[j];
        var r = b.userData.rope;
        if (!r) continue;
        var a = r.body.pts[r.i], c = r.body.pts[r.i + 1];
        /* The deck rope is anchored level with the lip at both ends, so
           hanging the plank 6px above it put a step in the road exactly where
           you drive on. Sit the plank just under the rope line instead and let
           it hang below, and the surface meets the ground flush. */
        lash(b.pts[0], a, 0, -1);
        lash(b.pts[3], a, 0, 11);
        lash(b.pts[1], c, 0, -1);
        lash(b.pts[2], c, 0, 11);
      }
    }
  };

  /* Two-way, so the weight of whatever is on the plank reaches the rope and
     the deck actually dips under the truck. */
  function lash(p, rp, ox, oy) {
    var dx = (rp.x + ox) - p.x, dy = (rp.y + oy) - p.y;
    p.x += dx * 0.45; p.y += dy * 0.45;
    if (rp.inv > 0) { rp.x -= dx * 0.16; rp.y -= dy * 0.16; }
  }

})(window.JC);
