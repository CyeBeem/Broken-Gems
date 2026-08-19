/* Goblins, their bullets, and the status effects abilities hang off them.
   Enemies are simple kinematic actors rather than soft bodies — a hundred
   wobbling goblins would eat the frame budget and you would never notice. */
window.JC = window.JC || {};
(function (JC) {
  "use strict";

  /* hp is in bullet-hits at base damage 1, so a plain goblin dies in three. */
  JC.ENEMIES = {
    runner: {
      name: "Goblin", hp: 2, r: 17, spd: 130, dmg: 6, cargoDmg: 0, gold: 4,
      threat: 0, weight: 10, air: false, color: "#7FBF4F", noScale: true,
      blurb: "Runs at you shrieking. Not complicated."
    },
    moto: {
      name: "Moto Goblin", hp: 4, r: 20, spd: 210, dmg: 9, cargoDmg: 3, gold: 7,
      threat: 0, weight: 9, air: false, color: "#E86A3C",
      blurb: "Rides in fast, rams the tailgate, wheels away."
    },
    drone: {
      name: "Drone Surfer", hp: 3, r: 18, spd: 120, dmg: 5, cargoDmg: 4, gold: 8,
      threat: 40, weight: 8, air: true, color: "#6FA8E8", shoots: 2.4,
      blurb: "Hovers overhead and plinks at your cargo."
    },
    slinger: {
      name: "Rock Slinger", hp: 4, r: 17, spd: 90, dmg: 7, cargoDmg: 2, gold: 7,
      threat: 60, weight: 7, air: false, color: "#B8A05A", shoots: 2.9, standoff: 380,
      blurb: "Keeps its distance and lobs rocks at the bed."
    },
    sapper: {
      name: "Sapper", hp: 5, r: 16, spd: 185, dmg: 2, cargoDmg: 9, gold: 10,
      threat: 90, weight: 6, air: false, color: "#C86AD8", latch: true,
      blurb: "Latches onto the bed and starts throwing your crates out."
    },
    brute: {
      name: "Brute", hp: 12, r: 28, spd: 100, dmg: 16, cargoDmg: 6, gold: 16,
      threat: 130, weight: 6, air: false, color: "#4F9E5F", knockRes: 0.55,
      blurb: "Big, green, and swings hard enough to shift the whole truck."
    },
    bomber: {
      name: "Bomber", hp: 5, r: 22, spd: 150, dmg: 12, cargoDmg: 10, gold: 14,
      threat: 170, weight: 6, air: true, color: "#D8544F", bombs: 2.6,
      blurb: "Flies over the bed and drops something unpleasant."
    },
    jetpack: {
      name: "Jetpack Goblin", hp: 6, r: 18, spd: 195, dmg: 11, cargoDmg: 4, gold: 13,
      threat: 210, weight: 6, air: true, color: "#E8B03C", dives: true,
      blurb: "Hovers, picks a moment, then dives straight at the cab."
    },
    gtruck: {
      name: "Goblin Truck", hp: 20, r: 38, spd: 170, dmg: 18, cargoDmg: 8, gold: 26,
      threat: 260, weight: 5, air: false, knockRes: 0.75, shoots: 1.9,
      color: "#8A6ED8", big: true,
      blurb: "Their answer to yours. Rams, and has a gun on the roof."
    },
    tank: {
      name: "Goblin Tank", hp: 34, r: 42, spd: 80, dmg: 22, cargoDmg: 12, gold: 40,
      threat: 340, weight: 4, air: false, knockRes: 0.9, shoots: 2.2, shell: true,
      color: "#6E7A52", big: true,
      blurb: "Slow, armoured, and the shells arc right into your bed."
    },
    warlord: {
      name: "Warlord", hp: 70, r: 46, spd: 140, dmg: 26, cargoDmg: 16, gold: 90,
      threat: 460, weight: 2, air: false, knockRes: 0.95, shoots: 1.4, elite: true,
      color: "#D83C6A", big: true,
      blurb: "Wears a hubcap as a crown. Earned it."
    },
    zeppelin: {
      name: "Goblin Zeppelin", hp: 90, r: 60, spd: 85, dmg: 20, cargoDmg: 20, gold: 120,
      threat: 560, weight: 2, air: true, bombs: 1.3, elite: true, knockRes: 1,
      color: "#C8783C", big: true,
      blurb: "Drifts overhead raining barrels. Shoot it down."
    }
  };

  // ── status effects ────────────────────────────────────────────────────────
  /* Abilities stack these onto enemies; the update loop reads them back. */
  JC.STATUS = {
    burn:   { dot: 2.6, decay: 1, color: "#FF7A3C", max: 12 },
    poison: { dot: 1.5, decay: 0.5, color: "#8FE84F", max: 16 },
    bleed:  { dot: 3.4, decay: 1.4, color: "#E84F6A", max: 10 },
    slow:   { decay: 0.55, color: "#7FD8FF", max: 0.75 },
    shock:  { decay: 1.5, color: "#FFE24F", max: 6 },
    wet:    { decay: 0.5, color: "#4FB3E8", max: 1 },
    oiled:  { decay: 0.35, color: "#4A4A55", max: 1 },
    mark:   { decay: 0.4, color: "#FF4FD8", max: 4 },
    freeze: { decay: 1, color: "#BFEFFF", max: 3 },
    corrode:{ decay: 0.6, color: "#B8E84F", max: 8 }
  };

  JC.addStatus = function (e, type, amount, cap) {
    if (!e || e.dead) return;
    e.st = e.st || {};
    var def = JC.STATUS[type];
    var lim = cap !== undefined ? cap : (def ? def.max : 99);
    e.st[type] = Math.min(lim, (e.st[type] || 0) + amount);
  };

  JC.hasStatus = function (e, type) { return !!(e.st && e.st[type] > 0.001); };

  // ── enemy ─────────────────────────────────────────────────────────────────
  JC.Enemy = function (type, x, y, scale) {
    var d = JC.ENEMIES[type];
    /* Starter goblins are the yardstick for "two bullets", so their health
       never scales. Difficulty comes from numbers and from nastier types. */
    scale = d.noScale ? 1 : Math.max(1, scale || 1);
    this.type = type;
    this.def = d;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.maxHp = d.hp * (scale || 1);
    this.hp = this.maxHp;
    this.r = d.r;
    this.dead = false;
    this.st = {};
    this.cool = Math.random() * 2;
    this.phase = Math.random() * 6.28;
    this.hitFlash = 0;
    this.latched = null;
    this.stun = 0;
    this.facing = -1;
    this.bob = Math.random() * 6.28;
    this.gold = d.gold;
  };

  var E = JC.Enemy.prototype;

  E.speedMul = function () {
    var s = 1;
    if (this.st.slow) s *= (1 - Math.min(0.8, this.st.slow));
    if (this.st.freeze > 0) s = 0;
    if (this.stun > 0) s = 0;
    return s;
  };

  /* Returns true if it died. */
  E.hurt = function (n, G, src) {
    if (this.dead) return false;
    if (this.st.mark) n *= 1 + this.st.mark * 0.18;
    this.hp -= n;
    this.hitFlash = 0.12;
    if (G) G.fx.hit(this.x, this.y, n);
    if (this.hp <= 0) { this.die(G, src); return true; }
    return false;
  };

  E.die = function (G, src) {
    if (this.dead) return;
    this.dead = true;
    if (!G) return;
    G.fx.burst(this.x, this.y, this.def.color, this.def.big ? 26 : 14);
    G.gold += Math.round(this.gold * G.stats.goldMul);
    G.kills++;
    G.abilities.fire("onKill", G, this, src);
  };

  E.update = function (dt, G) {
    var i;
    // status ticks
    for (var k in this.st) {
      if (!this.st[k]) continue;
      var def = JC.STATUS[k];
      if (def && def.dot) {
        var mul = 1;
        if (k === "burn" && this.st.oiled) mul = 2.2;         // oil feeds fire
        this.hurt(def.dot * this.st[k] * dt * mul, G);
        if (this.dead) return;
      }
      this.st[k] = Math.max(0, this.st[k] - (def ? def.decay : 1) * dt);
    }
    if (this.stun > 0) this.stun -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // fire plus wet makes steam, which bursts for a chunk
    if (this.st.burn > 0.5 && this.st.wet > 0.3) {
      this.st.wet = 0;
      this.st.burn *= 0.4;
      this.hurt(4 + G.stats.damage * 2, G);
      G.fx.puff(this.x, this.y, "#DFF2FF", 16);
      if (this.dead) return;
    }
    // lightning through water arcs to the neighbours
    if (this.st.shock > 0.5 && this.st.wet > 0.3) {
      this.st.shock *= 0.5;
      G.chainFrom(this, 3, 2 + G.stats.damage);
    }

    var spd = this.speedMul();
    var tp = G.truck.pos();
    var d = this.def;

    if (this.latched) { this.updateLatched(dt, G, tp); return; }

    if (d.air) this.moveAir(dt, G, tp, spd);
    else this.moveGround(dt, G, tp, spd);

    this.facing = tp.x < this.x ? -1 : 1;
    this.bob += dt * 8;

    // ranged attacks
    if (d.shoots) {
      this.cool -= dt * spd;
      if (this.cool <= 0 && Math.abs(this.x - tp.x) < 760) {
        this.cool = d.shoots / G.diffFireMul();
        G.spawnEnemyShot(this, tp, d.shell);
      }
    }
    if (d.bombs) {
      this.cool -= dt * spd;
      if (this.cool <= 0 && Math.abs(this.x - tp.x) < 240) {
        this.cool = d.bombs / G.diffFireMul();
        G.spawnBomb(this);
      }
    }

    // contact
    var dd = JC.dist(this.x, this.y, tp.x, tp.y);
    if (dd < this.r + 62) this.touch(G, tp);
  };

  E.moveGround = function (dt, G, tp, spd) {
    var gy = G.terrain.heightAt(this.x);
    var dir = tp.x > this.x ? 1 : -1;
    var want = this.def.spd * spd * dir;

    if (this.def.standoff) {
      var gap = Math.abs(this.x - tp.x);
      if (gap < this.def.standoff) want = -dir * this.def.spd * 0.6 * spd;
      else if (gap < this.def.standoff + 60) want = 0;
    }

    this.vx = JC.lerp(this.vx, want, 1 - Math.pow(0.001, dt));
    this.x += this.vx * dt;

    // stick to the ground, hopping over small stuff
    if (gy < 90000) {
      var target = gy - this.r * 0.82;
      if (this.y > target - 2) { this.y = target; this.vy = 0; }
      else { this.vy += 1750 * dt; this.y += this.vy * dt; }
    } else {
      this.vy += 1750 * dt;
      this.y += this.vy * dt;
      if (this.y > 4000) this.dead = true;
    }
  };

  E.moveAir = function (dt, G, tp, spd) {
    var hoverY = tp.y - (this.def.bombs ? 230 : 150) + Math.sin(this.phase + performance.now() / 700) * 26;
    var tx = tp.x + (this.def.bombs ? 40 : 0);

    if (this.def.dives) {
      this.diveT = (this.diveT || 0) + dt;
      if (this.diveT > 3.4) {
        // commit to a dive
        var dx = tp.x - this.x, dy = tp.y - this.y;
        var l = Math.hypot(dx, dy) || 1;
        this.vx = dx / l * this.def.spd * 2.1 * spd;
        this.vy = dy / l * this.def.spd * 2.1 * spd;
        this.x += this.vx * dt; this.y += this.vy * dt;
        if (this.diveT > 4.4) this.diveT = 0;
        return;
      }
    }

    this.vx = JC.lerp(this.vx, (tx - this.x) * 2.1, 1 - Math.pow(0.004, dt)) * spd;
    this.vy = JC.lerp(this.vy, (hoverY - this.y) * 2.6, 1 - Math.pow(0.004, dt)) * spd;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  };

  E.updateLatched = function (dt, G, tp) {
    var m = G.truck.localToWorld(-70, -18);
    this.x = m.x; this.y = m.y - 14;
    this.latchT = (this.latchT || 0) + dt;
    if (this.latchT > 1.1) {
      this.latchT = 0;
      G.sapCargo(this);
      G.fx.burst(this.x, this.y, "#C86AD8", 8);
    }
  };

  E.touch = function (G, tp) {
    this.hitCool = (this.hitCool || 0) - 0.016;
    if (this.hitCool > 0) return;
    this.hitCool = this.def.latch ? 99 : 0.85;

    if (this.def.latch && !this.latched) {
      this.latched = true;
      return;
    }

    G.hurtTruck(this.def.dmg, this);
    if (this.def.cargoDmg) G.jostleCargo(this.def.cargoDmg, this);

    // shove the truck around
    var dir = JC.sign(tp.x - this.x) || 1;
    G.truck.shove(dir * (this.def.big ? 3.0 : 1.5), -0.8);
    G.fx.burst(this.x, this.y, "#FFD24F", 10);
    G.shake(this.def.big ? 10 : 5);

    if (!this.def.big && !this.def.air) {
      this.vx = -dir * 240;                      // bounce off
    }
  };

  E.knock = function (fx, fy) {
    var res = 1 - (this.def.knockRes || 0);
    this.vx += fx * res;
    this.vy += fy * res;
  };

  // ── spawn director ────────────────────────────────────────────────────────
  /* Threat climbs with distance travelled. Types unlock as it rises, and the
     pack size and stat scale climb with it too. */
  JC.Director = function (seed) {
    this.rng = JC.rng(seed + 555);
    this.timer = 3.5;
    this.wave = 0;
  };

  JC.Director.prototype.threat = function (G) {
    return G.distance / 90 + G.leg * 22;
  };

  JC.Director.prototype.available = function (G) {
    var th = this.threat(G);
    var out = [];
    for (var k in JC.ENEMIES) {
      if (JC.ENEMIES[k].threat <= th) out.push(k);
    }
    return out;
  };

  JC.Director.prototype.update = function (dt, G) {
    if (G.paused || G.atStop) return;
    this.timer -= dt;
    if (this.timer > 0) return;

    var th = this.threat(G);
    var pool = this.available(G);
    var self = this;
    var count = JC.clamp(1 + Math.floor(th / 70), 1, 7);
    var scale = 1 + Math.max(0, th - 60) / 420;

    // gap between waves shrinks as things get hairier
    this.timer = JC.clamp(9.5 - th / 60, 2.4, 9.5) * this.rng.range(0.8, 1.2);
    this.wave++;

    for (var i = 0; i < count; i++) {
      var type = this.rng.sample(pool, 1, function (t) {
        var d = JC.ENEMIES[t];
        // favour newer, nastier things as threat rises, but never only them
        return d.weight * (1 + (th - d.threat) / 400) * (d.elite ? 0.35 : 1);
      })[0];
      G.spawnEnemy(type, scale, i * 40);
    }
  };

})(window.JC);
