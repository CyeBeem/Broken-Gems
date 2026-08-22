/* Soft-body physics.

   Built the way JellyCar does it: bodies are lists of point masses joined by
   edge and internal springs, kept from turning inside out by matching against
   a virtual rigid frame, and inflated by gas pressure where it helps (tyres).
   Integration is Verlet, which is stable and cheap for this many constraints. */
window.JC = window.JC || {};
(function (JC) {
  "use strict";

  var GRAV = 1750;
  var MAX_STEP = 34;          // hard speed ceiling, px per substep
  var ITER = 6;               // constraint relaxation passes per step

  // ── points ────────────────────────────────────────────────────────────────
  function Point(x, y, m) {
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.ax = 0; this.ay = 0;
    this.m = m === undefined ? 1 : m;
    this.inv = this.m > 0 ? 1 / this.m : 0;
    this.grounded = false;
  }
  JC.Point = Point;

  Point.prototype.addForce = function (fx, fy) {
    this.ax += fx * this.inv;
    this.ay += fy * this.inv;
  };

  Point.prototype.vx = function () { return this.x - this.px; };
  Point.prototype.vy = function () { return this.y - this.py; };

  Point.prototype.setVel = function (vx, vy) {
    this.px = this.x - vx;
    this.py = this.y - vy;
  };

  // ── body ──────────────────────────────────────────────────────────────────
  /* opts: match (0..1 shape-matching strength), pressure (0 = off),
           friction, drag, kind, colour                                      */
  function Body(opts) {
    opts = opts || {};
    this.pts = [];
    this.springs = [];
    this.frame = [];             // rest shape, centred on its own centroid
    this.hull = [];              // indices forming the outline, in order
    this.match = opts.match === undefined ? 0.35 : opts.match;
    this.pressure = opts.pressure || 0;
    this.restArea = 0;
    this.friction = opts.friction === undefined ? 0.45 : opts.friction;
    this.drag = opts.drag === undefined ? 0.999 : opts.drag;
    this.kind = opts.kind || "body";
    this.color = opts.color || "#e8453c";
    this.dead = false;
    this.sleeping = false;
    this.spin = 0;               // torque to apply this step
    this.grounded = false;
    this.min = { x: 0, y: 0 };
    this.max = { x: 0, y: 0 };
    this.userData = {};
  }
  JC.Body = Body;

  Body.prototype.add = function (x, y, m) {
    var p = new Point(x, y, m);
    this.pts.push(p);
    return p;
  };

  Body.prototype.link = function (i, j, stiff) {
    var a = this.pts[i], b = this.pts[j];
    this.springs.push({ a: a, b: b, rest: JC.dist(a.x, a.y, b.x, b.y),
                        stiff: stiff === undefined ? 1 : stiff });
  };

  /* Snapshot the current shape as the rigid frame to match against. */
  Body.prototype.bake = function () {
    var c = this.centroid();
    this.frame = this.pts.map(function (p) { return { x: p.x - c.x, y: p.y - c.y }; });
    this.restArea = Math.abs(this.area());
  };

  Body.prototype.centroid = function () {
    var x = 0, y = 0, n = this.pts.length;
    for (var i = 0; i < n; i++) { x += this.pts[i].x; y += this.pts[i].y; }
    return { x: x / n, y: y / n };
  };

  Body.prototype.velocity = function () {
    var x = 0, y = 0, n = this.pts.length;
    for (var i = 0; i < n; i++) { x += this.pts[i].vx(); y += this.pts[i].vy(); }
    return { x: x / n, y: y / n };
  };

  /* Signed area of the hull polygon (shoelace). */
  Body.prototype.area = function () {
    var h = this.hull.length ? this.hull : this.pts.map(function (_, i) { return i; });
    var a = 0;
    for (var i = 0; i < h.length; i++) {
      var p = this.pts[h[i]], q = this.pts[h[(i + 1) % h.length]];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  };

  /* Rotation of the current shape relative to the baked frame. */
  Body.prototype.angle = function () {
    if (!this.frame.length) return 0;
    var c = this.centroid(), sc = 0, sd = 0;
    for (var i = 0; i < this.pts.length; i++) {
      var fx = this.frame[i].x, fy = this.frame[i].y;
      var cx = this.pts[i].x - c.x, cy = this.pts[i].y - c.y;
      sc += fx * cy - fy * cx;
      sd += fx * cx + fy * cy;
    }
    return Math.atan2(sc, sd);
  };

  Body.prototype.bounds = function () {
    var p = this.pts[0];
    var minx = p.x, maxx = p.x, miny = p.y, maxy = p.y;
    for (var i = 1; i < this.pts.length; i++) {
      var q = this.pts[i];
      if (q.x < minx) minx = q.x;
      if (q.x > maxx) maxx = q.x;
      if (q.y < miny) miny = q.y;
      if (q.y > maxy) maxy = q.y;
    }
    this.min.x = minx; this.min.y = miny;
    this.max.x = maxx; this.max.y = maxy;
    return this;
  };

  Body.prototype.translate = function (dx, dy) {
    for (var i = 0; i < this.pts.length; i++) {
      this.pts[i].x += dx; this.pts[i].y += dy;
      this.pts[i].px += dx; this.pts[i].py += dy;
    }
  };

  Body.prototype.impulse = function (ix, iy) {
    for (var i = 0; i < this.pts.length; i++) {
      this.pts[i].px -= ix; this.pts[i].py -= iy;
    }
  };

  // ── constraint passes ─────────────────────────────────────────────────────
  Body.prototype.solveSprings = function () {
    for (var i = 0; i < this.springs.length; i++) {
      var s = this.springs[i], a = s.a, b = s.b;
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      var diff = (d - s.rest) / d * 0.5 * s.stiff;
      var w = a.inv + b.inv;
      if (w <= 0) continue;
      var ka = (a.inv / w) * 2, kb = (b.inv / w) * 2;
      a.x += dx * diff * ka; a.y += dy * diff * ka;
      b.x -= dx * diff * kb; b.y -= dy * diff * kb;
    }
  };

  /* Pull every point toward where the rigid frame says it should be.
     This is what stops a squashed body popping inside out. */
  Body.prototype.solveMatch = function () {
    if (!this.match || !this.frame.length) return;
    var c = this.centroid();
    var a = this.angle();
    var ca = Math.cos(a), sa = Math.sin(a);
    for (var i = 0; i < this.pts.length; i++) {
      var f = this.frame[i];
      var tx = c.x + f.x * ca - f.y * sa;
      var ty = c.y + f.x * sa + f.y * ca;
      var p = this.pts[i];
      p.x += (tx - p.x) * this.match;
      p.y += (ty - p.y) * this.match;
    }
  };

  /* Gas pressure: push each hull edge along its outward normal by however
     much the body has been squashed below its rest area. */
  var PRESS_SCALE = 0.05;     // pressure constant -> pixels
  var PRESS_CAP = 1.2;        // most any one edge may move in one pass

  Body.prototype.solvePressure = function () {
    if (!this.pressure || !this.hull.length) return;
    var area = Math.abs(this.area());
    if (area < 1e-4) return;

    // how far under rest area we are, capped so a hard squash cannot explode
    var deficit = JC.clamp(this.restArea / area - 1, 0, 1.5);
    if (deficit <= 0) return;
    var push = deficit * this.pressure * PRESS_SCALE;

    for (var i = 0; i < this.hull.length; i++) {
      var p = this.pts[this.hull[i]];
      var q = this.pts[this.hull[(i + 1) % this.hull.length]];
      var dx = q.x - p.x, dy = q.y - p.y;
      var len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      var nx = dy / len, ny = -dx / len;      // outward for CW winding
      var f = JC.clamp(push * len * 0.5, 0, PRESS_CAP);
      p.x += nx * f * p.inv; p.y += ny * f * p.inv;
      q.x += nx * f * q.inv; q.y += ny * f * q.inv;
    }
  };

  /* Average tangential speed of the rim — the bodys angular rate. */
  Body.prototype.spinRate = function () {
    var c = this.centroid(), sum = 0, n = 0;
    for (var i = 0; i < this.pts.length; i++) {
      var p = this.pts[i];
      var dx = p.x - c.x, dy = p.y - c.y;
      var d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      sum += (p.vx() * -dy + p.vy() * dx) / d;
      n++;
    }
    return n ? sum / n : 0;
  };

  /* Torque, used to drive the wheels: shove every point tangentially. */
  Body.prototype.applySpin = function (amount) {
    if (!amount) return;
    var c = this.centroid();
    for (var i = 0; i < this.pts.length; i++) {
      var p = this.pts[i];
      var dx = p.x - c.x, dy = p.y - c.y;
      var d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      p.x += (-dy / d) * amount;
      p.y += (dx / d) * amount;
    }
  };

  // ── world ─────────────────────────────────────────────────────────────────
  function World(terrain) {
    this.terrain = terrain;         // needs .heightAt(x) and .slopeAt(x)
    this.bodies = [];
    this.joints = [];          // constraints between points of different bodies
    this.gravity = GRAV;
    this.timeScale = 1;
  }
  JC.World = World;

  World.prototype.add = function (b) { this.bodies.push(b); return b; };

  /* Distance constraint spanning two bodies — axles and suspension. */
  World.prototype.joint = function (a, b, rest, stiff, maxStretch) {
    var j = { a: a, b: b, stiff: stiff === undefined ? 1 : stiff,
              rest: rest === undefined ? JC.dist(a.x, a.y, b.x, b.y) : rest,
              max: maxStretch || 0, broken: false };
    this.joints.push(j);
    return j;
  };

  World.prototype.dropJoints = function (pred) {
    this.joints = this.joints.filter(function (j) { return !pred(j); });
  };

  World.prototype.solveJoints = function () {
    for (var i = 0; i < this.joints.length; i++) {
      var j = this.joints[i];
      if (j.broken) continue;
      var a = j.a, b = j.b;
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      if (j.max && d > j.rest * j.max) { j.broken = true; continue; }
      var w = a.inv + b.inv;
      if (w <= 0) continue;
      var diff = (d - j.rest) / d * j.stiff;
      a.x += dx * diff * (a.inv / w); a.y += dy * diff * (a.inv / w);
      b.x -= dx * diff * (b.inv / w); b.y -= dy * diff * (b.inv / w);
    }
  };

  World.prototype.remove = function (b) {
    var i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  };

  World.prototype.step = function (dt) {
    var i, j, b;
    dt *= this.timeScale;
    if (dt <= 0) return;

    // integrate
    for (i = 0; i < this.bodies.length; i++) {
      b = this.bodies[i];
      if (b.sleeping) continue;
      for (j = 0; j < b.pts.length; j++) {
        var p = b.pts[j];
        if (p.inv === 0) {                       // anchored: never integrates
          p.px = p.x; p.py = p.y;
          p.ax = 0; p.ay = 0; p.grounded = false;
          continue;
        }
        p.ay += this.gravity;
        var vx = (p.x - p.px) * b.drag;
        var vy = (p.y - p.py) * b.drag;
        var sp = Math.hypot(vx, vy);
        if (sp > MAX_STEP) { vx = vx / sp * MAX_STEP; vy = vy / sp * MAX_STEP; }
        p.px = p.x; p.py = p.y;
        p.x += vx + p.ax * dt * dt;
        p.y += vy + p.ay * dt * dt;
        p.ax = 0; p.ay = 0;
        p.grounded = false;
      }
      if (b.spin) { b.applySpin(b.spin); b.spin = 0; }
    }

    // relax
    for (var it = 0; it < ITER; it++) {
      for (i = 0; i < this.bodies.length; i++) {
        b = this.bodies[i];
        if (b.sleeping) continue;
        b.solveSprings();
        b.solvePressure();
        b.solveMatch();
      }
      this.solveJoints();
      if (this.onRelax) this.onRelax();
      this.collideTerrain();
      if (it % 2 === 1) this.collideBodies();
    }

    for (i = 0; i < this.bodies.length; i++) this.bodies[i].bounds();
  };

  World.prototype.collideTerrain = function () {
    var t = this.terrain;
    for (var i = 0; i < this.bodies.length; i++) {
      var b = this.bodies[i];
      if (b.sleeping) continue;
      /* Planks are held entirely by the rope they are lashed to. They also
         overlap their neighbours, so the end ones poke into the hillside and
         the terrain shoved them upward, standing a step up at both ends of
         every bridge. Let the rope hold them. */
      if (b.userData.noTerrain) continue;
      b.grounded = false;
      for (var j = 0; j < b.pts.length; j++) {
        var p = b.pts[j];
        if (p.inv === 0) continue;
        var gy = t.heightAt(p.x);
        if (p.y <= gy) continue;

        var slope = t.slopeAt(p.x);
        var nlen = Math.hypot(slope, 1);
        var nx = -slope / nlen, ny = -1 / nlen;      // surface normal, up-ish
        var pen = p.y - gy;

        p.x += nx * pen * 0.55;
        p.y -= pen;
        p.grounded = true;
        b.grounded = true;

        // friction along the surface
        var vx = p.x - p.px, vy = p.y - p.py;
        var tx = -ny, ty = nx;
        var vt = vx * tx + vy * ty;
        var f = vt * b.friction;
        p.px += tx * f;
        p.py += ty * f;
      }
    }
  };

  /* Point-in-polygon then push out along the nearest hull edge — the same
     resolution JellyCar uses, kept cheap with an AABB reject first. */
  World.prototype.collideBodies = function () {
    // scenery bodies simulate so they can sag and sway, but nothing hits them

    var list = this.bodies;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.sleeping || !a.hull.length || a.userData.ghost) continue;
      a.bounds();
      for (var j = i + 1; j < list.length; j++) {
        var b = list[j];
        if (b.sleeping || !b.hull.length || b.userData.ghost) continue;
        b.bounds();
        if (a.max.x < b.min.x || b.max.x < a.min.x ||
            a.max.y < b.min.y || b.max.y < a.min.y) continue;
        if (a.userData.group && a.userData.group === b.userData.group &&
            (a.userData.noSelf || b.userData.noSelf)) continue;
        resolvePair(a, b);
        resolvePair(b, a);
      }
    }
  };

  function resolvePair(a, b) {
    // every point of `a` tested against the hull of `b`
    for (var i = 0; i < a.pts.length; i++) {
      var p = a.pts[i];
      if (p.x < b.min.x || p.x > b.max.x || p.y < b.min.y || p.y > b.max.y) continue;
      if (!pointInHull(b, p.x, p.y)) continue;

      var near = nearestEdge(b, p.x, p.y);
      if (!near) continue;

      var e1 = b.pts[b.hull[near.i]];
      var e2 = b.pts[b.hull[(near.i + 1) % b.hull.length]];
      var total = p.inv + (e1.inv + e2.inv) * 0.5;
      if (total <= 0) continue;

      var pw = p.inv / total, ew = ((e1.inv + e2.inv) * 0.5) / total;
      p.x += near.nx * near.depth * pw;
      p.y += near.ny * near.depth * pw;
      e1.x -= near.nx * near.depth * ew * (1 - near.t);
      e1.y -= near.ny * near.depth * ew * (1 - near.t);
      e2.x -= near.nx * near.depth * ew * near.t;
      e2.y -= near.ny * near.depth * ew * near.t;
    }
  }

  function pointInHull(b, x, y) {
    var inside = false, h = b.hull;
    for (var i = 0, k = h.length - 1; i < h.length; k = i++) {
      var pi = b.pts[h[i]], pk = b.pts[h[k]];
      if (((pi.y > y) !== (pk.y > y)) &&
          (x < (pk.x - pi.x) * (y - pi.y) / (pk.y - pi.y + 1e-9) + pi.x)) inside = !inside;
    }
    return inside;
  }

  function nearestEdge(b, x, y) {
    var best = null, h = b.hull;
    for (var i = 0; i < h.length; i++) {
      var p = b.pts[h[i]], q = b.pts[h[(i + 1) % h.length]];
      var dx = q.x - p.x, dy = q.y - p.y;
      var len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) continue;
      var t = JC.clamp(((x - p.x) * dx + (y - p.y) * dy) / len2, 0, 1);
      var cx = p.x + dx * t, cy = p.y + dy * t;
      var d = Math.hypot(x - cx, y - cy);
      if (!best || d < best.depth) {
        best = { i: i, t: t, depth: d,
                 nx: d > 1e-6 ? (cx - x) / d : 0,
                 ny: d > 1e-6 ? (cy - y) / d : -1 };
      }
    }
    return best;
  }

  JC.pointInHull = pointInHull;

  // ── builders ──────────────────────────────────────────────────────────────
  /* A pressurised ring — used for the tyres. */
  JC.makeWheel = function (cx, cy, r, segs, opts) {
    var b = new Body(opts || {});
    var i;
    for (i = 0; i < segs; i++) {
      var a = (i / segs) * Math.PI * 2;
      b.add(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1);
      b.hull.push(i);
    }
    for (i = 0; i < segs; i++) {
      b.link(i, (i + 1) % segs, 1);                  // rim
      b.link(i, (i + Math.floor(segs / 2)) % segs, 0.35);   // spokes across
      b.link(i, (i + 2) % segs, 0.5);
    }
    b.bake();
    b.userData.radius = r;
    return b;
  };

  /* A rectangle with cross-bracing — cargo crates and simple props. */
  JC.makeBox = function (cx, cy, w, h, opts) {
    var b = new Body(opts || {});
    var hw = w / 2, hh = h / 2;
    b.add(cx - hw, cy - hh, 1);
    b.add(cx + hw, cy - hh, 1);
    b.add(cx + hw, cy + hh, 1);
    b.add(cx - hw, cy + hh, 1);
    b.hull = [0, 1, 2, 3];
    b.link(0, 1); b.link(1, 2); b.link(2, 3); b.link(3, 0);
    b.link(0, 2, 0.9); b.link(1, 3, 0.9);
    b.bake();
    return b;
  };

  /* A box with mid-edge points and a core, so the sides can actually bow.
     Four corners can only ever stay a rigid quad however soft the springs
     are; the extra points are what let it wobble like the original. */
  JC.makeJellyBox = function (cx, cy, w, h, opts) {
    var b = new Body(opts || {});
    var hw = w / 2, hh = h / 2, i;
    // perimeter, clockwise from the top left: corner, mid, corner, mid...
    var ring = [[-hw, -hh], [0, -hh], [hw, -hh], [hw, 0],
                [hw, hh], [0, hh], [-hw, hh], [-hw, 0]];
    /* 8 * 0.4 plus the 0.8 core is exactly the 4 * 1 of a plain box, so
       swapping one in for the other does not change how heavy anything is. */
    for (i = 0; i < 8; i++) b.add(cx + ring[i][0], cy + ring[i][1], 0.4);
    b.add(cx, cy, 0.8);                          // core, to hang spokes off
    b.hull = [0, 1, 2, 3, 4, 5, 6, 7];
    for (i = 0; i < 8; i++) b.link(i, (i + 1) % 8, 1);      // the shell
    for (i = 0; i < 8; i++) b.link(i, (i + 4) % 8, 0.45);   // straight across
    for (i = 0; i < 8; i++) b.link(i, 8, 0.4);              // spokes
    b.bake();
    return b;
  };

  /* A hanging chain of points — rope bridges and cables. */
  JC.makeRope = function (x1, y1, x2, y2, segs, opts) {
    opts = opts || {};
    var b = new Body({ match: 0, friction: opts.friction || 0.6,
                       kind: "rope", color: opts.color || "#7a4b28" });
    for (var i = 0; i <= segs; i++) {
      var t = i / segs;
      var p = b.add(JC.lerp(x1, x2, t), JC.lerp(y1, y2, t), opts.mass || 1);
      if (i === 0 || i === segs) { p.m = 0; p.inv = 0; }     // anchored ends
    }
    for (var j = 0; j < segs; j++) b.link(j, j + 1, 1);
    for (var k = 0; k < segs - 1; k++) b.link(k, k + 2, 0.25);
    b.frame = [];
    return b;
  };

})(window.JC);
