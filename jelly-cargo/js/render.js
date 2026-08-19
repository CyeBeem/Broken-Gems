/* Rendering + particles.

   Bright, saturated, flat fills with heavy dark outlines — the Jelly Truck
   look. Soft bodies are drawn as smooth curves through their point masses so
   the wobble actually reads. */
window.JC = window.JC || {};
(function (JC) {
  "use strict";

  var INK = "#2B2A38";

  // ── particle system ───────────────────────────────────────────────────────
  JC.FX = function () {
    this.p = [];
    this.bolts = [];
    this.rings = [];
    this.orbs = [];
    this.texts = [];
  };

  var F = JC.FX.prototype;

  F.spawn = function (x, y, vx, vy, life, color, size, grav) {
    if (this.p.length > 500) return;
    this.p.push({ x: x, y: y, vx: vx, vy: vy, t: life, max: life,
                  c: color, s: size, g: grav === undefined ? 1 : grav });
  };

  F.burst = function (x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, sp = 60 + Math.random() * 240;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp,
                 0.4 + Math.random() * 0.5, color, 3 + Math.random() * 4, 1);
    }
  };

  F.puff = function (x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, sp = 20 + Math.random() * 70;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 40,
                 0.5 + Math.random() * 0.6, color, 5 + Math.random() * 7, -0.15);
    }
  };

  F.hit = function (x, y, n) {
    for (var i = 0; i < 3; i++) {
      var a = Math.random() * 6.283;
      this.spawn(x, y, Math.cos(a) * 120, Math.sin(a) * 120, 0.25, "#FFF2C4", 3, 0.4);
    }
  };

  F.trail = function (x, y, color) {
    this.spawn(x, y, (Math.random() - 0.5) * 40, -20 - Math.random() * 40,
               0.5, color, 4 + Math.random() * 5, -0.2);
  };

  F.bolt = function (x1, y1, x2, y2) { this.bolts.push({ x1: x1, y1: y1, x2: x2, y2: y2, t: 0.18 }); };
  F.ring = function (x, y, r, c) { this.rings.push({ x: x, y: y, r: r, t: 0.4, c: c }); };
  F.orb = function (x, y, c, r) { this.orbs.push({ x: x, y: y, c: c, r: r, t: 0.05 }); };
  F.text = function (x, y, s, c) { this.texts.push({ x: x, y: y, s: s, c: c, t: 1.1 }); };

  F.update = function (dt) {
    var i;
    for (i = this.p.length - 1; i >= 0; i--) {
      var q = this.p[i];
      q.t -= dt;
      if (q.t <= 0) { this.p.splice(i, 1); continue; }
      q.vy += 900 * q.g * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
    for (i = this.bolts.length - 1; i >= 0; i--) if ((this.bolts[i].t -= dt) <= 0) this.bolts.splice(i, 1);
    for (i = this.rings.length - 1; i >= 0; i--) if ((this.rings[i].t -= dt) <= 0) this.rings.splice(i, 1);
    for (i = this.orbs.length - 1; i >= 0; i--) if ((this.orbs[i].t -= dt) <= 0) this.orbs.splice(i, 1);
    for (i = this.texts.length - 1; i >= 0; i--) {
      var t = this.texts[i];
      t.t -= dt; t.y -= 40 * dt;
      if (t.t <= 0) this.texts.splice(i, 1);
    }
  };

  // ── shape helpers ─────────────────────────────────────────────────────────
  /* Smooth closed curve through a body's points — this is what sells jelly. */
  function blobPath(ctx, pts, idx) {
    var n = idx.length;
    ctx.beginPath();
    var p0 = pts[idx[0]], pl = pts[idx[n - 1]];
    ctx.moveTo((pl.x + p0.x) / 2, (pl.y + p0.y) / 2);
    for (var i = 0; i < n; i++) {
      var cur = pts[idx[i]], nxt = pts[idx[(i + 1) % n]];
      ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + nxt.x) / 2, (cur.y + nxt.y) / 2);
    }
    ctx.closePath();
  }
  JC.blobPath = blobPath;

  /* Straight edges with small rounded corners, tracking the live point
     positions — keeps a truck looking like a truck while it squashes. */
  function firmPath(ctx, pts, idx, r) {
    var n = idx.length;
    function along(from, to) {
      var dx = to.x - from.x, dy = to.y - from.y;
      var d = Math.hypot(dx, dy) || 1;
      var k = Math.min(r, d * 0.42) / d;
      return { x: from.x + dx * k, y: from.y + dy * k };
    }
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var cur = pts[idx[i]];
      var prev = pts[idx[(i - 1 + n) % n]];
      var next = pts[idx[(i + 1) % n]];
      var a = along(cur, prev), b = along(cur, next);
      if (i === 0) ctx.moveTo(a.x, a.y); else ctx.lineTo(a.x, a.y);
      ctx.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
    }
    ctx.closePath();
  }
  JC.firmPath = firmPath;

  function fillBlob(ctx, body, fill, lw) {
    blobPath(ctx, body.pts, body.hull.length ? body.hull : body.pts.map(function (_, i) { return i; }));
    ctx.fillStyle = fill || body.color;
    ctx.fill();
    ctx.lineWidth = lw || 4;
    ctx.strokeStyle = INK;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  JC.rr = rr;

  // ── renderer ──────────────────────────────────────────────────────────────
  JC.Renderer = function (canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.cam = { x: 0, y: 0, z: 0.82, shake: 0 };
    this.w = 0; this.h = 0;
  };

  var R = JC.Renderer.prototype;

  R.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = this.c.clientWidth, h = this.c.clientHeight;
    if (!w || !h) return;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.w = w; this.h = h;
  };

  R.follow = function (tx, ty, vx, dt) {
    var lead = JC.clamp(vx * 64, -240, 300);
    this.cam.x = JC.lerp(this.cam.x, tx + lead, 1 - Math.pow(0.0015, dt));
    this.cam.y = JC.lerp(this.cam.y, ty - 40, 1 - Math.pow(0.004, dt));
    if (this.cam.shake > 0) this.cam.shake = Math.max(0, this.cam.shake - dt * 40);
  };

  R.screenToWorld = function (sx, sy) {
    return { x: (sx - this.w / 2) / this.cam.z + this.cam.x,
             y: (sy - this.h / 2) / this.cam.z + this.cam.y };
  };

  R.begin = function () {
    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
  };

  R.world = function () {
    var ctx = this.ctx, s = this.cam.shake;
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-this.cam.x + (Math.random() - 0.5) * s, -this.cam.y + (Math.random() - 0.5) * s);
  };

  R.end = function () { this.ctx.restore(); };

  R.viewLeft = function () { return this.cam.x - this.w / 2 / this.cam.z - 120; };
  R.viewRight = function () { return this.cam.x + this.w / 2 / this.cam.z + 120; };

  // ── sky and background ────────────────────────────────────────────────────
  R.drawSky = function (terrain) {
    var ctx = this.ctx;
    var b = JC.BIOMES[terrain.biomeAt(this.cam.x)] || JC.BIOMES.plains;
    var g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, b.sky[0]);
    g.addColorStop(1, b.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // sun
    ctx.fillStyle = "rgba(255,246,200,0.85)";
    ctx.beginPath();
    ctx.arc(this.w * 0.78, this.h * 0.16, 46, 0, 6.283);
    ctx.fill();

    // parallax clouds
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (var i = 0; i < 9; i++) {
      var cx = ((i * 620 - this.cam.x * 0.12) % (this.w + 700)) - 200;
      var cy = 40 + ((i * 137) % 190);
      cloud(ctx, cx, cy, 26 + (i % 3) * 12);
    }
    return b;
  };

  function cloud(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.283);
    ctx.arc(x + r * 0.9, y + 6, r * 0.78, 0, 6.283);
    ctx.arc(x - r * 0.9, y + 8, r * 0.68, 0, 6.283);
    ctx.arc(x + r * 0.1, y - r * 0.55, r * 0.7, 0, 6.283);
    ctx.fill();
  }

  /* Rolling hills behind everything, at two parallax depths. */
  R.drawFar = function (terrain, biome) {
    var ctx = this.ctx;
    var layers = [{ p: 0.25, y: 0.62, a: 0.45, s: 150 }, { p: 0.45, y: 0.72, a: 0.7, s: 100 }];
    for (var l = 0; l < layers.length; l++) {
      var L = layers[l];
      ctx.fillStyle = JC.rgba(hexOf(biome.far), L.a);
      ctx.beginPath();
      ctx.moveTo(0, this.h);
      for (var x = 0; x <= this.w; x += 24) {
        var wx = (this.cam.x * L.p + x) * 0.01;
        var y = this.h * L.y - Math.sin(wx) * L.s - Math.sin(wx * 2.3) * L.s * 0.4;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(this.w, this.h);
      ctx.closePath();
      ctx.fill();
    }
  };

  function hexOf(c) { return c.charAt(0) === "#" ? c : "#B7E4C7"; }

  // ── terrain ───────────────────────────────────────────────────────────────
  R.drawTerrain = function (terrain) {
    var ctx = this.ctx;
    var x0 = this.viewLeft(), x1 = this.viewRight();
    var i0 = Math.max(0, terrain.indexAt(x0));
    var i1 = Math.min(terrain.h.length - 1, terrain.indexAt(x1) + 2);
    if (i1 <= i0) return;

    var bottom = this.cam.y + this.h / this.cam.z + 400;
    var run = [];

    for (var i = i0; i <= i1; i++) {
      if (terrain.gap[i]) {
        if (run.length > 1) this.paintGround(run, bottom, terrain);
        run = [];
        continue;
      }
      run.push({ x: i * 12, y: terrain.h[i], i: i });
    }
    if (run.length > 1) this.paintGround(run, bottom, terrain);
  };

  R.paintGround = function (run, bottom, terrain) {
    var ctx = this.ctx;
    var mid = run[Math.floor(run.length / 2)];
    var b = JC.BIOMES[terrain.biomeAt(mid.x)] || JC.BIOMES.plains;

    ctx.beginPath();
    ctx.moveTo(run[0].x, run[0].y);
    for (var i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
    ctx.lineTo(run[run.length - 1].x, bottom);
    ctx.lineTo(run[0].x, bottom);
    ctx.closePath();
    ctx.fillStyle = b.dirt;
    ctx.fill();

    // grass cap
    ctx.beginPath();
    ctx.moveTo(run[0].x, run[0].y);
    for (var j = 1; j < run.length; j++) ctx.lineTo(run[j].x, run[j].y);
    ctx.lineWidth = 22;
    ctx.strokeStyle = b.grass;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(run[0].x, run[0].y - 11);
    for (var k = 1; k < run.length; k++) ctx.lineTo(run[k].x, run[k].y - 11);
    ctx.stroke();
  };

  // ── decor ─────────────────────────────────────────────────────────────────
  R.drawDecor = function (terrain, back) {
    var ctx = this.ctx;
    var x0 = this.viewLeft() - 300, x1 = this.viewRight() + 300;
    for (var i = 0; i < terrain.decor.length; i++) {
      var d = terrain.decor[i];
      if (d.x < x0 || d.x > x1) continue;
      if (!!d.back !== !!back) continue;
      var gy = terrain.heightAt(d.x);
      if (gy > 90000) continue;               // nothing to stand on
      d._terrain = terrain;                   // some props trace the ground
      this.drawProp(d, gy);
    }
  };

  R.drawProp = function (d, gy) {
    var ctx = this.ctx;
    var s = d.s || 1;
    ctx.save();
    ctx.translate(d.x, gy);
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.lineJoin = "round";

    switch (d.t) {
      case "tree": {
        trunk(ctx, 10 * s, 46 * s);
        var R0 = 32 * s, lumps = 9, wob = d.x * 0.05;
        ctx.fillStyle = "#54B84F";
        ctx.beginPath();
        for (var li = 0; li <= lumps; li++) {
          var ang = Math.PI * 2 * (li / lumps) - Math.PI / 2;
          var rr0 = R0 * (0.82 + 0.24 * Math.abs(Math.sin(li * 2.3 + wob)));
          var px = Math.cos(ang) * rr0 * 1.15;
          var py = -60 * s + Math.sin(ang) * rr0 * 0.84;
          if (li === 0) ctx.moveTo(px, py);
          else ctx.quadraticCurveTo(
            Math.cos(ang - 0.33) * rr0 * 1.34,
            -60 * s + Math.sin(ang - 0.33) * rr0 * 1.0, px, py);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.beginPath(); ctx.arc(-R0 * 0.3, -72 * s, R0 * 0.4, 0, 6.283); ctx.fill();
        break;
      }
      case "pine":
        trunk(ctx, 8 * s, 30 * s);
        ctx.fillStyle = d.back ? "#3E9A48" : "#47A94F";
        for (var k = 0; k < 3; k++) {
          var yy = -28 * s - k * 26 * s, ww = (36 - k * 8) * s;
          ctx.beginPath();
          ctx.moveTo(-ww, yy); ctx.lineTo(ww, yy); ctx.lineTo(0, yy - 40 * s);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        break;
      case "deadtree": {
        ctx.fillStyle = "#6E5C3E";
        ctx.strokeStyle = INK; ctx.lineWidth = 3.5;
        // tapered trunk
        ctx.beginPath();
        ctx.moveTo(-7 * s, 0);
        ctx.quadraticCurveTo(-5 * s, -40 * s, -3.5 * s, -78 * s);
        ctx.lineTo(3.5 * s, -78 * s);
        ctx.quadraticCurveTo(5.5 * s, -40 * s, 7 * s, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // a few crooked limbs that taper as they go
        ctx.strokeStyle = "#6E5C3E";
        ctx.lineCap = "round";
        [[-1, 0.55, 30], [1, 0.72, 26], [-1, 0.86, 18]].forEach(function (L) {
          var by = -78 * s * L[1];
          ctx.lineWidth = 5.5 * s;
          ctx.beginPath();
          ctx.moveTo(0, by);
          ctx.quadraticCurveTo(L[0] * L[2] * 0.6 * s, by - 8 * s,
                               L[0] * L[2] * s, by - 20 * s);
          ctx.stroke();
          ctx.lineWidth = 3 * s;
          ctx.beginPath();
          ctx.moveTo(L[0] * L[2] * s, by - 20 * s);
          ctx.lineTo(L[0] * L[2] * 1.4 * s, by - 34 * s);
          ctx.stroke();
        });
        ctx.lineCap = "butt";
        break;
      }
      case "bush": {
        var BR = 19 * s, bl = 8, bw = d.x * 0.07;
        ctx.fillStyle = "#5FC456";
        ctx.beginPath();
        for (var bi = 0; bi <= bl; bi++) {
          var ba = Math.PI * 2 * (bi / bl) - Math.PI / 2;
          var br0 = BR * (0.78 + 0.3 * Math.abs(Math.sin(bi * 1.9 + bw)));
          var bx = Math.cos(ba) * br0 * 1.45;          // wider than tall
          var by = -13 * s + Math.sin(ba) * br0 * 0.72;
          if (bi === 0) ctx.moveTo(bx, by);
          else ctx.quadraticCurveTo(
            Math.cos(ba - 0.36) * br0 * 1.62,
            -13 * s + Math.sin(ba - 0.36) * br0 * 0.86, bx, by);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.beginPath();
        ctx.ellipse(-BR * 0.35, -20 * s, BR * 0.5, BR * 0.26, 0, 0, 6.283);
        ctx.fill();
        break;
      }
      case "flower":
        ctx.strokeStyle = "#3E9A48"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -18 * s); ctx.stroke();
        ctx.fillStyle = ["#FF6B8A", "#FFD24F", "#B08FE8"][Math.floor(d.x) % 3];
        ctx.beginPath(); ctx.arc(0, -22 * s, 7 * s, 0, 6.283); ctx.fill();
        break;
      case "mushroom":
        ctx.fillStyle = "#F2EFE4";
        ctx.fillRect(-4 * s, -16 * s, 8 * s, 16 * s);
        ctx.fillStyle = "#E85A5A";
        ctx.beginPath(); ctx.arc(0, -16 * s, 13 * s, Math.PI, 0); ctx.fill(); ctx.stroke();
        break;
      case "rock":
        ctx.fillStyle = "#9AA7B4";
        ctx.beginPath();
        ctx.moveTo(-20 * s, 0); ctx.lineTo(-12 * s, -20 * s);
        ctx.lineTo(8 * s, -24 * s); ctx.lineTo(22 * s, -6 * s);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case "cactus":
        ctx.fillStyle = "#4FA85F";
        rr(ctx, -9 * s, -70 * s, 18 * s, 70 * s, 9 * s); ctx.fill(); ctx.stroke();
        rr(ctx, -30 * s, -52 * s, 14 * s, 32 * s, 7 * s); ctx.fill(); ctx.stroke();
        break;
      case "reed":
        ctx.strokeStyle = "#7FA84F"; ctx.lineWidth = 4;
        for (var rr2 = -2; rr2 <= 2; rr2++) {
          ctx.beginPath();
          ctx.moveTo(rr2 * 6 * s, 0);
          ctx.quadraticCurveTo(rr2 * 10 * s, -30 * s, rr2 * 16 * s, -46 * s);
          ctx.stroke();
        }
        break;
      case "skull":
        ctx.fillStyle = "#EFE9DC";
        ctx.beginPath(); ctx.arc(0, -14 * s, 14 * s, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.arc(-5 * s, -16 * s, 3.5 * s, 0, 6.283);
        ctx.arc(5 * s, -16 * s, 3.5 * s, 0, 6.283); ctx.fill();
        break;
      case "hoop":
        ctx.strokeStyle = "#E8574F";
        ctx.lineWidth = 11;
        ctx.beginPath();
        ctx.arc(0, 0, d.h * 0.55, Math.PI, 0);
        ctx.stroke();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, d.h * 0.55 + 5.5, Math.PI, 0);
        ctx.arc(0, 0, d.h * 0.55 - 5.5, 0, Math.PI, true);
        ctx.stroke();
        break;
      case "cone":
        ctx.fillStyle = "#FF7A3C";
        ctx.beginPath();
        ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.lineTo(0, -30);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case "lamp":
        ctx.strokeStyle = INK; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -96); ctx.lineTo(20, -104); ctx.stroke();
        ctx.fillStyle = "#FFE9A0";
        ctx.beginPath(); ctx.arc(24, -104, 10, 0, 6.283); ctx.fill(); ctx.stroke();
        break;
      case "fence":
        ctx.strokeStyle = "#B98A50"; ctx.lineWidth = 6;
        for (var fp = 0; fp < (d.len || 5); fp++) {
          var fx = fp * 34;
          ctx.beginPath(); ctx.moveTo(fx, 0); ctx.lineTo(fx, -38); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo((d.len || 5) * 34 - 34, -26); ctx.stroke();
        break;
      case "windmill":
        ctx.fillStyle = "#EFE4CE";
        ctx.beginPath();
        ctx.moveTo(-24 * s, 0); ctx.lineTo(-15 * s, -110 * s);
        ctx.lineTo(15 * s, -110 * s); ctx.lineTo(24 * s, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        var ang = performance.now() / 900 + d.x;
        ctx.save();
        ctx.translate(0, -110 * s);
        ctx.rotate(ang);
        ctx.fillStyle = "#E8574F";
        for (var bl = 0; bl < 4; bl++) {
          ctx.rotate(Math.PI / 2);
          ctx.beginPath(); rr(ctx, 6 * s, -5 * s, 54 * s, 11 * s, 5); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
        break;
      case "building":
        ctx.fillStyle = d.far ? JC.shade(d.c, -0.3) : d.c;
        ctx.fillRect(0, -d.h, d.w, d.h);
        ctx.strokeRect(0, -d.h, d.w, d.h);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        for (var wy = -d.h + 26; wy < -30; wy += 42) {
          for (var wx = 14; wx < d.w - 20; wx += 38) ctx.fillRect(wx, wy, 20, 24);
        }
        break;
      case "peak": {
        var H = 300 * s, W = 190 * s;
        ctx.fillStyle = "rgba(176,199,219,0.5)";
        ctx.beginPath();
        ctx.moveTo(-W, 60); ctx.lineTo(-W * 0.22, -H * 0.72);
        ctx.lineTo(0, -H); ctx.lineTo(W * 0.30, -H * 0.66);
        ctx.lineTo(W, 60);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.beginPath();
        ctx.moveTo(-W * 0.30, -H * 0.60); ctx.lineTo(-W * 0.22, -H * 0.72);
        ctx.lineTo(0, -H); ctx.lineTo(W * 0.30, -H * 0.66);
        ctx.lineTo(W * 0.18, -H * 0.56); ctx.lineTo(W * 0.04, -H * 0.70);
        ctx.lineTo(-W * 0.12, -H * 0.56);
        ctx.closePath(); ctx.fill();
        break;
      }
      case "mesa": {
        var dep = d.depth || 0;
        var fade = 0.62 - dep * 0.15;
        var mh = 130 * s * (1 - dep * 0.16), mw = 78 * s;
        ctx.fillStyle = "rgba(186,110,66," + fade.toFixed(2) + ")";
        ctx.beginPath();
        ctx.moveTo(-mw, 40);
        ctx.lineTo(-mw * 0.80, -mh * 0.62);
        ctx.lineTo(-mw * 0.66, -mh);
        ctx.lineTo(mw * 0.66, -mh);
        ctx.lineTo(mw * 0.80, -mh * 0.62);
        ctx.lineTo(mw, 40);
        ctx.closePath(); ctx.fill();
        // lit cap and a shaded flank, so it has some form
        ctx.fillStyle = "rgba(226,158,104," + (fade * 0.7).toFixed(2) + ")";
        ctx.beginPath();
        ctx.moveTo(-mw * 0.66, -mh); ctx.lineTo(mw * 0.66, -mh);
        ctx.lineTo(mw * 0.58, -mh * 0.9); ctx.lineTo(-mw * 0.58, -mh * 0.9);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(120,66,40," + (fade * 0.35).toFixed(2) + ")";
        ctx.beginPath();
        ctx.moveTo(mw * 0.66, -mh); ctx.lineTo(mw * 0.80, -mh * 0.62);
        ctx.lineTo(mw, 40); ctx.lineTo(mw * 0.5, 40);
        ctx.closePath(); ctx.fill();
        break;
      }
      case "waterfall": {
        var fh = d.h, fw = d.w;
        // the cliff it comes off, hazy like the other distant rock
        ctx.fillStyle = "rgba(140,158,168,0.55)";
        ctx.beginPath();
        ctx.moveTo(-fw * 2.6, 20);
        ctx.lineTo(-fw * 2.1, -fh * 1.05);
        ctx.lineTo(fw * 2.3, -fh * 0.95);
        ctx.lineTo(fw * 2.8, 20);
        ctx.closePath(); ctx.fill();

        // the fall itself
        ctx.fillStyle = "rgba(178,226,250,0.85)";
        ctx.beginPath();
        ctx.moveTo(-fw / 2, -fh);
        ctx.lineTo(fw / 2, -fh);
        ctx.lineTo(fw * 0.72, 6);
        ctx.lineTo(-fw * 0.72, 6);
        ctx.closePath(); ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 3;
        for (var st = 0; st < 5; st++) {
          var sxp = -fw * 0.38 + st * (fw * 0.19);
          var off = (performance.now() / 6 + st * 47) % fh;
          ctx.beginPath();
          ctx.moveTo(sxp, -fh + off);
          ctx.lineTo(sxp, -fh + off + fh * 0.22);
          ctx.stroke();
        }

        // mist where it lands
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        for (var mi = 0; mi < 5; mi++) {
          var mx = (mi - 2) * fw * 0.42;
          var mr = fw * (0.34 + 0.1 * Math.sin(performance.now() / 700 + mi));
          ctx.beginPath(); ctx.ellipse(mx, 6, mr, mr * 0.5, 0, 0, 6.283); ctx.fill();
        }
        break;
      }
      case "lake": {
        /* drawProp translated by BOTH d.x and gy, so undoing only x left
           every lake floating gy pixels off the ground. */
        ctx.translate(-d.x, -gy);                  // fully back into world space
        var tr2 = d._terrain, half = d.w / 2;
        // water sits just below the shallower of the two shores
        var lvl = Math.min(tr2.heightAt(d.x - half), tr2.heightAt(d.x + half)) + 5;
        ctx.beginPath();
        ctx.moveTo(d.x - half, lvl);
        for (var px2 = d.x - half; px2 <= d.x + half; px2 += 5) {
          ctx.lineTo(px2, Math.max(lvl, tr2.heightAt(px2)));
        }
        ctx.lineTo(d.x + half, lvl);
        ctx.closePath();
        ctx.fillStyle = d.murk ? "rgba(104,142,84,0.82)" : "rgba(96,192,238,0.82)";
        ctx.fill();

        // surface line plus a couple of ripples
        ctx.strokeStyle = "rgba(255,255,255,0.65)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(d.x - half, lvl); ctx.lineTo(d.x + half, lvl);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 2;
        for (var ri = 0; ri < 3; ri++) {
          var rx = d.x - half * 0.5 + ri * half * 0.5;
          var rw = 16 + 5 * Math.sin(performance.now() / 500 + ri);
          ctx.beginPath();
          ctx.moveTo(rx - rw, lvl + 9 + ri * 7);
          ctx.lineTo(rx + rw, lvl + 9 + ri * 7);
          ctx.stroke();
        }
        ctx.translate(d.x, gy);
        break;
      }
      case "canyonwall": {
        var cw = d.w;
        // the dark of the gorge
        var g2 = ctx.createLinearGradient(0, 0, 0, 520);
        g2.addColorStop(0, "#7A4A2C");
        g2.addColorStop(1, "#2E1C12");
        ctx.fillStyle = g2;
        ctx.fillRect(0, 4, cw, 900);
        // near and far wall faces, stepped so they read as rock
        ctx.fillStyle = "rgba(154,92,54,0.95)";
        ctx.beginPath();
        ctx.moveTo(0, 4);
        ctx.lineTo(cw * 0.17, 90); ctx.lineTo(cw * 0.09, 230);
        ctx.lineTo(cw * 0.20, 420); ctx.lineTo(cw * 0.12, 900);
        ctx.lineTo(0, 900);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(120,70,40,0.95)";
        ctx.beginPath();
        ctx.moveTo(cw, 4);
        ctx.lineTo(cw * 0.83, 110); ctx.lineTo(cw * 0.91, 260);
        ctx.lineTo(cw * 0.80, 450); ctx.lineTo(cw * 0.88, 900);
        ctx.lineTo(cw, 900);
        ctx.closePath(); ctx.fill();
        // strata
        ctx.strokeStyle = "rgba(0,0,0,0.14)";
        ctx.lineWidth = 4;
        for (var ly2 = 70; ly2 < 470; ly2 += 74) {
          ctx.beginPath();
          ctx.moveTo(cw * 0.10, ly2); ctx.lineTo(cw * 0.90, ly2 + 8);
          ctx.stroke();
        }
        break;
      }
      case "cablecar":
        ctx.strokeStyle = "#6E6250"; ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(-260, 0); ctx.lineTo(-260, -320);
        ctx.moveTo(260, 0); ctx.lineTo(260, -260);
        ctx.stroke();
        ctx.strokeStyle = INK; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-260, -320); ctx.lineTo(260, -260); ctx.stroke();
        var t = (performance.now() / 5000) % 1;
        var cxp = -260 + 520 * t, cyp = -320 + 60 * t;
        ctx.fillStyle = "#E8A83C";
        rr(ctx, cxp - 16, cyp, 32, 24, 6); ctx.fill(); ctx.stroke();
        break;
    }
    ctx.restore();
  };

  function trunk(ctx, w, h) {
    ctx.fillStyle = "#8A5A32";
    ctx.fillRect(-w / 2, -h, w, h);
    ctx.strokeRect(-w / 2, -h, w, h);
  }

  // ── bodies ────────────────────────────────────────────────────────────────
  R.drawBodies = function (world, truck) {
    var ctx = this.ctx;
    for (var i = 0; i < world.bodies.length; i++) {
      var b = world.bodies[i];
      if (b === truck.chassis || truck.wheels.indexOf(b) >= 0) continue;
      // crates in the bed are drawn with the truck so the bed does not cover them
      if (truck.crates.indexOf(b) >= 0) continue;
      if (b.max.x < this.viewLeft() || b.min.x > this.viewRight()) continue;

      if (b.kind === "rope") { this.drawRope(b); continue; }
      if (b.kind === "cargo" || b.kind === "plank" || b.kind === "prop") {
        firmPath(ctx, b.pts, b.hull, b.kind === "plank" ? 3 : 5);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.lineWidth = b.kind === "plank" ? 3 : 4;
        ctx.strokeStyle = INK; ctx.lineJoin = "round";
        ctx.stroke();
      } else {
        fillBlob(ctx, b, b.color, 4);
      }

      if (b.kind === "cargo") {
        var c = b.centroid();
        ctx.strokeStyle = "rgba(0,0,0,0.22)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(b.pts[0].x, b.pts[0].y); ctx.lineTo(b.pts[2].x, b.pts[2].y);
        ctx.moveTo(b.pts[1].x, b.pts[1].y); ctx.lineTo(b.pts[3].x, b.pts[3].y);
        ctx.stroke();
      }
    }
  };

  R.drawRope = function (b) {
    var ctx = this.ctx;
    var posts = b.userData.posts;

    // posts first, so the rope reads as tied to them
    if (posts) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.lineJoin = "round";
      [posts.x1, posts.x2].forEach(function (px) {
        ctx.fillStyle = "#8A5A32";
        JC.rr(ctx, px - 6, posts.top - 12, 12, posts.deck - posts.top + 26, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#6B4020";                 // cap
        JC.rr(ctx, px - 10, posts.top - 18, 20, 10, 4);
        ctx.fill();
        ctx.stroke();
      });
    }

    ctx.beginPath();
    ctx.moveTo(b.pts[0].x, b.pts[0].y);
    for (var i = 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i].x, b.pts[i].y);
    ctx.lineWidth = 6;
    ctx.strokeStyle = b.color;
    ctx.lineCap = "round";
    ctx.stroke();

    // hangers from the hand rope down toward the deck
    if (posts) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(107,64,32,0.8)";
      for (var h = 1; h < b.pts.length - 1; h++) {
        ctx.beginPath();
        ctx.moveTo(b.pts[h].x, b.pts[h].y);
        ctx.lineTo(b.pts[h].x, b.pts[h].y + 30);
        ctx.stroke();
      }
    }
  };

  // ── truck ─────────────────────────────────────────────────────────────────
  R.drawTruck = function (truck, G) {
    var ctx = this.ctx;
    var ch = truck.chassis;

    // wheels first, so the body sits over the arches
    for (var w = 0; w < truck.wheels.length; w++) {
      var tyre = truck.wheels[w];
      fillBlob(ctx, tyre, "#33303C", 4);
      var c = tyre.centroid();
      var a = tyre.angle();
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(a);
      ctx.fillStyle = "#E8C34F";
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, 6.283); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
      ctx.strokeStyle = "#5A5566"; ctx.lineWidth = 4;
      for (var s = 0; s < 5; s++) {
        var ang = (s / 5) * 6.283;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 12, Math.sin(ang) * 12);
        ctx.lineTo(Math.cos(ang) * 22, Math.sin(ang) * 22);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* Squash along the truck own axes, around its centre. Everything drawn
       inside this transform — hull, window, stripe — stays consistent. */
    var cc = ch.centroid(), ca = ch.angle();
    var sq = truck.squash || 0, stz = truck.stretch || 0;
    var sy = 1 - sq + stz, sx2 = 1 + sq * 0.55 - stz * 0.35;
    ctx.save();
    ctx.translate(cc.x, cc.y);
    ctx.rotate(ca); ctx.scale(sx2, sy); ctx.rotate(-ca);
    ctx.translate(-cc.x, -cc.y);

    // body — firm silhouette, but every point is the live squashed one
    firmPath(ctx, ch.pts, ch.hull, 4);
    ctx.fillStyle = (G && G.hurtFlash > 0) ? "#FFFFFF" : ch.color;
    ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.lineJoin = "round";
    ctx.stroke();
    // a lighter band along the top sells the squash
    ctx.save();
    ctx.clip();
    ctx.fillStyle = JC.rgba("#FFFFFF", 0.16);
    ctx.fillRect(ch.min.x, ch.min.y, ch.max.x - ch.min.x, (ch.max.y - ch.min.y) * 0.42);
    ctx.restore();

    var P = ch.pts;

    // the open bed: floor plus the inner face of the rails, set into the body
    ctx.beginPath();
    ctx.moveTo(P[1].x, P[1].y);
    ctx.lineTo(P[2].x, P[2].y);
    ctx.lineTo(P[3].x, P[3].y);
    ctx.lineTo(JC.lerp(P[3].x, P[4].x, 0.30), JC.lerp(P[3].y, P[4].y, 0.30));
    ctx.closePath();
    ctx.fillStyle = JC.shade(ch.color, -0.42);
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();

    // plank line along the bed floor
    ctx.beginPath();
    ctx.moveTo(P[2].x + 5, P[2].y - 4);
    ctx.lineTo(P[3].x - 5, P[3].y - 4);
    ctx.lineWidth = 3;
    ctx.strokeStyle = JC.shade(ch.color, -0.6);
    ctx.stroke();

    // the load, sitting in the bed
    for (var ci = 0; ci < truck.crates.length; ci++) {
      var crate = truck.crates[ci];
      firmPath(ctx, crate.pts, crate.hull, 4);
      ctx.fillStyle = crate.color;
      ctx.fill();
      ctx.lineWidth = 3.5; ctx.strokeStyle = INK; ctx.lineJoin = "round";
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(crate.pts[0].x, crate.pts[0].y); ctx.lineTo(crate.pts[2].x, crate.pts[2].y);
      ctx.moveTo(crate.pts[1].x, crate.pts[1].y); ctx.lineTo(crate.pts[3].x, crate.pts[3].y);
      ctx.stroke();
    }

    // the cab, as its own boxy volume
    var cabL = { x: JC.lerp(P[4].x, P[5].x, 0.05), y: JC.lerp(P[4].y, P[5].y, 0.05) };
    var cabR = { x: JC.lerp(P[4].x, P[5].x, 0.96), y: JC.lerp(P[4].y, P[5].y, 0.96) };
    ctx.beginPath();
    ctx.moveTo(P[3].x, P[3].y);
    ctx.lineTo(cabL.x, cabL.y);
    ctx.lineTo(cabR.x, cabR.y);
    ctx.lineTo(P[6].x, P[6].y);
    ctx.lineTo(JC.lerp(P[6].x, P[7].x, 0.55), JC.lerp(P[6].y, P[7].y, 0.55));
    ctx.closePath();
    ctx.fillStyle = JC.shade(ch.color, 0.10);
    ctx.fill();
    ctx.lineWidth = 3.5; ctx.strokeStyle = INK; ctx.stroke();

    // windscreen
    var wA = { x: JC.lerp(cabL.x, cabR.x, 0.16), y: JC.lerp(cabL.y, cabR.y, 0.16) };
    var wB = { x: JC.lerp(cabL.x, cabR.x, 0.90), y: JC.lerp(cabL.y, cabR.y, 0.90) };
    var down = { x: (P[3].x - P[4].x) * 0.32, y: (P[3].y - P[4].y) * 0.32 };
    ctx.beginPath();
    ctx.moveTo(wA.x + down.x * 0.18, wA.y + down.y * 0.18);
    ctx.lineTo(wB.x + down.x * 0.18, wB.y + down.y * 0.18);
    ctx.lineTo(wB.x + down.x, wB.y + down.y);
    ctx.lineTo(wA.x + down.x, wA.y + down.y);
    ctx.closePath();
    ctx.fillStyle = "#BFE9FF";
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();

    // grille
    ctx.beginPath();
    ctx.moveTo(JC.lerp(P[6].x, P[7].x, 0.28), JC.lerp(P[6].y, P[7].y, 0.28));
    ctx.lineTo(JC.lerp(P[6].x, P[7].x, 0.60), JC.lerp(P[6].y, P[7].y, 0.60));
    ctx.lineWidth = 7;
    ctx.strokeStyle = JC.shade(ch.color, -0.5);
    ctx.stroke();
    ctx.restore();

    // turret — squashed by hand so it rides the deformed roof
    function squashPt(p) {
      var dx = p.x - cc.x, dy = p.y - cc.y;
      var co = Math.cos(-ca), si = Math.sin(-ca);
      var lx = dx * co - dy * si, ly = dx * si + dy * co;
      lx *= sx2; ly *= sy;
      var co2 = Math.cos(ca), si2 = Math.sin(ca);
      return { x: cc.x + lx * co2 - ly * si2, y: cc.y + lx * si2 + ly * co2 };
    }
    var m = squashPt(truck.turretMount());
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.fillStyle = "#5A5566";
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, 6.283); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.rotate(truck.turret.ang);
    var rec = truck.turret.recoil;
    ctx.fillStyle = "#6E6A7A";
    rr(ctx, 4 - rec * 8, -6, 34, 12, 5);
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // boost flames
    if (truck.boosting) {
      var e = truck.localToWorld(-92, 2);
      for (var f = 0; f < 3; f++) {
        G.fx.spawn(e.x, e.y + (f - 1) * 7, -260 - Math.random() * 200, (Math.random() - 0.5) * 90,
                   0.28, f % 2 ? "#FFD24F" : "#FF7A3C", 8, -0.2);
      }
    }
  };

  // ── enemies ───────────────────────────────────────────────────────────────
  R.drawEnemies = function (list) {
    var ctx = this.ctx;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead) continue;
      if (e.x < this.viewLeft() - 100 || e.x > this.viewRight() + 100) continue;
      this.drawGoblin(e);
    }
  };

  R.drawGoblin = function (e) {
    var ctx = this.ctx;
    var d = e.def;
    var r = e.r;
    var bobY = Math.sin(e.bob) * (d.air ? 5 : 3);

    ctx.save();
    ctx.translate(e.x, e.y + bobY);
    ctx.scale(e.facing, 1);
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.lineJoin = "round";

    // vehicle underneath
    if (e.type === "moto") {
      ctx.fillStyle = "#3A3542";
      ctx.beginPath(); ctx.arc(-16, r * 0.8, 11, 0, 6.283);
      ctx.arc(16, r * 0.8, 11, 0, 6.283); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#C8443C";
      rr(ctx, -20, r * 0.2, 40, 14, 6); ctx.fill(); ctx.stroke();
    } else if (e.type === "drone") {
      ctx.fillStyle = "#556070";
      rr(ctx, -26, 14, 52, 9, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 3;
      var sp = (performance.now() / 30) % 20;
      ctx.beginPath(); ctx.moveTo(-24 - sp * 0.3, 8); ctx.lineTo(-24 + 10, 8);
      ctx.moveTo(24 - 10, 8); ctx.lineTo(24 + sp * 0.3, 8); ctx.stroke();
      ctx.lineWidth = 4; ctx.strokeStyle = INK;
    } else if (e.type === "gtruck" || e.type === "tank") {
      ctx.fillStyle = e.type === "tank" ? "#5A6444" : "#6E58B4";
      rr(ctx, -r, -r * 0.3, r * 2, r * 1.1, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#33303C";
      ctx.beginPath();
      ctx.arc(-r * 0.55, r * 0.75, r * 0.34, 0, 6.283);
      ctx.arc(r * 0.55, r * 0.75, r * 0.34, 0, 6.283);
      ctx.fill(); ctx.stroke();
      if (e.type === "tank") {
        ctx.fillStyle = "#4C5438";
        rr(ctx, 0, -r * 0.5, r * 1.4, 10, 4); ctx.fill(); ctx.stroke();
      }
    } else if (e.type === "zeppelin") {
      ctx.fillStyle = "#C8783C";
      ctx.beginPath(); ctx.ellipse(0, -14, r * 1.5, r * 0.8, 0, 0, 6.283);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#8A5A32";
      rr(ctx, -18, r * 0.5, 36, 18, 5); ctx.fill(); ctx.stroke();
    } else if (e.type === "jetpack") {
      ctx.fillStyle = "#7A7488";
      rr(ctx, -r * 0.9, -6, 12, 24, 4); ctx.fill(); ctx.stroke();
    }

    // body
    var bodyR = d.big ? r * 0.55 : r * 0.85;
    var by = d.big ? -r * 0.55 : 0;
    ctx.fillStyle = e.hitFlash > 0 ? "#FFFFFF" : d.color;
    ctx.beginPath();
    ctx.arc(0, by, bodyR, 0, 6.283);
    ctx.fill(); ctx.stroke();

    // ears
    ctx.beginPath();
    ctx.moveTo(-bodyR * 0.7, by - bodyR * 0.3);
    ctx.lineTo(-bodyR * 1.7, by - bodyR * 0.95);
    ctx.lineTo(-bodyR * 0.6, by - bodyR * 0.85);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // eyes
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(bodyR * 0.25, by - bodyR * 0.18, bodyR * 0.3, 0, 6.283);
    ctx.arc(bodyR * 0.72, by - bodyR * 0.18, bodyR * 0.24, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(bodyR * 0.33, by - bodyR * 0.18, bodyR * 0.14, 0, 6.283);
    ctx.arc(bodyR * 0.78, by - bodyR * 0.18, bodyR * 0.11, 0, 6.283);
    ctx.fill();

    // grin
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(bodyR * 0.35, by + bodyR * 0.3, bodyR * 0.32, 0.1, Math.PI - 0.4);
    ctx.stroke();

    if (d.elite) {
      ctx.fillStyle = "#FFD24F";
      ctx.beginPath();
      ctx.moveTo(-bodyR * 0.6, by - bodyR);
      ctx.lineTo(-bodyR * 0.3, by - bodyR * 1.5);
      ctx.lineTo(0, by - bodyR);
      ctx.lineTo(bodyR * 0.3, by - bodyR * 1.5);
      ctx.lineTo(bodyR * 0.6, by - bodyR);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    ctx.restore();

    // status tint + health pip
    this.drawStatus(e);
  };

  R.drawStatus = function (e) {
    var ctx = this.ctx;
    var glow = null;
    if (e.st.freeze > 0) glow = "#BFEFFF";
    else if (e.st.burn > 0.4) glow = "#FF7A3C";
    else if (e.st.poison > 0.4) glow = "#8FE84F";
    else if (e.st.shock > 0.4) glow = "#FFE24F";
    else if (e.st.slow > 0.15) glow = "#7FD8FF";
    if (glow) {
      ctx.strokeStyle = JC.rgba(glow, 0.75);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 6, 0, 6.283);
      ctx.stroke();
    }
    if (e.hp < e.maxHp) {
      var w = e.r * 2;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      JC.rr(ctx, e.x - w / 2, e.y - e.r - 18, w, 6, 3); ctx.fill();
      ctx.fillStyle = "#7FE05F";
      JC.rr(ctx, e.x - w / 2, e.y - e.r - 18, w * (e.hp / e.maxHp), 6, 3); ctx.fill();
    }
  };

  // ── projectiles, hazards, particles ───────────────────────────────────────
  R.drawBullets = function (list) {
    var ctx = this.ctx;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var col = b.hostile ? "#FF6B4F" : (b.el && JC.ELEMENTS[b.el] ? JC.ELEMENTS[b.el].color : "#FFE24F");
      if (b.beam) {
        ctx.strokeStyle = JC.rgba("#FFE24F", 0.8);
        ctx.lineWidth = b.size * 1.6;
        ctx.beginPath();
        ctx.moveTo(b.x - b.vx * 0.04, b.y - b.vy * 0.04);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size, 0, 6.283);
      ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
    }
  };

  R.drawHazards = function (list) {
    var ctx = this.ctx;
    var cols = { fire: "#FF7A3C", ice: "#BFEFFF", acid: "#8FE84F", volt: "#FFE24F", oil: "#3A3542" };
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      var a = JC.clamp(h.t / h.max, 0, 1) * 0.55;
      ctx.fillStyle = JC.rgba(cols[h.kind] || "#FFFFFF", a);
      ctx.beginPath();
      ctx.ellipse(h.x, h.y, h.r, h.r * 0.42, 0, 0, 6.283);
      ctx.fill();
    }
  };

  R.drawFX = function (fx) {
    var ctx = this.ctx, i;
    for (i = 0; i < fx.p.length; i++) {
      var q = fx.p[i];
      ctx.globalAlpha = JC.clamp(q.t / q.max, 0, 1);
      ctx.fillStyle = q.c;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.s, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (i = 0; i < fx.bolts.length; i++) {
      var b = fx.bolts[i];
      ctx.strokeStyle = "#FFE24F";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      var steps = 6;
      for (var s = 1; s <= steps; s++) {
        var t = s / steps;
        ctx.lineTo(JC.lerp(b.x1, b.x2, t) + (Math.random() - 0.5) * 34,
                   JC.lerp(b.y1, b.y2, t));
      }
      ctx.stroke();
    }

    for (i = 0; i < fx.rings.length; i++) {
      var g = fx.rings[i];
      ctx.globalAlpha = g.t / 0.4;
      ctx.strokeStyle = g.c;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r * (1.4 - g.t / 0.4 * 0.4), 0, 6.283);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (i = 0; i < fx.orbs.length; i++) {
      var o = fx.orbs[i];
      ctx.fillStyle = o.c;
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.283); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.font = "700 20px system-ui, sans-serif";
    for (i = 0; i < fx.texts.length; i++) {
      var tx = fx.texts[i];
      ctx.globalAlpha = JC.clamp(tx.t, 0, 1);
      ctx.lineWidth = 4; ctx.strokeStyle = INK;
      ctx.strokeText(tx.s, tx.x, tx.y);
      ctx.fillStyle = tx.c;
      ctx.fillText(tx.s, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
  };

  R.drawPickups = function (list) {
    var ctx = this.ctx;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      ctx.fillStyle = "#FFD24F";
      ctx.beginPath();
      ctx.arc(p.x, p.y + Math.sin(performance.now() / 200 + i) * 3, 7, 0, 6.283);
      ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
    }
  };

  R.drawTurrets = function (list) {
    var ctx = this.ctx;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.fillStyle = "#8A8298";
      JC.rr(ctx, -14, -8, 28, 20, 5); ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
      ctx.rotate(t.ang || 0);
      ctx.fillStyle = "#6E6A7A";
      JC.rr(ctx, 4, -4, 24, 8, 4); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  };

  /* A rock face at the start line. Without it the ground to the left is
     solid but invisible, so reversing looks like driving on nothing. */
  R.drawWall = function (x, gy) {
    var ctx = this.ctx;
    if (x < this.viewLeft() - 200) return;
    var top = gy - 420;
    ctx.fillStyle = "#7A6250";
    ctx.beginPath();
    ctx.moveTo(x, gy + 900);
    ctx.lineTo(x, top);
    for (var y = top; y < gy + 900; y += 60) {
      ctx.lineTo(x - 46 - Math.sin(y * 0.03) * 20, y + 30);
      ctx.lineTo(x - 92, y + 60);
    }
    ctx.lineTo(x - 400, gy + 900);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x, gy + 900); ctx.lineTo(x, top);
    ctx.stroke();
    ctx.fillStyle = "#5E4A3C";
    for (var b = 0; b < 5; b++) {
      ctx.beginPath();
      ctx.arc(x - 24 - (b % 2) * 22, gy - 40 - b * 74, 15, 0, 6.283);
      ctx.fill();
    }
  };

  /* Crosshair. The ring fills as the turret reloads, so you can time shots
     without looking away from what you are aiming at. */
  R.drawCursor = function (mx, my, ready) {
    var ctx = this.ctx;
    if (mx <= 0 && my <= 0) return;
    ctx.save();
    ctx.translate(mx, my);

    // backing ring
    ctx.strokeStyle = "rgba(43,42,56,0.45)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, 6.283);
    ctx.stroke();

    // the reload sweep
    ctx.strokeStyle = ready >= 1 ? "#7FE05F" : "#FFC93C";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, 15, -Math.PI / 2, -Math.PI / 2 + 6.283 * ready);
    ctx.stroke();
    ctx.lineCap = "butt";

    // ticks and a centre dot
    ctx.strokeStyle = "#2B2A38";
    ctx.lineWidth = 2.5;
    [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(function (v) {
      ctx.beginPath();
      ctx.moveTo(v[0] * 6, v[1] * 6);
      ctx.lineTo(v[0] * 10, v[1] * 10);
      ctx.stroke();
    });
    ctx.fillStyle = ready >= 1 ? "#7FE05F" : "rgba(43,42,56,0.7)";
    ctx.beginPath();
    ctx.arc(0, 0, 2.6, 0, 6.283);
    ctx.fill();

    ctx.restore();
  };

  /* The cargo stop itself — a little depot you pull up to. */
  R.drawStop = function (x, gy) {
    var ctx = this.ctx;
    ctx.save();
    ctx.translate(x, gy);
    ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.lineJoin = "round";
    ctx.fillStyle = "#F2E4C4";
    JC.rr(ctx, -110, -150, 220, 150, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#E8574F";
    ctx.beginPath();
    ctx.moveTo(-128, -150); ctx.lineTo(0, -208); ctx.lineTo(128, -150);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#8FC9F0";
    JC.rr(ctx, -76, -116, 60, 48, 6); ctx.fill(); ctx.stroke();
    JC.rr(ctx, 16, -116, 60, 48, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#B98A50";
    JC.rr(ctx, -30, -70, 60, 70, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("CARGO", 0, -164);
    ctx.restore();
  };

})(window.JC);
