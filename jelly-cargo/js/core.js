/* Jelly Cargo — shared helpers, RNG, input. */
window.JC = window.JC || {};
(function (JC) {
  "use strict";

  // ── math ──────────────────────────────────────────────────────────────────
  JC.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  JC.lerp = function (a, b, t) { return a + (b - a) * t; };
  JC.smooth = function (t) { return t * t * (3 - 2 * t); };
  JC.dist = function (ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); };
  JC.sign = function (v) { return v < 0 ? -1 : v > 0 ? 1 : 0; };

  JC.approach = function (v, target, rate) {
    if (v < target) return Math.min(target, v + rate);
    return Math.max(target, v - rate);
  };

  /* Angle difference wrapped to [-PI, PI]. */
  JC.angDiff = function (a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };

  // ── seeded rng (mulberry32) ───────────────────────────────────────────────
  JC.rng = function (seed) {
    var s = seed >>> 0;
    var f = function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = function (a, b) { return a + f() * (b - a); };
    f.int = function (a, b) { return Math.floor(a + f() * (b - a + 1)); };
    f.pick = function (arr) { return arr[Math.floor(f() * arr.length)]; };
    f.chance = function (p) { return f() < p; };
    f.shuffle = function (arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(f() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    };
    /* Pull `n` distinct entries, honouring an optional weight function. */
    f.sample = function (arr, n, weight) {
      var pool = arr.slice(), out = [];
      while (out.length < n && pool.length) {
        var total = 0, i;
        for (i = 0; i < pool.length; i++) total += weight ? Math.max(0.0001, weight(pool[i])) : 1;
        var r = f() * total, acc = 0, idx = 0;
        for (i = 0; i < pool.length; i++) {
          acc += weight ? Math.max(0.0001, weight(pool[i])) : 1;
          if (r <= acc) { idx = i; break; }
        }
        out.push(pool.splice(idx, 1)[0]);
      }
      return out;
    };
    return f;
  };

  // ── 1D value noise, for rolling terrain ───────────────────────────────────
  JC.noise = function (seed) {
    var r = JC.rng(seed);
    var table = [];
    for (var i = 0; i < 512; i++) table.push(r());
    return function (x) {
      var i0 = Math.floor(x), t = x - i0;
      var a = table[((i0 % 512) + 512) % 512];
      var b = table[(((i0 + 1) % 512) + 512) % 512];
      return JC.lerp(a, b, JC.smooth(t));
    };
  };

  /* Layered noise — the standard fBm stack. */
  JC.fbm = function (seed, octaves) {
    var layers = [];
    for (var i = 0; i < (octaves || 4); i++) layers.push(JC.noise(seed + i * 7919));
    return function (x) {
      var sum = 0, amp = 1, freq = 1, norm = 0;
      for (var i = 0; i < layers.length; i++) {
        sum += layers[i](x * freq) * amp;
        norm += amp;
        amp *= 0.5; freq *= 2.05;
      }
      return sum / norm;
    };
  };

  // ── colour ────────────────────────────────────────────────────────────────
  JC.shade = function (hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function f(c) {
      return Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
    }
    return "rgb(" + f(r) + "," + f(g) + "," + f(b) + ")";
  };

  JC.rgba = function (hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  };

  // ── input ─────────────────────────────────────────────────────────────────
  JC.Input = function (target) {
    var self = this;
    this.keys = {};
    this.mouse = { x: 0, y: 0, down: false };
    this.pressed = {};

    this._kd = function (e) {
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!self.keys[k]) self.pressed[k] = true;
      self.keys[k] = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Spacebar"].indexOf(e.key) !== -1) {
        e.preventDefault();
      }
    };
    this._ku = function (e) {
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      self.keys[k] = false;
    };
    this._mm = function (e) {
      var r = target.getBoundingClientRect();
      self.mouse.x = e.clientX - r.left;
      self.mouse.y = e.clientY - r.top;
    };
    this._md = function (e) { if (e.button === 0) self.mouse.down = true; };
    this._mu = function (e) { if (e.button === 0) self.mouse.down = false; };
    this._blur = function () { self.keys = {}; self.mouse.down = false; };

    window.addEventListener("keydown", this._kd);
    window.addEventListener("keyup", this._ku);
    target.addEventListener("mousemove", this._mm);
    target.addEventListener("mousedown", this._md);
    window.addEventListener("mouseup", this._mu);
    window.addEventListener("blur", this._blur);
    target.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  };

  JC.Input.prototype.held = function () {
    for (var i = 0; i < arguments.length; i++) if (this.keys[arguments[i]]) return true;
    return false;
  };

  JC.Input.prototype.tapped = function (k) {
    if (this.pressed[k]) { delete this.pressed[k]; return true; }
    return false;
  };

  JC.Input.prototype.endFrame = function () { this.pressed = {}; };

  JC.Input.prototype.destroy = function (target) {
    window.removeEventListener("keydown", this._kd);
    window.removeEventListener("keyup", this._ku);
    window.removeEventListener("mouseup", this._mu);
    window.removeEventListener("blur", this._blur);
    if (target) {
      target.removeEventListener("mousemove", this._mm);
      target.removeEventListener("mousedown", this._md);
    }
  };

})(window.JC);
