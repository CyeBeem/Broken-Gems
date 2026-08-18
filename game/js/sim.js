/* World simulation + the 2.5D view.
   Coordinates are in tiles, and 1 code unit == 1 tile. */
window.BG = window.BG || {};
(function (BG) {
  "use strict";

  var UNIT        = 1;      // tiles per code unit
  var MOVE_SPEED  = 2.0;    // tiles/sec at 1x
  var TURN_SPEED  = 220;    // deg/sec at 1x
  var GHOST_SPEED = 2.0;    // identical to the player, never faster
  var SETTLE_SPEED = 4.0;   // tiles/sec while re-centring after a move
  var P_RADIUS    = 0.34;   // collision radius
  var SIGHT       = 8;      // tiles a ghost can see down a clear line
  var BORED       = 5.0;    // seconds before a ghost gives up
  var SQUASH      = 0.62;   // vertical foreshortening
  /* Walls extrude upward, so a tall wall in the row ahead eats the player.
     Keep it under (1 - SQUASH) + a little and the overlap stays small. */
  var WALL_H      = 0.34;   // wall height as a fraction of a tile

  var GHOST_COLORS = ["#c1595c", "#5b86c1", "#c18f56", "#7ab06f", "#a06fb0", "#4fa3a3", "#b06f8a", "#8a8ac1"];

  BG.World = function (level) {
    this.level = level;
    this.grid = level.grid;
    this.W = level.grid[0].length;
    this.H = level.grid.length;
    this.walkPhase = 0;
    this.time = 0;
    this.reset();
  };

  BG.World.prototype.reset = function () {
    var L = this.level;
    this.player = { x: L.start.x + 0.5, y: L.start.y + 0.5, facing: L.facing || 0 };
    this.motion = null;
    this.failed = null;       // "wall" | "caught"
    this.won = false;
    this.moving = false;
    this.time = 0;

    this.ghosts = (L.ghosts || []).map(function (g, i) {
      return {
        home: { x: g.home.x, y: g.home.y },
        tile: { x: g.home.x, y: g.home.y },
        from: { x: g.home.x, y: g.home.y },
        to:   { x: g.home.x, y: g.home.y },
        t: 1,
        x: g.home.x + 0.5, y: g.home.y + 0.5,
        state: "wander",
        chaseFor: 0,
        anchor: { x: g.home.x, y: g.home.y },   // where a chase began
        color: GHOST_COLORS[i % GHOST_COLORS.length]
      };
    });
  };

  // ── geometry helpers ──────────────────────────────────────────────────────
  BG.World.prototype.isWall = function (tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return true;
    return this.grid[ty][tx] === 1;
  };

  BG.World.prototype.hitsWall = function (x, y) {
    var minX = Math.floor(x - P_RADIUS), maxX = Math.floor(x + P_RADIUS);
    var minY = Math.floor(y - P_RADIUS), maxY = Math.floor(y + P_RADIUS);
    for (var ty = minY; ty <= maxY; ty++) {
      for (var tx = minX; tx <= maxX; tx++) {
        if (!this.isWall(tx, ty)) continue;
        var nx = Math.max(tx, Math.min(x, tx + 1));
        var ny = Math.max(ty, Math.min(y, ty + 1));
        var dx = x - nx, dy = y - ny;
        if (dx * dx + dy * dy < P_RADIUS * P_RADIUS - 1e-6) return true;
      }
    }
    return false;
  };

  /* front/back/left/right resolved against the current facing.
     Facing 0 points along +x; angles increase clockwise on screen. */
  BG.World.prototype.dirVector = function (dir) {
    var off = { front: 0, right: 90, back: 180, left: 270 }[dir] || 0;
    var a = (this.player.facing + off) * Math.PI / 180;
    return { x: Math.cos(a), y: Math.sin(a) };
  };

  // ── motion queue (movement is a single shared resource) ───────────────────
  BG.World.prototype.busy = function () { return this.motion !== null; };

  BG.World.prototype.startMove = function (owner, dir, tiles, condFn) {
    if (this.motion) return false;
    this.motion = { kind: "move", owner: owner, vec: this.dirVector(dir),
                    left: tiles, cond: condFn || null, done: false };
    return true;
  };

  BG.World.prototype.startTurn = function (owner, degrees, condFn) {
    if (this.motion) return false;
    var sign = degrees === null ? 1 : (degrees < 0 ? -1 : 1);
    this.motion = { kind: "turn", owner: owner,
                    left: degrees === null ? null : Math.abs(degrees),
                    sign: sign, cond: condFn || null, done: false };
    return true;
  };

  BG.World.prototype.clearMotion = function (owner) {
    if (!this.motion) return;
    if (owner && this.motion.owner !== owner) return;
    // A branch killed mid-stride would otherwise leave the player off-grid.
    if (!this.failed) this.snapToTile();
    this.motion = null;
  };

  // ── tile snapping ─────────────────────────────────────────────────────────
  /* The centre of the tile you are standing in. Always a legal spot: if the
     player's circle cleared every wall, the tile under its centre is floor. */
  BG.World.prototype.tileCentre = function () {
    return { x: Math.floor(this.player.x) + 0.5, y: Math.floor(this.player.y) + 0.5 };
  };

  BG.World.prototype.snapToTile = function () {
    var c = this.tileCentre();
    this.player.x = c.x;
    this.player.y = c.y;
  };

  /* Called the moment a movement finishes. Rather than teleporting, glide
     the last fraction of a tile so it reads as settling, not popping. */
  BG.World.prototype.beginSettle = function (m) {
    var c = this.tileCentre();
    if (Math.abs(c.x - this.player.x) < 1e-4 && Math.abs(c.y - this.player.y) < 1e-4) {
      this.player.x = c.x;
      this.player.y = c.y;
      m.done = true;
      return;
    }
    m.settle = c;
  };

  BG.World.prototype.stepSettle = function (m, dt) {
    var dx = m.settle.x - this.player.x;
    var dy = m.settle.y - this.player.y;
    var d = Math.hypot(dx, dy);
    var step = SETTLE_SPEED * dt;

    if (d <= step || d < 1e-4) {
      this.player.x = m.settle.x;
      this.player.y = m.settle.y;
      m.settle = null;
      m.done = true;
      return;
    }
    this.player.x += dx / d * step;
    this.player.y += dy / d * step;
    this.moving = true;
    this.walkPhase += step * 5.5;
  };

  // ── raycast ───────────────────────────────────────────────────────────────
  /* A direction name resolved to one cardinal grid step, relative to the way
     the player is facing. Diagonal facings snap to the nearest cardinal. */
  BG.World.prototype.dirStep = function (dir) {
    var v = this.dirVector(dir);
    if (Math.abs(v.x) >= Math.abs(v.y)) return { x: v.x >= 0 ? 1 : -1, y: 0 };
    return { x: 0, y: v.y >= 0 ? 1 : -1 };
  };

  /* What occupies one tile. Walls win, then monsters, then the gem. */
  BG.World.prototype.tileHolds = function (cx, cy) {
    if (this.isWall(cx, cy)) return "wall";
    for (var i = 0; i < this.ghosts.length; i++) {
      var g = this.ghosts[i];
      if (Math.floor(g.x) === cx && Math.floor(g.y) === cy) return "enemy";
    }
    if (cx === this.level.goal.x && cy === this.level.goal.y) return "goal";
    return "air";
  };

  /* Scans one whole tile at a time and reports the first thing hit along the
     beam's own path. Used by the Distance sensor.
     Returns { type:"wall"|"enemy"|"goal"|null, dist }.                       */
  BG.World.prototype.raycast = function (dir, maxTiles) {
    var s = this.dirStep(dir);
    var max = maxTiles === null ? (this.W + this.H)
                                : Math.max(0, Math.round(maxTiles));
    var tx = Math.floor(this.player.x), ty = Math.floor(this.player.y);

    for (var step = 1; step <= max; step++) {
      var what = this.tileHolds(tx + s.x * step, ty + s.y * step);
      if (what !== "air") return { type: what, dist: step };
    }
    return { type: null, dist: max };
  };

  /* One targeted beam, fired from any tile.

     It travels from (tx,ty) along `dir`, one tile per step, and is always
     stopped by a wall in its own path. At every step it probes for `target`
     on the tile that `detect` points at — that is the side of the beam doing
     the looking. When `detect` matches `dir` the beam looks along itself,
     which is the plain behaviour.

     `stopAtTarget` decides whether spotting the target ends the beam early.
     "air" is special: it asks whether the probed line stays clear the whole
     way, rather than whether any single tile happens to be empty.

     Returns { found, dist, x, y } where x,y is the last free tile the beam
     reached — the launch point for a follow-up beam.                        */
  BG.World.prototype.probeRay = function (tx, ty, dir, maxTiles, target, detect, stopAtTarget) {
    var s = this.dirStep(dir);
    var off = (!detect || detect === dir) ? { x: 0, y: 0 } : this.dirStep(detect);
    var max = maxTiles === null ? (this.W + this.H)
                                : Math.max(0, Math.round(maxTiles));
    var sideways = !(off.x === 0 && off.y === 0);
    /* Looking straight ahead, "air" asks whether the path stays clear the
       whole way — the useful question is "can I walk this far". Looking off
       to one side it asks the opposite: whether a gap shows up anywhere along
       the wall you are scanning. */
    var wholeLine = target === "air" && !sideways;

    var endX = tx, endY = ty;
    var hitAt = null;        // step the target was first seen on
    var clear = 0;           // how far the probed line stayed open

    for (var step = 1; step <= max; step++) {
      var nx = tx + s.x * step, ny = ty + s.y * step;
      var blocked = this.isWall(nx, ny);
      var what = this.tileHolds(nx + off.x, ny + off.y);

      if (!blocked) { endX = nx; endY = ny; }
      if (what === target && hitAt === null) hitAt = step;
      if (!blocked && what === "air") clear = step;

      if (blocked) break;
      if (wholeLine && what !== "air") break;
      if (!wholeLine && hitAt !== null && stopAtTarget) break;
    }

    return {
      found: wholeLine ? clear >= max : hitAt !== null,
      dist: hitAt === null ? clear : hitAt,
      x: endX, y: endY
    };
  };

  BG.World.prototype.rayAnswer = function (dir, maxTiles, target, detect) {
    return this.probeRay(Math.floor(this.player.x), Math.floor(this.player.y),
                         dir, maxTiles, target, detect, true).found;
  };

  /* Raycast At Raycast: fire one beam, then fire a second from wherever the
     first came to rest. Lets a scan bend around a corner. */
  BG.World.prototype.rayAtRay = function (c) {
    var first = this.probeRay(Math.floor(this.player.x), Math.floor(this.player.y),
                              c.dir1, c.dist1, c.target1, c.detect1, c.stop1);
    return this.probeRay(first.x, first.y,
                         c.dir2, c.dist2, c.target2, c.detect2, true).found;
  };

  // ── update ────────────────────────────────────────────────────────────────
  BG.World.prototype.update = function (dt) {
    if (this.failed || this.won) return;
    this.time += dt;
    this.moving = false;

    var m = this.motion;
    if (m && !m.done) {
      if (m.settle) this.stepSettle(m, dt);
      else if (m.kind === "move") this.stepMove(m, dt);
      else this.stepTurn(m, dt);
    }

    this.updateGhosts(dt);

    // reaching the gem wins regardless of what the code does next
    var gx = this.level.goal.x + 0.5, gy = this.level.goal.y + 0.5;
    if (Math.hypot(this.player.x - gx, this.player.y - gy) < 0.45) this.won = true;
  };

  BG.World.prototype.stepMove = function (m, dt) {
    var dist = MOVE_SPEED * dt;
    if (m.left !== null) dist = Math.min(dist, m.left);
    if (dist <= 0) { this.beginSettle(m); return; }

    var steps = Math.max(1, Math.ceil(dist / 0.08));
    var inc = dist / steps;

    for (var s = 0; s < steps; s++) {
      if (m.cond && m.cond()) { this.beginSettle(m); return; }

      var nx = this.player.x + m.vec.x * inc;
      var ny = this.player.y + m.vec.y * inc;

      if (this.hitsWall(nx, ny)) { this.failed = "wall"; m.done = true; return; }

      this.player.x = nx;
      this.player.y = ny;
      this.moving = true;
      this.walkPhase += inc * 5.5;

      if (m.left !== null) {
        m.left -= inc;
        if (m.left <= 1e-6) { this.beginSettle(m); return; }
      }
    }
    if (m.cond && m.cond()) this.beginSettle(m);
  };

  BG.World.prototype.stepTurn = function (m, dt) {
    var amt = TURN_SPEED * dt;
    if (m.left !== null) amt = Math.min(amt, m.left);

    if (m.cond && m.cond()) { this.beginSettle(m); return; }

    this.player.facing = (this.player.facing + m.sign * amt) % 360;
    this.moving = true;
    this.walkPhase += amt * 0.02;

    if (m.left !== null) {
      m.left -= amt;
      if (m.left <= 1e-6) { this.beginSettle(m); return; }
    }
    if (m.cond && m.cond()) this.beginSettle(m);
  };

  // ── ghosts ────────────────────────────────────────────────────────────────
  BG.World.prototype.canSee = function (g) {
    var px = Math.floor(this.player.x), py = Math.floor(this.player.y);
    var gx = g.tile.x, gy = g.tile.y;
    if (px !== gx && py !== gy) return false;

    var dist = Math.abs(px - gx) + Math.abs(py - gy);
    if (dist > SIGHT) return false;

    var sx = Math.sign(px - gx), sy = Math.sign(py - gy);
    for (var i = 1; i < dist; i++) {
      if (this.isWall(gx + sx * i, gy + sy * i)) return false;
    }
    return true;
  };

  BG.World.prototype.updateGhosts = function (dt) {
    for (var i = 0; i < this.ghosts.length; i++) {
      var g = this.ghosts[i];

      if (g.state === "chase") {
        g.chaseFor += dt;
        if (g.chaseFor >= BORED) { g.state = "return"; g.chaseFor = 0; }
      }

      // advance along the current tile-to-tile hop
      g.t += GHOST_SPEED * dt;
      while (g.t >= 1) {
        g.t -= 1;
        g.tile = { x: g.to.x, y: g.to.y };
        g.from = { x: g.to.x, y: g.to.y };
        this.pickGhostStep(g);
      }

      g.x = (g.from.x + (g.to.x - g.from.x) * g.t) + 0.5;
      g.y = (g.from.y + (g.to.y - g.from.y) * g.t) + 0.5;

      if (Math.hypot(g.x - this.player.x, g.y - this.player.y) < 0.55) {
        this.failed = "caught";
        return;
      }
    }
  };

  BG.World.prototype.pickGhostStep = function (g) {
    var see = this.canSee(g);

    if (see && g.state !== "chase") {
      g.state = "chase";
      g.chaseFor = 0;
      g.anchor = { x: g.tile.x, y: g.tile.y };   // remember where the chase began
    }

    var goal = null;
    if (g.state === "chase") {
      goal = { x: Math.floor(this.player.x), y: Math.floor(this.player.y) };
    } else if (g.state === "return") {
      goal = g.anchor;
      if (g.tile.x === goal.x && g.tile.y === goal.y) { g.state = "wander"; goal = null; }
    }

    var next = goal ? this.stepToward(g.tile, goal) : null;
    if (!next) next = this.wanderStep(g);
    g.to = next || { x: g.tile.x, y: g.tile.y };
  };

  BG.World.prototype.stepToward = function (from, goal) {
    if (this.isWall(goal.x, goal.y)) return null;
    var dist = BG.bfs(this.grid, goal);
    if (dist[from.y][from.x] <= 0) return null;

    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var best = null, bestD = dist[from.y][from.x];
    for (var i = 0; i < 4; i++) {
      var nx = from.x + D[i][0], ny = from.y + D[i][1];
      if (this.isWall(nx, ny)) continue;
      var d = dist[ny][nx];
      if (d >= 0 && d < bestD) { bestD = d; best = { x: nx, y: ny }; }
    }
    return best;
  };

  BG.World.prototype.wanderStep = function (g) {
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var back = { x: g.tile.x * 2 - g.from.x, y: g.tile.y * 2 - g.from.y };
    var opts = [];
    for (var i = 0; i < 4; i++) {
      var nx = g.tile.x + D[i][0], ny = g.tile.y + D[i][1];
      if (this.isWall(nx, ny)) continue;
      opts.push({ x: nx, y: ny });
    }
    if (!opts.length) return null;
    // avoid doubling back unless it's the only way out of a dead end
    var fwd = opts.filter(function (o) { return !(o.x === back.x && o.y === back.y); });
    var pool = fwd.length ? fwd : opts;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  // ── rendering ─────────────────────────────────────────────────────────────
  BG.World.prototype.render = function (ctx, VW, VH) {
    ctx.save();
    ctx.clearRect(0, 0, VW, VH);
    ctx.fillStyle = "#0c0c0c";
    ctx.fillRect(0, 0, VW, VH);

    var pad = 26;
    var TS = Math.min((VW - pad * 2) / this.W,
                      (VH - pad * 2) / (this.H * SQUASH + WALL_H + 0.1));
    TS = Math.max(6, TS);
    var TSY = TS * SQUASH;
    var WH  = TS * WALL_H;

    var ox = (VW - this.W * TS) / 2;
    var oy = (VH - (this.H * TSY + WH)) / 2 + WH;

    var self = this;
    function sx(x) { return ox + x * TS; }
    function sy(y) { return oy + y * TSY; }

    // floor
    ctx.fillStyle = "#141414";
    ctx.strokeStyle = "#1e1e1e";
    ctx.lineWidth = 1;
    for (var y = 0; y < this.H; y++) {
      for (var x = 0; x < this.W; x++) {
        if (this.grid[y][x] === 1) continue;
        ctx.fillRect(sx(x), sy(y), TS, TSY);
        ctx.strokeRect(sx(x) + 0.5, sy(y) + 0.5, TS - 1, TSY - 1);
      }
    }

    this.drawGoal(ctx, sx(this.level.goal.x), sy(this.level.goal.y), TS, TSY);

    // walls, back to front, so they overlap each other correctly
    for (var row = 0; row < this.H; row++) {
      for (var cx = 0; cx < this.W; cx++) {
        if (this.grid[row][cx] !== 1) continue;
        if (!this.wallVisible(cx, row)) continue;
        this.drawWall(ctx, sx(cx), sy(row), TS, TSY, WH);
      }
    }

    /* Characters go last, on top of every wall. Depth realism is not worth
       losing sight of your own player behind the wall he is walking past. */
    var actors = this.ghosts.map(function (g) {
      return { y: g.y, draw: function () { self.drawGhost(ctx, sx(g.x), sy(g.y), TS, g); } };
    });
    actors.push({
      y: this.player.y,
      draw: function () { self.drawPlayer(ctx, sx(self.player.x), sy(self.player.y), TS); }
    });
    actors.sort(function (a, b) { return a.y - b.y; });
    actors.forEach(function (a) { a.draw(); });

    ctx.restore();
  };

  /* Interior walls fully enclosed by other walls are never seen. */
  BG.World.prototype.wallVisible = function (x, y) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!this.isWall(x + dx, y + dy)) return true;
      }
    }
    return false;
  };

  BG.World.prototype.drawWall = function (ctx, x, y, TS, TSY, WH) {
    ctx.fillStyle = "#191919";                       // front face
    ctx.fillRect(x, y - WH + TSY, TS, WH);
    ctx.fillStyle = "#2b2b2b";                       // top face
    ctx.fillRect(x, y - WH, TS, TSY);
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - WH + 0.5, TS - 1, TSY - 1);
    ctx.strokeStyle = "#242424";
    ctx.strokeRect(x + 0.5, y - WH + TSY + 0.5, TS - 1, WH - 1);
  };

  BG.World.prototype.drawGoal = function (ctx, x, y, TS, TSY) {
    var cx = x + TS / 2, cy = y + TSY / 2;
    var r = TS * 0.34;
    var pulse = 0.86 + Math.sin(this.time * 2.4) * 0.14;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, SQUASH);
    ctx.strokeStyle = "#f0f0f0";
    ctx.lineWidth = Math.max(1.2, TS * 0.045);
    ctx.globalAlpha = pulse;
    // a broken gem, split down the middle
    var gap = TS * 0.05;
    ctx.beginPath();
    ctx.moveTo(-gap, -r); ctx.lineTo(-r * 0.9 - gap, -r * 0.15); ctx.lineTo(-gap, r); ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gap, -r); ctx.lineTo(r * 0.9 + gap, -r * 0.15); ctx.lineTo(gap, r); ctx.closePath();
    ctx.stroke();
    ctx.restore();
  };

  /* Cartoon ball with hands and feet.

     Every limb is placed in the player's own frame — forward and right taken
     from `facing` — then projected to screen, so the whole model turns as one
     piece. Side-stepping does not change `facing`, so the model keeps looking
     where it is aimed while it slides. */
  BG.World.prototype.drawPlayer = function (ctx, x, y, TS) {
    var r = TS * 0.30;
    var bob = this.moving ? Math.abs(Math.sin(this.walkPhase)) * r * 0.16 : 0;
    var swing = this.moving ? Math.sin(this.walkPhase) : 0;
    var bodyY = y - r * 0.75 - bob;

    var a = this.player.facing * Math.PI / 180;
    var fx = Math.cos(a),  fy = Math.sin(a);      // forward
    var rx = -Math.sin(a), ry = Math.cos(a);      // the model's right

    // local (forward, right) -> screen offset, carrying the vertical squash
    function ox(u, v) { return u * fx + v * rx; }
    function oy(u, v) { return (u * fy + v * ry) * SQUASH; }

    var lean = Math.atan2(fy * SQUASH, fx);       // screen angle of "forward"

    ctx.save();

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.85, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();

    // feet, stepping along the forward axis
    ctx.fillStyle = "#8f8f8f";
    [-1, 1].forEach(function (s) {
      var u = s * swing * r * 0.30, v = s * r * 0.42;
      ctx.beginPath();
      ctx.ellipse(x + ox(u, v), y - r * 0.08 + oy(u, v),
                  r * 0.30, r * 0.17, lean, 0, Math.PI * 2);
      ctx.fill();
    });

    /* Hands, swinging opposite the feet. Facing along the screen puts one
       hand nearer the camera and one further away, so they are depth-sorted
       around the body instead of both hiding behind it. */
    var hands = [-1, 1].map(function (s) {
      var u = -s * swing * r * 0.34, v = s * r * 1.08;
      var dy = oy(u, v);
      return { x: x + ox(u, v), y: bodyY + r * 0.18 + dy, depth: dy };
    }).sort(function (p, q) { return p.depth - q.depth; });

    function paintHand(h) {
      ctx.fillStyle = "#b9b9b9";
      ctx.beginPath();
      ctx.arc(h.x, h.y, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }

    paintHand(hands[0]);                             // the far hand

    // body
    ctx.fillStyle = "#ededed";
    ctx.beginPath();
    ctx.arc(x, bodyY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.13)";              // grounding shade
    ctx.beginPath();
    ctx.arc(x, bodyY + r * 0.30, r * 0.86, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.fill();

    paintHand(hands[1]);                             // the near hand, over the body

    // eyes look where you face
    ctx.fillStyle = "#1a1a1a";
    [-1, 1].forEach(function (s) {
      var u = r * 0.34, v = s * r * 0.38;
      ctx.beginPath();
      ctx.ellipse(x + ox(u, v), bodyY - r * 0.12 + oy(u, v),
                  r * 0.13, r * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  };

  BG.World.prototype.drawGhost = function (ctx, x, y, TS, g) {
    var r = TS * 0.30;
    var bodyY = y - r * 0.85;
    var wob = Math.sin(this.time * 7 + x) * r * 0.06;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.8, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = g.state === "chase" ? g.color : shade(g.color, -0.22);
    ctx.beginPath();
    ctx.arc(x, bodyY + wob, r, Math.PI, 0);
    ctx.lineTo(x + r, bodyY + r * 0.9 + wob);
    var waves = 4, step = (r * 2) / waves;
    for (var i = 0; i < waves; i++) {
      var x0 = x + r - i * step;
      ctx.quadraticCurveTo(x0 - step / 2, bodyY + r * (i % 2 ? 1.15 : 0.55) + wob,
                           x0 - step, bodyY + r * 0.9 + wob);
    }
    ctx.closePath();
    ctx.fill();

    // eyes track the player
    var dx = this.player.x - g.x, dy = (this.player.y - g.y) * SQUASH;
    var len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    [-1, 1].forEach(function (s) {
      var ex = x + s * r * 0.38, ey = bodyY - r * 0.12 + wob;
      ctx.fillStyle = "#f2f2f2";
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.22, r * 0.27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#151515";
      ctx.beginPath();
      ctx.arc(ex + dx * r * 0.09, ey + dy * r * 0.11, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  };

  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function f(c) { return Math.max(0, Math.min(255, Math.round(c + c * amt))); }
    return "rgb(" + f(r) + "," + f(g) + "," + f(b) + ")";
  }

  BG.UNIT = UNIT;

})(window.BG);
