/* Jelly Cargo — run state, the loop, and the API every ability calls into. */
window.JC = window.JC || {};
(function (JC) {
  "use strict";

  /* One leg of the journey, in world pixels. Bump this if you want longer
     hauls between cargo stops; four card draws are spaced across it. */
  var LEG_BASE = 150000;
  var LEG_GROW = 26000;
  var LEG_CAP = 320000;

  var BASE_FIRE = 0.75;          // seconds between shots before modifiers

  function baseStats() {
    return {
      damage: 1, fireRate: 1, bulletSpeed: 1, bulletSize: 1, bulletLife: 1.4,
      pierce: 0, multishot: 0, crit: 0.03, critMul: 2, homing: 0, splash: 0,
      phase: false, bulletEat: 0,

      truckHp: 100, cargoHp: 100, armor: 0, regen: 0, cargoRegen: 0,
      cargoArmor: 0, cargoGrip: 0, cargoSlots: 6,
      shieldMax: 0, shieldRegen: 1, shieldDelay: 4, dodge: 0, thorns: 0,
      stability: 0, fallRes: 0, bounce: 0,

      torque: 1, grip: 1, maxSpeed: 1, airControl: 0,
      boostPower: 1, fuelRegen: 6, fuelDur: 1.1,

      goldMul: 1, sellMul: 1, luck: 0, magnet: 90, spillSave: 0, ram: 1,
      drones: 0, droneDmg: 0, droneEl: null
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  JC.Game = function (canvas, ui, seed) {
    this.canvas = canvas;
    this.ui = ui;
    this.seed = seed || Math.floor(Math.random() * 1e9);
    this.rng = JC.rng(this.seed + 4242);

    this.renderer = new JC.Renderer(canvas);
    this.renderer.resize();
    this.input = new JC.Input(canvas);
    this.fx = new JC.FX();

    this.terrain = new JC.Terrain(this.seed);
    this.world = new JC.World(this.terrain);
    this.structures = new JC.Structures(this.world, this.terrain);
    var self = this;
    this.world.onRelax = function () { self.structures.lashPlanks(); };

    this.abilities = new JC.AbilitySet();
    this.gear = [];
    this.director = new JC.Director(this.seed);

    this.enemies = [];
    this.bullets = [];
    this.hazards = [];
    this.vortexes = [];
    this.turrets = [];
    this.drones = [];
    this.pickups = [];
    this.buffs = {};
    this.count = {};

    this.time = 0;
    this.distance = 0;
    this.startX = 0;
    this.leg = 0;
    this.legStart = 0;
    this.legLen = LEG_BASE;
    this.pullsThisLeg = 0;
    this.pullCount = 0;
    this.gold = 0;
    this.kills = 0;
    this.shield = 0;
    this.shieldTimer = 0;
    this.hurtFlash = 0;
    this.paused = false;
    this.atStop = false;
    this.over = false;
    this.stopX = 0;

    this.stats = baseStats();

    // put the truck on the ground at the start
    var sx = 300;
    this.truck = new JC.Truck(this.world, sx, this.terrain.heightAt(sx) - 120);
    this.startX = sx;
    this.truckHp = this.stats.truckHp;
    this.cargoHp = this.stats.cargoHp;
    for (var i = 0; i < 4; i++) this.truck.loadCrate("boxes");

    this.recomputeStats();
    this.truckHp = this.stats.truckHp;
    this.cargoHp = this.stats.cargoHp;
    this.legLen = LEG_BASE;
    this.stopX = sx + this.legLen;
  };

  var G = JC.Game.prototype;

  // ── stats ─────────────────────────────────────────────────────────────────
  function gearById(id) {
    for (var i = 0; i < JC.GEAR.length; i++) if (JC.GEAR[i].id === id) return JC.GEAR[i];
    return null;
  }
  function statById(id) {
    for (var i = 0; i < JC.STATS.length; i++) if (JC.STATS[i].id === id) return JC.STATS[i];
    return null;
  }
  JC.gearById = gearById;
  JC.statById = statById;

  /* Everything owned is stored as { kind, id, ... } rather than a closure, so
     the whole run serialises to JSON without losing anything. */
  G.recomputeStats = function () {
    var s = baseStats();
    var i;
    for (i = 0; i < this.gear.length; i++) {
      var g = this.gear[i];
      if (g.kind === "stat") {
        var sd = statById(g.id);
        if (sd) sd.apply(s, g.n);
      } else {
        var gd = gearById(g.id);
        if (gd) gd.apply(s, g.mul);
      }
    }
    this.abilities.applyMods(this, s);
    for (var k in this.buffs) {
      if (this.buffs[k].t > 0 && s[k] !== undefined) s[k] *= this.buffs[k].v;
    }
    this.stats = s;
  };

  G.buff = function (stat, mul, dur) {
    var b = this.buffs[stat];
    if (!b || b.v < mul) this.buffs[stat] = { v: mul, t: dur };
    else b.t = Math.max(b.t, dur);
  };

  G.diffFireMul = function () { return 1 + this.leg * 0.06; };

  // ── ability-facing API ────────────────────────────────────────────────────
  G.enemiesIn = function (x, y, r) {
    var out = [], r2 = r * r;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dead) continue;
      var dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= r2) out.push(e);
    }
    return out;
  };

  G.nearestEnemy = function (x, y, r, skip) {
    var best = null, bd = r * r;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dead || e === skip) continue;
      var dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  G.spawnBullet = function (o) {
    var b = {
      x: o.x, y: o.y, vx: o.vx, vy: o.vy,
      dmg: o.dmg, size: (o.size || 6), el: o.el || null,
      pierce: o.pierce || 0, life: o.life || 1.4, hitList: [],
      homing: o.homing || 0, rocket: !!o.rocket, beam: !!o.beam,
      explode: o.explode || 0, hostile: !!o.hostile, minor: !!o.minor,
      bounced: 0, arc: o.arc || 0
    };
    this.bullets.push(b);
    return b;
  };

  G.explode = function (x, y, r, d, o) {
    o = o || {};
    this.fx.ring(x, y, r, o.el && JC.ELEMENTS[o.el] ? JC.ELEMENTS[o.el].color : "#FFD24F");
    this.fx.burst(x, y, o.el && JC.ELEMENTS[o.el] ? JC.ELEMENTS[o.el].color : "#FFA83C", 14);
    var list = this.enemiesIn(x, y, r);
    for (var i = 0; i < list.length; i++) {
      list[i].hurt(d, this);
      if (o.burn) JC.addStatus(list[i], "burn", o.burn);
      list[i].knock(JC.sign(list[i].x - x) * 180, -110);
    }
    this.shake(Math.min(9, r / 22));
  };

  G.chainFrom = function (e, n, d) {
    var from = e;
    for (var i = 0; i < n; i++) {
      var next = this.nearestEnemy(from.x, from.y, 260, from);
      if (!next) break;
      this.fx.bolt(from.x, from.y, next.x, next.y);
      next.hurt(d, this);
      JC.addStatus(next, "shock", 1);
      from = next;
    }
  };

  G.addHazard = function (x, y, r, life, kind, dps, o) {
    if (this.hazards.length > 90) this.hazards.shift();
    this.hazards.push({ x: x, y: y, r: r, t: life, max: life, kind: kind,
                        dps: dps || 0, slow: (o && o.slow) || 0 });
  };

  G.addVortex = function (x, y, r, life, force) {
    this.vortexes.push({ x: x, y: y, r: r, t: life, f: force });
  };

  G.addTurret = function (x, y, dmg, life) {
    this.turrets.push({ x: x, y: y, dmg: dmg, t: life, cool: 0, ang: 0 });
  };

  G.healTruck = function (n) {
    this.truckHp = Math.min(this.stats.truckHp, this.truckHp + n);
  };

  G.healCargo = function (n) {
    this.cargoHp = Math.min(this.stats.cargoHp, this.cargoHp + n);
  };

  G.shake = function (n) { this.renderer.cam.shake = Math.min(26, this.renderer.cam.shake + n); };

  // ── damage ────────────────────────────────────────────────────────────────
  G.hurtTruck = function (amount, src) {
    if (this.over) return;
    if (this.rng() < this.stats.dodge) {
      this.fx.text(this.truck.pos().x, this.truck.pos().y - 70, "DODGE", "#7FE8C0");
      this.abilities.fire("onDodge", this);
      return;
    }
    var amt = Math.max(1, amount * (1 - (src && src.curse ? src.curse : 0)) - this.stats.armor);
    if (this.shield > 0) {
      var eaten = Math.min(this.shield, amt);
      this.shield -= eaten;
      amt -= eaten;
    }
    this.shieldTimer = this.stats.shieldDelay;
    if (amt > 0) {
      this.truckHp -= amt;
      this.hurtFlash = 0.12;
      this.shake(6);
      this.fx.text(this.truck.pos().x, this.truck.pos().y - 80, "-" + Math.round(amt), "#FF6B6B");
    }
    if (this.stats.thorns && src && src.hurt) src.hurt(this.stats.thorns, this);
    this.abilities.fire("onHurt", this, amount, src);
    if (this.truckHp <= 0) this.endRun("Your truck gave out.");
  };

  /* Cargo damage both drops the bar and physically shakes the crates. */
  G.jostleCargo = function (amount, src) {
    var amt = amount * (1 - Math.min(0.85, this.stats.cargoArmor));
    this.cargoHp -= amt;
    var grip = 1 / (1 + this.stats.cargoGrip);
    for (var i = 0; i < this.truck.crates.length; i++) {
      var c = this.truck.crates[i];
      c.impulse((this.rng() - 0.5) * 7 * grip, -this.rng() * 5 * grip);
    }
    this.checkCrateIntegrity();
  };

  G.sapCargo = function (e) {
    if (!this.truck.crates.length) return;
    var box = this.truck.crates[this.truck.crates.length - 1];
    box.impulse(-9, -7);
    this.jostleCargo(4, e);
  };

  /* Keeps the bar and the actual crate count in step. */
  G.checkCrateIntegrity = function () {
    var per = this.stats.cargoHp / Math.max(1, this.stats.cargoSlots);
    while (this.truck.crates.length > 0 && this.cargoHp < (this.truck.crates.length - 1) * per) {
      var box = this.truck.crates.pop();
      this.world.remove(box);
      this.fx.burst(box.centroid().x, box.centroid().y, box.color, 16);
      this.fx.text(box.centroid().x, box.centroid().y - 30, "CRATE LOST", "#FF9B4F");
    }
    if (this.cargoHp < 0) this.cargoHp = 0;
  };

  G.onSpill = function (kind) {
    var saved = this.abilities.fire("onSpill", this, kind);
    if (!saved && this.rng() < this.stats.spillSave) {
      this.truck.loadCrate(kind);
      saved = true;
    }
    if (saved) {
      this.fx.text(this.truck.pos().x, this.truck.pos().y - 90, "RECOVERED", "#7FE8C0");
      return;
    }
    var per = this.stats.cargoHp / Math.max(1, this.stats.cargoSlots);
    this.cargoHp = Math.max(0, this.cargoHp - per);
    this.fx.text(this.truck.pos().x - 80, this.truck.pos().y - 60, "CARGO LOST", "#FF9B4F");
    this.shake(4);
  };

  // ── firing ────────────────────────────────────────────────────────────────
  G.updateTurret = function (dt) {
    var t = this.truck.turret;
    var m = this.truck.turretMount();
    var w = this.renderer.screenToWorld(this.input.mouse.x, this.input.mouse.y);
    var want = Math.atan2(w.y - m.y, w.x - m.x);
    t.ang += JC.angDiff(t.ang, want) * Math.min(1, dt * 14);
    t.cool -= dt;
    t.recoil = Math.max(0, t.recoil - dt * 6);

    if (!this.input.mouse.down || t.cool > 0 || this.atStop || this.paused) return;
    t.cool = BASE_FIRE / this.stats.fireRate;
    t.recoil = 1;
    this.fireOnce(m, t.ang);
    for (var i = 0; i < this.stats.multishot; i++) {
      this.fireOnce(m, t.ang + (this.rng() - 0.5) * 0.13);
    }
  };

  G.fireOnce = function (m, ang) {
    var s = this.stats;
    var sp = 900 * s.bulletSpeed;
    var crit = this.rng() < s.crit;
    var b = this.spawnBullet({
      x: m.x + Math.cos(ang) * 30, y: m.y + Math.sin(ang) * 30,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      dmg: s.damage * (crit ? s.critMul : 1),
      size: 6 * s.bulletSize, pierce: s.pierce,
      life: s.bulletLife, homing: s.homing
    });
    b.crit = crit;
    b.speed = sp;
    this.abilities.fire("onFire", this, b);
    if (b.speed !== sp) {
      var a2 = Math.atan2(b.vy, b.vx);
      b.vx = Math.cos(a2) * b.speed; b.vy = Math.sin(a2) * b.speed;
    }
    this.fx.spawn(b.x, b.y, -Math.cos(ang) * 90, -Math.sin(ang) * 90, 0.18, "#FFE9A0", 4, 0);
  };

  G.spawnEnemyShot = function (e, tp, shell) {
    var a = Math.atan2(tp.y - e.y, tp.x - e.x) + (this.rng() - 0.5) * 0.12;
    var sp = shell ? 560 : 460;
    var b = this.spawnBullet({
      x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      dmg: e.def.dmg * 0.55, size: shell ? 9 : 6, hostile: true, life: 3
    });
    b.cargoDmg = e.def.cargoDmg * 0.5;
    b.src = e;
  };

  G.spawnBomb = function (e) {
    var b = this.spawnBullet({
      x: e.x, y: e.y + 16, vx: e.vx * 0.5, vy: 60,
      dmg: e.def.dmg, size: 10, hostile: true, life: 5
    });
    b.bomb = true;
    b.cargoDmg = e.def.cargoDmg;
    b.src = e;
  };

  // ── spawning ──────────────────────────────────────────────────────────────
  G.spawnEnemy = function (type, scale, offset) {
    var d = JC.ENEMIES[type];
    var tp = this.truck.pos();
    var side = this.rng() < 0.72 ? 1 : -1;          // mostly ahead of you
    var x = tp.x + side * (620 + (offset || 0) + this.rng() * 260);
    var y = d.air ? tp.y - 260 - this.rng() * 120 : this.terrain.heightAt(x) - d.r;
    if (y > 90000) y = tp.y - 200;
    var e = new JC.Enemy(type, x, y, scale);
    this.enemies.push(e);
    this.fx.puff(x, y, d.color, 8);
    return e;
  };

  // ── main update ───────────────────────────────────────────────────────────
  G.update = function (dt) {
    if (this.over) return;
    this.time += dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;

    var k;
    for (k in this.buffs) {
      this.buffs[k].t -= dt;
      if (this.buffs[k].t <= 0) delete this.buffs[k];
    }
    this.recomputeStats();

    this.handleInput(dt);

    // physics, in two fixed substeps for stability
    var sub = dt / 2;
    for (var s = 0; s < 2; s++) this.world.step(Math.min(sub, 1 / 90));

    var tp = this.truck.pos();
    this.terrain.ensure(tp.x + 2400);
    this.structures.update(tp.x);

    this.updateTurret(dt);
    this.updateBullets(dt);
    this.updateEnemies(dt);
    this.updateHazards(dt);
    this.updateVortexes(dt);
    this.updateTurretsDeployed(dt);
    this.updateDrones(dt);
    this.updatePickups(dt);
    this.updateCargo(dt);
    this.updateRegen(dt);

    this.director.update(dt, this);
    this.abilities.fire("onTick", this, dt);
    this.fx.update(dt);

    this.updateProgress(dt);
    this.checkFall();

    this.autoSaveT = (this.autoSaveT || 0) + dt;
    if (this.autoSaveT > 12) { this.autoSaveT = 0; JC.Save.saveRun(this); }

    this.renderer.follow(tp.x, tp.y, this.truck.vel().x, dt);
    this.input.endFrame();
  };

  G.handleInput = function (dt) {
    if (this.atStop || this.paused) return;
    var I = this.input, s = this.stats;
    var throttle = 0, lean = 0;
    if (I.held("ArrowRight", "d")) { throttle += 1; lean += 1; }
    if (I.held("ArrowLeft", "a")) { throttle -= 1; lean -= 1; }
    if (I.held("ArrowUp", "w")) throttle += 1;
    if (I.held("ArrowDown", "s")) throttle -= 1;
    throttle = JC.clamp(throttle, -1, 1);

    this.truck.drive(dt, throttle, lean * (1 + s.airControl), s);

    if (I.held("f") && this.abilities.has("thrusters") || I.held("f") && this.abilities.has("afterburner")) {
      this.truck.boost(dt, s);
    } else {
      this.truck.boosting = 0;
    }
    this.truck.rechargeFuel(dt, s);
    this.truck.selfRight(dt);

    // keyed abilities
    var acts = this.abilities.actives();
    for (var i = 0; i < acts.length; i++) {
      var A = acts[i];
      this.count["cd_" + A.id] = Math.max(0, (this.count["cd_" + A.id] || 0) - dt);
      if (I.tapped(A.a.active.key) && this.count["cd_" + A.id] <= 0) {
        this.count["cd_" + A.id] = A.a.active.cd;
        A.a.active.run(this, A.L);
      }
    }
  };

  G.updateBullets = function (dt) {
    var tp = this.truck.pos();
    for (var i = this.bullets.length - 1; i >= 0; i--) {
      var b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) { this.bullets.splice(i, 1); continue; }

      if (b.homing) {
        var t = b.hostile ? null : this.nearestEnemy(b.x, b.y, 460);
        if (t) {
          var want = Math.atan2(t.y - b.y, t.x - b.x);
          var cur = Math.atan2(b.vy, b.vx);
          var na = cur + JC.angDiff(cur, want) * Math.min(1, dt * b.homing);
          var sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        }
      }
      if (b.bomb || b.rocket) b.vy += 620 * dt;

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.el === "fire" && this.rng() < 0.4) this.fx.trail(b.x, b.y, "#FF9B3C");

      // ground
      var gy = this.terrain.heightAt(b.x);
      if (!this.stats.phase && b.y > gy && gy < 90000) {
        if (b.explode) this.explode(b.x, b.y, b.explode, b.dmg, { el: b.el });
        if (b.bomb) this.explode(b.x, b.y, 110, b.dmg, {});
        this.fx.burst(b.x, gy, "#D8C8A0", 5);
        this.bullets.splice(i, 1);
        continue;
      }

      if (b.hostile) {
        if (JC.dist(b.x, b.y, tp.x, tp.y) < 70) {
          if (this.rng() < this.stats.bulletEat) {
            this.fx.puff(b.x, b.y, "#D86AE8", 6);
          } else {
            this.hurtTruck(b.dmg, b.src);
            if (b.cargoDmg) this.jostleCargo(b.cargoDmg, b.src);
            if (b.bomb) this.explode(b.x, b.y, 120, b.dmg * 0.5, {});
          }
          this.bullets.splice(i, 1);
        }
        continue;
      }

      // friendly vs enemies
      var hits = this.enemiesIn(b.x, b.y, b.size + 14);
      for (var h = 0; h < hits.length; h++) {
        var e = hits[h];
        if (b.hitList.indexOf(e) >= 0) continue;
        b.hitList.push(e);

        e.hurt(b.dmg, this, b);
        this.abilities.fire("onHit", this, b, e);
        if (b.crit) this.fx.text(e.x, e.y - 40, "CRIT", "#FFD24F");
        if (b.explode) this.explode(b.x, b.y, b.explode, b.dmg * 0.6, { el: b.el });
        if (this.stats.splash) this.explode(b.x, b.y, this.stats.splash, b.dmg * 0.5, { el: b.el });

        if (b.pierce > 0) { b.pierce--; }
        else { this.bullets.splice(i, 1); break; }
      }
    }
  };

  G.updateEnemies = function (dt) {
    var tp = this.truck.pos();
    var tv = this.truck.vel();
    var ramSpeed = Math.abs(tv.x);

    for (var i = this.enemies.length - 1; i >= 0; i--) {
      var e = this.enemies[i];
      if (e.dead) {
        if (this.rng() < 0.85) this.pickups.push({ x: e.x, y: e.y, vy: -120, v: 1 });
        this.enemies.splice(i, 1);
        continue;
      }
      if (Math.abs(e.x - tp.x) > 2600) { this.enemies.splice(i, 1); continue; }
      e.update(dt, this);

      // ramming
      if (!e.dead && ramSpeed > 3.2 && JC.dist(e.x, e.y, tp.x, tp.y) < 100) {
        e.ramCool = (e.ramCool || 0) - dt;
        if (e.ramCool <= 0) {
          e.ramCool = 0.4;
          var d = ramSpeed * 4 * this.stats.ram;
          e.hurt(d, this);
          e.knock(JC.sign(tv.x) * 320, -180);
          this.abilities.fire("onRam", this, e);
          this.fx.burst(e.x, e.y, "#FFD24F", 12);
          this.shake(4);
        }
      }
    }
  };

  G.updateHazards = function (dt) {
    for (var i = this.hazards.length - 1; i >= 0; i--) {
      var h = this.hazards[i];
      h.t -= dt;
      if (h.t <= 0) { this.hazards.splice(i, 1); continue; }
      if (!h.dps && !h.slow) continue;
      var list = this.enemiesIn(h.x, h.y, h.r);
      for (var j = 0; j < list.length; j++) {
        if (h.dps) list[j].hurt(h.dps * dt, this);
        if (h.kind === "fire") JC.addStatus(list[j], "burn", dt * 1.2);
        if (h.kind === "ice") JC.addStatus(list[j], "slow", dt * 0.5);
        if (h.kind === "acid") JC.addStatus(list[j], "poison", dt * 1.2);
        if (h.kind === "volt") JC.addStatus(list[j], "shock", dt);
        if (h.kind === "oil") JC.addStatus(list[j], "oiled", dt * 2);
        if (h.slow) JC.addStatus(list[j], "slow", h.slow * dt);
      }
    }
  };

  G.updateVortexes = function (dt) {
    for (var i = this.vortexes.length - 1; i >= 0; i--) {
      var v = this.vortexes[i];
      v.t -= dt;
      if (v.t <= 0) { this.vortexes.splice(i, 1); continue; }
      var list = this.enemiesIn(v.x, v.y, v.r);
      for (var j = 0; j < list.length; j++) {
        var e = list[j];
        e.vx += (v.x - e.x) * v.f * dt * 0.02;
        e.vy += (v.y - e.y) * v.f * dt * 0.02;
      }
      this.fx.orb(v.x, v.y, "#D86AE8", 10 + Math.sin(this.time * 12) * 4);
    }
  };

  G.updateTurretsDeployed = function (dt) {
    for (var i = this.turrets.length - 1; i >= 0; i--) {
      var t = this.turrets[i];
      t.t -= dt;
      if (t.t <= 0) { this.turrets.splice(i, 1); continue; }
      var e = this.nearestEnemy(t.x, t.y, 520);
      if (!e) continue;
      t.ang = Math.atan2(e.y - t.y, e.x - t.x);
      t.cool -= dt;
      if (t.cool > 0) continue;
      t.cool = 0.5;
      this.spawnBullet({ x: t.x, y: t.y, vx: Math.cos(t.ang) * 800, vy: Math.sin(t.ang) * 800,
                         dmg: t.dmg, size: 5, life: 1.2 });
    }
  };

  G.updateDrones = function (dt) {
    var want = this.stats.drones;
    while (this.drones.length < want) this.drones.push({ a: this.drones.length * 2.1, cool: 0 });
    while (this.drones.length > want) this.drones.pop();
    var tp = this.truck.pos();
    for (var i = 0; i < this.drones.length; i++) {
      var d = this.drones[i];
      d.a += dt * 1.5;
      d.x = tp.x + Math.cos(d.a) * 105;
      d.y = tp.y + Math.sin(d.a) * 52 - 80;
      d.cool -= dt;
      if (d.cool > 0) continue;
      var e = this.nearestEnemy(d.x, d.y, 480);
      if (!e) continue;
      d.cool = 0.8;
      var ang = Math.atan2(e.y - d.y, e.x - d.x);
      this.spawnBullet({ x: d.x, y: d.y, vx: Math.cos(ang) * 760, vy: Math.sin(ang) * 760,
                         dmg: this.stats.droneDmg, size: 5, el: this.stats.droneEl, life: 1.2 });
    }
  };

  G.updatePickups = function (dt) {
    var tp = this.truck.pos();
    for (var i = this.pickups.length - 1; i >= 0; i--) {
      var p = this.pickups[i];
      var d = JC.dist(p.x, p.y, tp.x, tp.y);
      if (d < this.stats.magnet) {
        p.x += (tp.x - p.x) * dt * 7;
        p.y += (tp.y - p.y) * dt * 7;
      } else {
        p.vy = (p.vy || 0) + 900 * dt;
        p.y += p.vy * dt;
        var gy = this.terrain.heightAt(p.x);
        if (p.y > gy - 8 && gy < 90000) { p.y = gy - 8; p.vy = 0; }
      }
      if (d < 46) {
        this.gold += Math.round(2 * this.stats.goldMul);
        this.pickups.splice(i, 1);
      } else if (p.x < tp.x - 1800) {
        this.pickups.splice(i, 1);
      }
    }
  };

  /* Crates settle toward their slot. Weak by default so a bad landing still
     throws them, stronger with every point of cargo grip you buy. */
  G.settleCargo = function (dt) {
    var k = Math.min(0.5, (0.9 + this.stats.cargoGrip * 2.2) * dt);
    for (var i = 0; i < this.truck.crates.length; i++) {
      var box = this.truck.crates[i];
      var slot = this.truck.bedSlot(i);
      var c = box.centroid();
      var dx = slot.x - c.x, dy = slot.y - c.y;
      if (Math.hypot(dx, dy) > 150) continue;         // already on its way out
      for (var p = 0; p < box.pts.length; p++) {
        box.pts[p].x += dx * k;
        box.pts[p].y += dy * k;
      }
    }
  };

  G.updateCargo = function (dt) {
    this.settleCargo(dt);
    var lost = this.truck.checkSpills();
    for (var i = 0; i < lost.length; i++) this.onSpill(lost[i]);

    // retire crates that tumbled away
    var now = performance.now();
    for (var j = this.world.bodies.length - 1; j >= 0; j--) {
      var b = this.world.bodies[j];
      if (b.userData.despawnAt && now > b.userData.despawnAt) this.world.remove(b);
    }
    if (this.stats.cargoRegen) this.healCargo(this.stats.cargoRegen * dt);
  };

  G.updateRegen = function (dt) {
    if (this.stats.regen) this.healTruck(this.stats.regen * dt);
    this.shieldTimer -= dt;
    if (this.shieldTimer <= 0 && this.shield < this.stats.shieldMax) {
      this.shield = Math.min(this.stats.shieldMax, this.shield + this.stats.shieldRegen * 6 * dt);
    }
  };

  /* Falling into a chasm is survivable, but it costs. */
  G.checkFall = function () {
    var tp = this.truck.pos();
    var gy = this.terrain.heightAt(tp.x);
    var floor = (gy > 90000 ? this.renderer.cam.y + 1400 : gy + 1200);
    if (tp.y < floor) return;

    this.hurtTruck(24 * (1 - Math.min(0.8, this.stats.fallRes)), null);
    if (this.over) return;
    this.jostleCargo(14, null);

    // winch back to solid ground behind the chasm
    var back = tp.x;
    for (var i = 0; i < 200; i++) {
      back -= 24;
      if (!this.terrain.isGap(back) && this.terrain.heightAt(back) < 90000) break;
    }
    var ny = this.terrain.heightAt(back) - 130;
    var dx = back - tp.x, dy = ny - tp.y;
    this.truck.chassis.translate(dx, dy);
    this.truck.wheels.forEach(function (w) { w.translate(dx, dy); });
    this.truck.chassis.pts.forEach(function (p) { p.px = p.x; p.py = p.y; });
    this.truck.crates.forEach(function (c) { c.translate(dx, dy); });
    this.fx.text(back, ny - 60, "WINCHED OUT", "#FFD24F");
    this.shake(12);
  };

  // ── progress, cards, stops ────────────────────────────────────────────────
  G.legProgress = function () {
    return JC.clamp((this.truck.pos().x - this.legStart - this.startX) / this.legLen, 0, 1);
  };

  G.updateProgress = function (dt) {
    var x = this.truck.pos().x;
    this.distance = Math.max(this.distance, x - this.startX);

    if (this.atStop) return;
    var p = this.legProgress();
    var wantPulls = Math.floor(p * 4);
    if (wantPulls > this.pullsThisLeg && this.pullsThisLeg < 4) {
      this.pullsThisLeg++;
      this.pullCount++;
      this.offerCards();
      return;
    }
    if (x >= this.stopX) this.openStop();
  };

  /* Three cards: one or two plain stat upgrades, the rest abilities. Every
     other draw the ability slots offer upgrades to what you already own. */
  G.offerCards = function () {
    var upgradePull = (this.pullCount % 2) === 0;
    var statCount = this.rng() < 0.55 ? 1 : 2;
    var abilityCount = 3 - statCount;
    var cards = [];
    var i;

    var statPool = JC.STATS.slice();
    var stats = this.rng.shuffle(statPool).slice(0, statCount);
    for (i = 0; i < stats.length; i++) {
      cards.push({ kind: "stat", stat: stats[i],
                   n: 1 + (this.rng() < this.stats.luck * 0.3 ? 1 : 0) });
    }

    var picked = {};
    for (i = 0; i < abilityCount; i++) {
      var c = this.pickAbilityCard(upgradePull, picked);
      if (c) { cards.push(c); picked[c.id] = true; }
    }
    // if the ability pool ran dry, top up with stats
    while (cards.length < 3) {
      cards.push({ kind: "stat", stat: this.rng.pick(JC.STATS), n: 1 });
    }

    this.paused = true;
    this.ui.showCards(this.rng.shuffle(cards), this);
  };

  G.pickAbilityCard = function (preferUpgrade, taken) {
    var A = this.abilities, i, pool;

    if (preferUpgrade) {
      pool = A.upgradable().filter(function (id) { return !taken[id]; });
      if (pool.length) {
        var id = this.rng.pick(pool);
        return { kind: "upgrade", id: id, ab: JC.ABILITIES[id], to: A.level(id) + 1 };
      }
    }

    // unlocked variants come first — they are the reward for specialising
    var vars = A.unlockedVariants().filter(function (v) { return !taken[v]; });
    if (vars.length && this.rng() < 0.55) {
      var vid = this.rng.pick(vars);
      return { kind: "variant", id: vid, ab: JC.ABILITIES[vid] };
    }

    pool = [];
    var all = JC.abilityList();
    for (i = 0; i < all.length; i++) {
      var a = JC.ABILITIES[all[i]];
      if (a.isVariant) continue;
      if (A.has(a.id) || taken[a.id]) continue;
      pool.push(a.id);
    }
    if (!pool.length) {
      pool = A.upgradable().filter(function (x) { return !taken[x]; });
      if (!pool.length) return null;
      var uid = this.rng.pick(pool);
      return { kind: "upgrade", id: uid, ab: JC.ABILITIES[uid], to: A.level(uid) + 1 };
    }
    var nid = this.rng.pick(pool);
    return { kind: "new", id: nid, ab: JC.ABILITIES[nid] };
  };

  G.takeCard = function (card) {
    if (card.kind === "stat") {
      this.gear.push({ kind: "stat", id: card.stat.id, n: card.n, name: card.stat.name });
    } else {
      this.abilities.grant(card.id);
    }
    this.recomputeStats();
    this.paused = false;
    JC.Save.saveRun(this);
  };

  G.openStop = function () {
    this.atStop = true;
    this.paused = true;
    this.stopScreenX = this.truck.pos().x;
    this.shop = JC.rollShop(this.rng, this.leg, this.stats.luck);
    this.ui.showStop(this);
  };

  G.leaveStop = function () {
    this.atStop = false;
    this.paused = false;
    this.leg++;
    this.legStart = this.truck.pos().x - this.startX;
    this.legLen = Math.min(LEG_CAP, LEG_BASE + LEG_GROW * this.leg);
    this.stopX = this.truck.pos().x + this.legLen;
    this.pullsThisLeg = 0;
    JC.Save.saveRun(this);
  };

  G.sellAll = function () {
    var kinds = this.truck.unloadAll();
    var total = 0;
    for (var i = 0; i < kinds.length; i++) {
      total += JC.sellPrice(kinds[i], this.leg, this.stats.sellMul);
    }
    this.gold += total;
    this.cargoHp = this.stats.cargoHp;
    return { total: total, count: kinds.length };
  };

  G.buyGear = function (entry) {
    if (entry.bought || this.gold < entry.cost) return false;
    this.gold -= entry.cost;
    entry.bought = true;
    this.gear.push({ kind: "gear", id: entry.gear.id, mul: entry.mul,
                     gradeName: entry.grade.name, name: entry.gear.name });
    this.recomputeStats();
    JC.Save.saveRun(this);
    return true;
  };

  G.buyCargo = function (offer) {
    if (this.gold < offer.cost) return false;
    if (this.truck.crates.length >= this.stats.cargoSlots) return false;
    this.gold -= offer.cost;
    this.truck.loadCrate(offer.kind);
    this.cargoHp = Math.min(this.stats.cargoHp,
      this.cargoHp + this.stats.cargoHp / Math.max(1, this.stats.cargoSlots));
    return true;
  };

  G.endRun = function (reason) {
    if (this.over) return;
    this.over = true;
    this.paused = true;
    this.reason = reason;
    JC.Save.clearRun();
    JC.Save.recordRun(this);
    this.ui.showGameOver(this);
  };

  // ── draw ──────────────────────────────────────────────────────────────────
  G.draw = function () {
    var R = this.renderer;
    R.begin();
    var biome = R.drawSky(this.terrain);
    R.drawFar(this.terrain, biome);
    R.world();

    R.drawDecor(this.terrain, true);
    R.drawTerrain(this.terrain);
    R.drawHazards(this.hazards);
    R.drawDecor(this.terrain, false);
    if (this.atStop || Math.abs(this.truck.pos().x - this.stopX) < 1400) {
      var sx = this.stopX;
      R.drawStop(sx, this.terrain.heightAt(sx));
    }
    R.drawBodies(this.world, this.truck);
    R.drawPickups(this.pickups);
    R.drawTurrets(this.turrets);
    R.drawEnemies(this.enemies);
    R.drawTruck(this.truck, this);
    for (var i = 0; i < this.drones.length; i++) {
      var d = this.drones[i];
      R.drawTurrets([{ x: d.x, y: d.y, ang: 0 }]);
    }
    R.drawBullets(this.bullets);
    R.drawFX(this.fx);
    R.end();
  };

  G.destroy = function () {
    this.input.destroy(this.canvas);
  };

})(window.JC);
