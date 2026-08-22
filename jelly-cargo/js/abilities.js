/* Abilities.

   100 base abilities, each with one variant that unlocks either by levelling
   it to 3 or by owning the right pair of elements — 200 entries in the pool.
   Everything hangs off a small set of hooks so cards stay data, not code:

     mods      passive stat changes
     onFire    when the turret fires
     onHit     when a bullet connects
     onKill    when something dies
     onHurt    when the truck takes damage
     onTick    every frame
     active    a key you hold or tap, with a cooldown
*/
window.JC = window.JC || {};
(function (JC) {
  "use strict";

  // ── shorthand used by the ability bodies ──────────────────────────────────
  var st = JC.addStatus;
  function dmg(G, e, n) { if (e && !e.dead) e.hurt(n, G); }
  function boom(G, x, y, r, d, o) { G.explode(x, y, r, d, o || {}); }
  function shot(G, o) { return G.spawnBullet(o); }
  function near(G, x, y, r) { return G.enemiesIn(x, y, r); }
  function rand(G) { return G.rng(); }

  /* Standard level curve: level 1 is the printed number, each level adds 40%. */
  function S(base, L) { return base * (1 + 0.4 * (L - 1)); }

  JC.ELEMENTS = {
    fire:  { name: "Fire",     color: "#FF7A3C" },
    ice:   { name: "Ice",      color: "#7FD8FF" },
    volt:  { name: "Volt",     color: "#FFE24F" },
    acid:  { name: "Acid",     color: "#8FE84F" },
    kin:   { name: "Kinetic",  color: "#FFB84F" },
    guard: { name: "Guard",    color: "#6FA8E8" },
    cargo: { name: "Cargo",    color: "#C98A4B" },
    move:  { name: "Mobility", color: "#7FE8C0" },
    tech:  { name: "Tech",     color: "#B08FE8" },
    void:  { name: "Void",     color: "#D86AE8" }
  };

  // ── registry ──────────────────────────────────────────────────────────────
  JC.ABILITIES = {};
  var ORDER = [];

  function A(id, name, el, desc, spec) {
    var a = spec || {};
    a.id = id; a.name = name; a.el = el; a.desc = desc;
    a.maxLevel = a.maxLevel || 5;
    JC.ABILITIES[id] = a;
    ORDER.push(id);
    return a;
  }
  /* Variants are the same shape but never offered until unlocked. */
  function V(id, name, el, desc, spec) {
    var a = A(id, name, el, desc, spec);
    a.isVariant = true;
    return a;
  }

  JC.abilityList = function () { return ORDER; };

  /* Which ability a variant is the upgraded form of, or null for the
     combo-only ones that do not belong to any single ability. Built lazily,
     because ORDER is still filling up while this file runs. */
  var VARIANT_BASE = null;
  JC.variantBase = function (id) {
    if (!VARIANT_BASE) {
      VARIANT_BASE = {};
      for (var i = 0; i < ORDER.length; i++) {
        var a = JC.ABILITIES[ORDER[i]];
        if (a.variant) VARIANT_BASE[a.variant] = a.id;
      }
    }
    return VARIANT_BASE[id] || null;
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  FIRE
  // ══════════════════════════════════════════════════════════════════════════
  A("incendiary", "Incendiary Rounds", "fire", "Hits set goblins alight.",
    { variant: "wildfire", onHit: function (G, b, e, L) { st(e, "burn", S(1.1, L)); } });
  A("flamejet", "Flame Jet", "fire", "A short cone of flame off the front bumper.",
    { variant: "dragonbreath", onTick: function (G, dt, L) {
        var p = G.truck.localToWorld(90, 0);
        near(G, p.x, p.y, S(72, L)).forEach(function (e) {
          dmg(G, e, S(9, L) * dt); st(e, "burn", dt * 1.6);
        });
        if (rand(G) < 0.4) G.fx.puff(p.x, p.y, "#FF7A3C", 2);
      } });
  A("cinders", "Cinders", "fire", "Burning goblins drop embers that keep burning.",
    { variant: "ashfall", onKill: function (G, e, L) {
        if (JC.hasStatus(e, "burn")) G.addHazard(e.x, e.y, S(70, L), 4, "fire", S(6, L));
      } });
  A("overheat", "Overheat", "fire", "Every 6th shot is a scorching blast.",
    { variant: "meltdown", onFire: function (G, b, L) {
        G.count.overheat = (G.count.overheat || 0) + 1;
        if (G.count.overheat % 6 === 0) { b.dmg *= S(2.4, L); b.el = "fire"; b.size *= 1.7; }
      } });
  A("backdraft", "Backdraft", "fire", "Taking a hit erupts flame around the truck.",
    { variant: "immolate", onHurt: function (G, amt, src, L) {
        var p = G.truck.pos(); boom(G, p.x, p.y, S(130, L), S(7, L), { el: "fire", burn: 2 });
      } });
  A("exhaustflare", "Exhaust Flare", "fire", "Your exhaust leaves a trail of fire.",
    { variant: "afterburn", onTick: function (G, dt, L) {
        if (G.time - (G.count.flareT || 0) < 0.25) return;
        G.count.flareT = G.time;
        var p = G.truck.localToWorld(-92, 6);
        G.addHazard(p.x, p.y, S(46, L), 2.6, "fire", S(5, L));
      } });
  A("emberburst", "Ember Burst", "fire", "Kills scatter little fireballs.",
    { variant: "sparkstorm", onKill: function (G, e, L) {
        for (var i = 0; i < Math.round(S(3, L)); i++) {
          var a = rand(G) * 6.283;
          shot(G, { x: e.x, y: e.y, vx: Math.cos(a) * 340, vy: Math.sin(a) * 340,
                    dmg: S(2, L), el: "fire", size: 4, life: 0.7, minor: true });
        }
      } });
  A("kiln", "Kiln Plating", "fire", "Ramming goblins sets them ablaze.",
    { variant: "forgehull", onRam: function (G, e, L) { st(e, "burn", S(2.2, L)); } });
  A("pyroclast", "Pyroclast", "fire", "Burn stacks above 6 detonate.",
    { variant: "chainburn", onTick: function (G, dt, L) {
        G.enemies.forEach(function (e) {
          if (e.st.burn > 6) { e.st.burn = 0; boom(G, e.x, e.y, S(96, L), S(12, L), { el: "fire" }); }
        });
      } });
  A("heatsoak", "Heat Soak", "fire", "Damage climbs the longer you hold fire.",
    { variant: "runawayheat", onFire: function (G, b, L) {
        G.count.heat = Math.min(S(0.9, L), (G.count.heat || 0) + 0.06);
        b.dmg *= 1 + G.count.heat;
      }, onTick: function (G, dt) {
        if (!G.input.mouse.down) G.count.heat = Math.max(0, (G.count.heat || 0) - dt * 0.5);
      } });

  // ══════════════════════════════════════════════════════════════════════════
  //  ICE
  // ══════════════════════════════════════════════════════════════════════════
  A("icicle", "Icicle Rounds", "ice", "Hits slow goblins. Stacks with every hit.",
    { variant: "deepfreeze", onHit: function (G, b, e, L) { st(e, "slow", S(0.11, L)); } });
  A("frostbite", "Frostbite", "ice", "Slowed goblins take extra damage.",
    { variant: "shatterpoint", onHit: function (G, b, e, L) {
        if (JC.hasStatus(e, "slow")) dmg(G, e, S(3, L) * e.st.slow * 3);
      } });
  A("hailstorm", "Hailstorm", "ice", "Hail falls on anything near the truck.",
    { variant: "blizzard", onTick: function (G, dt, L) {
        if (G.time - (G.count.hailT || 0) < 1.1 / S(1, L)) return;
        G.count.hailT = G.time;
        var p = G.truck.pos();
        var e = G.nearestEnemy(p.x, p.y, 520);
        if (e) { dmg(G, e, S(6, L)); st(e, "slow", 0.14); G.fx.puff(e.x, e.y - 20, "#BFEFFF", 8); }
      } });
  A("permafrost", "Permafrost", "ice", "Leaves a slowing frost patch behind you.",
    { variant: "glacier", onTick: function (G, dt, L) {
        if (G.time - (G.count.frostT || 0) < 0.4) return;
        G.count.frostT = G.time;
        var p = G.truck.localToWorld(-90, 10);
        G.addHazard(p.x, p.y, S(64, L), 5, "ice", S(1.4, L));
      } });
  A("flashfreeze", "Flash Freeze", "ice", "Small chance to freeze a goblin outright.",
    { variant: "absolutezero", onHit: function (G, b, e, L) {
        if (rand(G) < S(0.06, L)) { st(e, "freeze", 1.2); G.fx.puff(e.x, e.y, "#BFEFFF", 10); }
      } });
  A("coldsnap", "Cold Snap", "ice", "Kills chill everything nearby.",
    { variant: "frostnova", onKill: function (G, e, L) {
        near(G, e.x, e.y, S(120, L)).forEach(function (o) { st(o, "slow", S(0.16, L)); });
      } });
  A("brittle", "Brittle Shells", "ice", "Frozen goblins shatter for splash damage.",
    { variant: "shrapnelice", onHit: function (G, b, e, L) {
        if (e.st.freeze > 0) boom(G, e.x, e.y, S(90, L), S(10, L), { el: "ice" });
      } });
  A("coolant", "Coolant Loop", "ice", "Fire rate rises while enemies are slowed.",
    { variant: "cryoengine", mods: function (G, L, s) {
        var n = G.enemies.filter(function (e) { return JC.hasStatus(e, "slow"); }).length;
        s.fireRate *= 1 + Math.min(0.5, n * S(0.045, L));
      } });
  A("rime", "Rime Armour", "ice", "A frost shell absorbs a hit, then re-forms.",
    { variant: "iceshell", onTick: function (G, dt, L) {
        if (G.shield <= 0 && G.time - (G.count.rimeT || 0) > 9 / S(1, L)) {
          G.count.rimeT = G.time; G.shield = S(12, L);
        }
      } });
  A("sleet", "Sleet Rounds", "ice", "Bullets leave a lingering chill where they land.",
    { variant: "frostmine", onHit: function (G, b, e, L) {
        if (rand(G) < 0.25) G.addHazard(e.x, e.y, S(50, L), 3, "ice", S(1, L));
      } });

  // ══════════════════════════════════════════════════════════════════════════
  //  VOLT
  // ══════════════════════════════════════════════════════════════════════════
  A("arcshot", "Arc Shot", "volt", "Hits jump to a nearby goblin.",
    { variant: "forkedarc", onHit: function (G, b, e, L) {
        if (rand(G) < 0.5) G.chainFrom(e, 1 + Math.floor(L / 2), S(3, L));
      } });
  A("staticfield", "Static Field", "volt", "A crackling ring shocks anything close.",
    { variant: "tesladome", onTick: function (G, dt, L) {
        var p = G.truck.pos();
        near(G, p.x, p.y, S(140, L)).forEach(function (e) {
          dmg(G, e, S(4, L) * dt); st(e, "shock", dt);
        });
      } });
  A("capacitor", "Capacitor", "volt", "Every 8th shot is a lightning bolt.",
    { variant: "railgun", onFire: function (G, b, L) {
        G.count.cap = (G.count.cap || 0) + 1;
        if (G.count.cap % 8 === 0) { b.dmg *= S(3, L); b.pierce += 4; b.el = "volt"; b.speed *= 1.6; }
      } });
  A("overcharge", "Overcharge", "volt", "Shocked goblins take more from everything.",
    { variant: "conduction", onHit: function (G, b, e, L) {
        if (JC.hasStatus(e, "shock")) dmg(G, e, S(2.2, L) * e.st.shock);
      } });
  A("groundstrike", "Ground Strike", "volt", "Lightning hits a random goblin on a timer.",
    { variant: "thunderhead", onTick: function (G, dt, L) {
        if (G.time - (G.count.gsT || 0) < 2.4 / S(1, L)) return;
        G.count.gsT = G.time;
        var list = G.enemies.filter(function (e) { return !e.dead; });
        if (!list.length) return;
        var e = list[Math.floor(rand(G) * list.length)];
        dmg(G, e, S(14, L)); st(e, "shock", 2);
        G.fx.bolt(e.x, e.y - 400, e.x, e.y);
      } });
  A("emp", "EMP Burst", "volt", "Taking damage stuns everything nearby.",
    { variant: "stasispulse", onHurt: function (G, amt, src, L) {
        var p = G.truck.pos();
        near(G, p.x, p.y, S(180, L)).forEach(function (e) { e.stun = Math.max(e.stun, S(0.5, L)); });
        G.fx.ring(p.x, p.y, S(180, L), "#FFE24F");
      } });
  A("dynamo", "Dynamo", "volt", "Driving fast charges your boost fuel.",
    { variant: "flywheel", onTick: function (G, dt, L) {
        var v = Math.abs(G.truck.vel().x);
        G.truck.fuel = Math.min(1, G.truck.fuel + v * dt * S(0.0016, L));
      } });
  A("shockcollar", "Shock Collar", "volt", "Latched sappers get fried.",
    { variant: "livewire", onTick: function (G, dt, L) {
        G.enemies.forEach(function (e) { if (e.latched) dmg(G, e, S(14, L) * dt); });
      } });
  A("stormcell", "Storm Cell", "volt", "Kills leave a shocking cloud.",
    { variant: "downpour", onKill: function (G, e, L) {
        G.addHazard(e.x, e.y - 20, S(80, L), 3.5, "volt", S(5, L));
      } });
  A("supercon", "Superconductor", "volt", "Wet goblins take double shock.",
    { variant: "saltwater", onHit: function (G, b, e, L) {
        if (JC.hasStatus(e, "wet")) { st(e, "shock", S(1.4, L)); dmg(G, e, S(4, L)); }
      } });

  // ══════════════════════════════════════════════════════════════════════════
  //  ACID
  // ══════════════════════════════════════════════════════════════════════════
  A("acidrounds", "Acid Rounds", "acid", "Hits poison. Poison ignores armour.",
    { variant: "necrotic", onHit: function (G, b, e, L) { st(e, "poison", S(1.2, L)); } });
  A("corrosion", "Corrosion", "acid", "Poisoned goblins lose armour and move slower.",
    { variant: "dissolve", onHit: function (G, b, e, L) {
        if (JC.hasStatus(e, "poison")) { st(e, "corrode", S(1, L)); st(e, "slow", 0.05); }
      } });
  A("slickspill", "Slick Spill", "acid", "You leak oil. Oil makes fire much worse.",
    { variant: "tarpit", onTick: function (G, dt, L) {
        if (G.time - (G.count.oilT || 0) < 0.6) return;
        G.count.oilT = G.time;
        var p = G.truck.localToWorld(-92, 12);
        G.addHazard(p.x, p.y, S(58, L), 6, "oil", 0);
      } });
  A("splitspores", "Split Spores", "acid", "Poisoned goblins infect their neighbours.",
    { variant: "plaguebloom", onKill: function (G, e, L) {
        if (!JC.hasStatus(e, "poison")) return;
        near(G, e.x, e.y, S(130, L)).forEach(function (o) { st(o, "poison", S(1.6, L)); });
      } });
  A("caustic", "Caustic Coat", "acid", "Ramming coats goblins in acid.",
    { variant: "acidhull", onRam: function (G, e, L) { st(e, "poison", S(2.4, L)); st(e, "corrode", 2); } });
  A("bileburst", "Bile Burst", "acid", "Poison stacks above 8 pop for heavy damage.",
    { variant: "gutrot", onTick: function (G, dt, L) {
        G.enemies.forEach(function (e) {
          if (e.st.poison > 8) { e.st.poison = 2; dmg(G, e, S(20, L)); G.fx.puff(e.x, e.y, "#8FE84F", 12); }
        });
      } });
  A("fumes", "Fumes", "acid", "A poison cloud trails behind the truck.",
    { variant: "greenfog", onTick: function (G, dt, L) {
        var p = G.truck.localToWorld(-70, -30);
        near(G, p.x, p.y, S(96, L)).forEach(function (e) { st(e, "poison", dt * S(1.4, L)); });
      } });
  A("etchant", "Etchant", "acid", "Corroded goblins take extra bullet damage.",
    { variant: "meltarmor", onHit: function (G, b, e, L) {
        if (JC.hasStatus(e, "corrode")) dmg(G, e, b.dmg * S(0.22, L));
      } });
  A("spitback", "Spit Back", "acid", "Damage taken splashes acid on the attacker.",
    { variant: "venomthorns", onHurt: function (G, amt, src, L) {
        if (src && src.hurt) { st(src, "poison", S(3, L)); dmg(G, src, S(5, L)); }
      } });
  A("rustcloud", "Rust Cloud", "acid", "Kills leave a corroding patch.",
    { variant: "blightfield", onKill: function (G, e, L) {
        G.addHazard(e.x, e.y, S(76, L), 4.5, "acid", S(4, L));
      } });

  // ══════════════════════════════════════════════════════════════════════════
  //  KINETIC
  // ══════════════════════════════════════════════════════════════════════════
  A("twinbarrel", "Twin Barrel", "kin", "Fire an extra bullet per shot.",
    { maxLevel: 3, variant: "gatling", mods: function (G, L, s) { s.multishot += L; } });
  A("spreadshot", "Spread Shot", "kin", "Two extra bullets, fanned out.",
    { variant: "scattergun", onFire: function (G, b, L) {
        for (var i = -1; i <= 1; i += 2) {
          var a = Math.atan2(b.vy, b.vx) + i * 0.16;
          var sp = Math.hypot(b.vx, b.vy);
          shot(G, { x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                    dmg: b.dmg * S(0.55, L), size: b.size * 0.8, el: b.el });
        }
      } });
  A("piercing", "Piercing Rounds", "kin", "Bullets punch through more goblins.",
    { maxLevel: 4, variant: "railspike", mods: function (G, L, s) { s.pierce += L; } });
  A("ricochet", "Ricochet", "kin", "Bullets bounce to another target on hit.",
    { variant: "pinball", onHit: function (G, b, e, L) {
        if (b.bounced >= Math.round(S(1, L))) return;
        var o = G.nearestEnemy(e.x, e.y, 300, e);
        if (!o) return;
        b.bounced = (b.bounced || 0) + 1;
        var a = Math.atan2(o.y - e.y, o.x - e.x), sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
        b.life = Math.max(b.life, 0.5);
        b.hitList = [];
      } });
  A("heavyslug", "Heavy Slug", "kin", "Slower, bigger, much harder hitting.",
    { variant: "cannonball", mods: function (G, L, s) {
        s.damage *= 1 + S(0.45, L); s.fireRate *= 0.72; s.bulletSize *= 1.5;
      } });
  A("knockback", "Knockback", "kin", "Hits shove goblins backwards.",
    { variant: "sledgehammer", onHit: function (G, b, e, L) {
        e.knock(JC.sign(b.vx) * S(150, L), -S(60, L));
      } });
  A("critrig", "Crit Rig", "kin", "A chance to land a much heavier hit.",
    { variant: "executioner", mods: function (G, L, s) { s.crit += S(0.07, L); } });
  A("ramplate", "Ram Plate", "kin", "Ramming goblins hurts far more.",
    { variant: "wreckingbar", mods: function (G, L, s) { s.ram *= 1 + S(0.5, L); } });
  A("homing", "Homing Rounds", "kin", "Bullets curve toward the nearest goblin.",
    { variant: "seeker", mods: function (G, L, s) { s.homing += S(2.2, L); } });
  A("rapidfire", "Rapid Fire", "kin", "The turret cycles noticeably faster.",
    { variant: "minigun", mods: function (G, L, s) { s.fireRate *= 1 + S(0.16, L); } });

  // ══════════════════════════════════════════════════════════════════════════
  //  GUARD
  // ══════════════════════════════════════════════════════════════════════════
  A("plating", "Bolt-On Plating", "guard", "Flat damage reduction on the truck.",
    { variant: "ablative", mods: function (G, L, s) { s.armor += S(0.9, L); } });
  A("regen", "Field Repairs", "guard", "The truck slowly patches itself up.",
    { variant: "nanoweld", mods: function (G, L, s) { s.regen += S(0.35, L); } });
  A("bulkhead", "Bulkhead", "guard", "More truck health.",
    { variant: "reinforced", mods: function (G, L, s) { s.truckHp += S(22, L); } });
  A("barrier", "Barrier Projector", "guard", "A shield that recharges out of combat.",
    { variant: "hardlight", mods: function (G, L, s) { s.shieldMax += S(18, L); } });
  A("thorns", "Spiked Hull", "guard", "Anything that touches you takes damage.",
    { variant: "razorhull", onHurt: function (G, amt, src, L) { if (src) dmg(G, src, S(8, L)); } });
  A("secondwind", "Second Wind", "guard", "Dropping low grants a burst of shield and speed.",
    { variant: "lastditch", onHurt: function (G, amt, src, L) {
        if (G.truckHp / G.stats.truckHp > 0.3 || G.count.swT > G.time - 25) return;
        G.count.swT = G.time;
        G.shield += S(30, L);
        G.buff("speed", 1.4, 5);
        G.fx.ring(G.truck.pos().x, G.truck.pos().y, 200, "#6FA8E8");
      } });
  A("absorb", "Kinetic Absorber", "guard", "Damage taken charges your boost.",
    { variant: "impactcell", onHurt: function (G, amt, src, L) {
        G.truck.fuel = Math.min(1, G.truck.fuel + amt * S(0.012, L));
      } });
  A("dodgeplate", "Glancing Plates", "guard", "A chance to shrug off a hit entirely.",
    { variant: "phaseplate", mods: function (G, L, s) { s.dodge += S(0.06, L); } });
  A("medkit", "Medkit", "guard", "Kills occasionally patch the truck.",
    { variant: "vampiric", onKill: function (G, e, L) {
        if (rand(G) < 0.12) G.healTruck(S(4, L));
      } });
  A("stabilisers", "Stabilisers", "guard", "The truck resists being shoved around.",
    { variant: "gyrolock", mods: function (G, L, s) { s.stability += S(0.25, L); } });

  // ══════════════════════════════════════════════════════════════════════════
  //  CARGO
  // ══════════════════════════════════════════════════════════════════════════
  A("cargonet", "Cargo Net", "cargo", "Crates are far less likely to bounce out.",
    { variant: "ratchetstrap", mods: function (G, L, s) { s.cargoGrip += S(0.3, L); } });
  A("bigbed", "Extended Bed", "cargo", "Carry more crates.",
    { maxLevel: 4, variant: "trailer", mods: function (G, L, s) { s.cargoSlots += L; } });
  A("cargoarmor", "Padded Crates", "cargo", "Cargo takes less damage from everything.",
    { variant: "crashfoam", mods: function (G, L, s) { s.cargoArmor += S(0.2, L); } });
  A("recovery", "Recovery Winch", "cargo", "Spilled crates sometimes get winched back.",
    { variant: "grabberarm", onSpill: function (G, kind, L) {
        if (rand(G) < S(0.22, L)) { G.truck.loadCrate(kind); return true; }
      } });
  A("insurance", "Insurance", "cargo", "Lost crates pay out a little gold.",
    { variant: "underwriter", onSpill: function (G, kind, L) {
        G.gold += Math.round((JC.CARGO[kind] || JC.CARGO.boxes).value * S(0.35, L));
      } });
  A("appraiser", "Appraiser", "cargo", "Cargo sells for more at the stop.",
    { variant: "blackmarket", mods: function (G, L, s) { s.sellMul += S(0.14, L); } });
  A("scavenger", "Scavenger", "cargo", "Goblins drop more gold.",
    { variant: "looter", mods: function (G, L, s) { s.goldMul += S(0.16, L); } });
  A("magnet", "Loot Magnet", "cargo", "Gold and pickups drift toward you.",
    { variant: "gravitywell", mods: function (G, L, s) { s.magnet += S(90, L); } });
  A("ballast", "Ballast", "cargo", "A fuller bed makes the truck more stable.",
    { variant: "counterweight", mods: function (G, L, s) {
        s.stability += G.truck.crates.length * S(0.03, L);
      } });
  A("hazardpay", "Hazard Pay", "cargo", "Higher tier cargo also boosts your damage.",
    { variant: "dangerbonus", mods: function (G, L, s) {
        var t = 0;
        G.truck.crates.forEach(function (c) { t += (JC.CARGO[c.userData.cargo] || {}).tier || 0; });
        s.damage *= 1 + t * S(0.02, L);
      } });

  // ══════════════════════════════════════════════════════════════════════════
  //  MOBILITY
  // ══════════════════════════════════════════════════════════════════════════
  A("thrusters", "Rocket Thrusters", "move", "Hold F to rocket forward. Needs a full tank.",
    { variant: "afterburner", mods: function (G, L, s) { s.boostPower *= 1 + S(0.25, L); },
      grants: "boost" });
  A("bigwheels", "Bigger Wheels", "move", "Climbs hills far more happily.",
    { variant: "monstertyres", mods: function (G, L, s) { s.torque *= 1 + S(0.18, L); s.grip *= 1 + S(0.1, L); } });
  A("suspension", "Soft Suspension", "move", "Lands smoother, spills less.",
    { variant: "raceshocks", mods: function (G, L, s) { s.cargoGrip += S(0.18, L); s.stability += S(0.2, L); } });
  A("topend", "Tuned Engine", "move", "Higher top speed.",
    { variant: "turbo", mods: function (G, L, s) { s.maxSpeed *= 1 + S(0.14, L); } });
  A("fueltank", "Bigger Tank", "move", "Boost refills faster.",
    { variant: "quickcharge", mods: function (G, L, s) { s.fuelRegen *= 1 - Math.min(0.6, S(0.16, L)); } });
  A("airbrake", "Air Brake", "move", "Far more control while airborne.",
    { variant: "skyhook", mods: function (G, L, s) { s.airControl += S(0.5, L); } });
  A("hover", "Hover Skirt", "move", "Briefly float instead of falling into a chasm.",
    { variant: "antigrav", onTick: function (G, dt, L) {
        if (!G.terrain.isGap(G.truck.pos().x)) return;
        var pts = G.truck.chassis.pts;
        for (var i = 0; i < pts.length; i++) pts[i].y -= S(11, L) * dt * 60 * dt;
      } });
  A("grip", "Knobbly Tread", "move", "More grip, less wheelspin.",
    { variant: "spiketread", mods: function (G, L, s) { s.grip *= 1 + S(0.2, L); } });
  A("bounce", "Bouncy Compound", "move", "The truck is springier and takes less fall damage.",
    { variant: "supersprung", mods: function (G, L, s) { s.fallRes += S(0.25, L); } });
  A("nitrokill", "Kill Nitro", "move", "Each kill gives a short burst of speed.",
    { variant: "bloodrush", onKill: function (G, e, L) { G.buff("speed", 1 + S(0.12, L), 2.5); } });

  // ══════════════════════════════════════════════════════════════════════════
  //  TECH
  // ══════════════════════════════════════════════════════════════════════════
  A("drone", "Escort Drone", "tech", "A little drone circles you and shoots.",
    { variant: "dronewing", grants: "drone",
      mods: function (G, L, s) { s.drones = Math.max(s.drones, 1); s.droneDmg += S(2, L); } });
  A("autoturret", "Deployable Turret", "tech", "Tap G to drop a turret that fires for you.",
    { variant: "sentrynest", active: { key: "g", cd: 14,
        run: function (G, L) {
          var p = G.truck.localToWorld(-100, -10);
          G.addTurret(p.x, p.y, S(12, L), 16);
        } } });
  A("targeting", "Targeting Computer", "tech", "Bullets fly faster and straighter.",
    { variant: "predictor", mods: function (G, L, s) { s.bulletSpeed *= 1 + S(0.18, L); s.crit += 0.03 * L; } });
  A("scanner", "Threat Scanner", "tech", "Marks the toughest goblin. Marked take more.",
    { variant: "painttarget", onTick: function (G, dt, L) {
        if (G.time - (G.count.scanT || 0) < 2) return;
        G.count.scanT = G.time;
        var best = null;
        G.enemies.forEach(function (e) { if (!best || e.hp > best.hp) best = e; });
        if (best) st(best, "mark", S(2, L));
      } });
  A("repairbot", "Repair Bot", "tech", "Slowly repairs cargo as you drive.",
    { variant: "cargobot", mods: function (G, L, s) { s.cargoRegen += S(0.3, L); } });
  A("overclock", "Overclock", "tech", "Tap R for a short burst of blistering fire rate.",
    { variant: "hyperclock", active: { key: "r", cd: 20,
        run: function (G, L) { G.buff("fireRate", 1 + S(1.2, L), 5); } } });
  A("shieldcap", "Shield Capacitor", "tech", "Shields recharge much faster.",
    { variant: "instantshield", mods: function (G, L, s) { s.shieldRegen *= 1 + S(0.5, L); } });
  A("saltvolley", "Salvo Launcher", "tech", "Every few seconds, fire a burst of rockets.",
    { variant: "missilepod", onTick: function (G, dt, L) {
        if (G.time - (G.count.salvoT || 0) < 6 / S(1, L)) return;
        G.count.salvoT = G.time;
        var p = G.truck.turretMount();
        for (var i = 0; i < 3; i++) {
          var a = -1.2 + i * 0.3;
          shot(G, { x: p.x, y: p.y, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420,
                    dmg: S(9, L), size: 7, rocket: true, life: 2.4 });
        }
      } });
  A("recycler", "Recycler", "tech", "Kills sometimes refund a little boost fuel.",
    { variant: "kinetic_recl", onKill: function (G, e, L) {
        G.truck.fuel = Math.min(1, G.truck.fuel + S(0.05, L));
      } });
  A("luckchip", "Luck Chip", "tech", "Better shop rolls and better cards.",
    { variant: "fortunecore", mods: function (G, L, s) { s.luck += S(0.18, L); } });

  // ══════════════════════════════════════════════════════════════════════════
  //  VOID
  // ══════════════════════════════════════════════════════════════════════════
  A("blackhole", "Pocket Singularity", "void", "Kills briefly drag everything inward.",
    { variant: "eventhorizon", onKill: function (G, e, L) {
        if (rand(G) > 0.2) return;
        G.addVortex(e.x, e.y, S(150, L), 1.2, S(220, L));
      } });
  A("phaseshot", "Phase Rounds", "void", "Bullets pass through terrain and armour.",
    { variant: "ghostround", mods: function (G, L, s) { s.phase = true; s.damage *= 1 + S(0.1, L); } });
  A("entropy", "Entropy", "void", "Goblins that live too long start decaying.",
    { variant: "decayaura", onTick: function (G, dt, L) {
        G.enemies.forEach(function (e) {
          e.age = (e.age || 0) + dt;
          if (e.age > 8) dmg(G, e, S(3, L) * dt);
        });
      } });
  A("rift", "Rift Step", "void", "Tap Q to blink the truck forward.",
    { variant: "longstep", active: { key: "q", cd: 11,
        run: function (G, L) {
          G.truck.chassis.translate(S(150, L), -30);
          G.truck.wheels.forEach(function (w) { w.translate(S(150, L), -30); });
          G.truck.crates.forEach(function (c) { c.translate(S(150, L), -30); });
          G.fx.ring(G.truck.pos().x, G.truck.pos().y, 140, "#D86AE8");
        } } });
  A("nullfield", "Null Field", "void", "Enemy shots near the truck fizzle out.",
    { variant: "deflector", mods: function (G, L, s) { s.bulletEat += S(0.18, L); } });
  A("harvest", "Soul Harvest", "void", "Every 10 kills, a free heal and shield.",
    { variant: "reaper", onKill: function (G, e, L) {
        G.count.harv = (G.count.harv || 0) + 1;
        if (G.count.harv % 10) return;
        G.healTruck(S(10, L)); G.shield += S(10, L);
      } });
  A("curse", "Curse", "void", "Hits reduce the damage that goblin deals.",
    { variant: "hex", onHit: function (G, b, e, L) { e.curse = Math.min(0.6, (e.curse || 0) + S(0.06, L)); } });
  A("echo", "Echo Shot", "void", "A chance to fire the same shot twice.",
    { variant: "doublecast", onFire: function (G, b, L) {
        if (rand(G) > S(0.16, L)) return;
        setTimeout(function () {
          if (G.over) return;
          shot(G, { x: b.x, y: b.y, vx: b.vx, vy: b.vy, dmg: b.dmg, size: b.size, el: b.el });
        }, 90);
      } });
  A("gravwell", "Gravity Well", "void", "A slow field trails behind the truck.",
    { variant: "singularity", onTick: function (G, dt, L) {
        var p = G.truck.localToWorld(-110, -20);
        near(G, p.x, p.y, S(120, L)).forEach(function (e) {
          e.vx += (p.x - e.x) * S(1.4, L) * dt;
          e.vy += (p.y - e.y) * S(1.4, L) * dt;
        });
      } });
  A("unmake", "Unmake", "void", "A tiny chance to delete a goblin outright.",
    { variant: "annihilate", onHit: function (G, b, e, L) {
        if (e.def.elite) return;
        if (rand(G) < S(0.012, L)) { e.hp = 0; e.die(G); G.fx.burst(e.x, e.y, "#D86AE8", 24); }
      } });

  // ══════════════════════════════════════════════════════════════════════════
  //  VARIANTS — one per base. Level-3 unlocks unless a combo is listed.
  // ══════════════════════════════════════════════════════════════════════════
  V("wildfire", "Wildfire", "fire", "Burn spreads from goblin to goblin.",
    { onHit: function (G, b, e, L) {
        st(e, "burn", S(1.4, L));
        near(G, e.x, e.y, 90).forEach(function (o) { st(o, "burn", S(0.5, L)); });
      } });
  V("dragonbreath", "Dragon Breath", "fire", "The flame cone is longer and far hotter.",
    { onTick: function (G, dt, L) {
        var p = G.truck.localToWorld(120, 0);
        near(G, p.x, p.y, S(120, L)).forEach(function (e) { dmg(G, e, S(20, L) * dt); st(e, "burn", dt * 3); });
      } });
  V("ashfall", "Ashfall", "fire", "Every kill leaves embers, not just burning ones.",
    { onKill: function (G, e, L) { G.addHazard(e.x, e.y, S(88, L), 5, "fire", S(9, L)); } });
  V("meltdown", "Meltdown", "fire", "Every 4th shot, and it detonates on impact.",
    { onFire: function (G, b, L) {
        G.count.melt = (G.count.melt || 0) + 1;
        if (G.count.melt % 4 === 0) { b.dmg *= S(2.6, L); b.explode = S(120, L); b.el = "fire"; b.size *= 2; }
      } });
  V("immolate", "Immolate", "fire", "The eruption is bigger and leaves a fire ring.",
    { onHurt: function (G, amt, src, L) {
        var p = G.truck.pos();
        boom(G, p.x, p.y, S(190, L), S(14, L), { el: "fire", burn: 4 });
        G.addHazard(p.x, p.y, S(150, L), 4, "fire", S(8, L));
      } });
  V("afterburn", "Afterburn", "fire", "A continuous wall of fire in your wake.",
    { onTick: function (G, dt, L) {
        if (G.time - (G.count.abT || 0) < 0.1) return;
        G.count.abT = G.time;
        var p = G.truck.localToWorld(-92, 6);
        G.addHazard(p.x, p.y, S(56, L), 3.4, "fire", S(9, L));
      } });
  V("sparkstorm", "Spark Storm", "fire", "Twice the fireballs, and they seek.",
    { onKill: function (G, e, L) {
        for (var i = 0; i < Math.round(S(6, L)); i++) {
          var a = rand(G) * 6.283;
          shot(G, { x: e.x, y: e.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
                    dmg: S(3, L), el: "fire", size: 5, life: 1.1, homing: 4, minor: true });
        }
      } });
  V("forgehull", "Forge Hull", "fire", "The whole hull glows. Contact burns badly.",
    { onRam: function (G, e, L) { st(e, "burn", S(5, L)); dmg(G, e, S(10, L)); },
      onTick: function (G, dt, L) {
        var p = G.truck.pos();
        near(G, p.x, p.y, 100).forEach(function (e) { st(e, "burn", dt * S(1.2, L)); });
      } });
  V("chainburn", "Chain Burn", "fire", "Detonations pass their burn on to the survivors.",
    { onTick: function (G, dt, L) {
        G.enemies.forEach(function (e) {
          if (e.st.burn <= 5) return;
          e.st.burn = 0;
          boom(G, e.x, e.y, S(120, L), S(16, L), { el: "fire" });
          near(G, e.x, e.y, S(120, L)).forEach(function (o) { st(o, "burn", 3); });
        });
      } });
  V("runawayheat", "Runaway Heat", "fire", "Heat climbs higher and decays slower.",
    { onFire: function (G, b, L) {
        G.count.heat = Math.min(S(2.2, L), (G.count.heat || 0) + 0.1);
        b.dmg *= 1 + G.count.heat;
      }, onTick: function (G, dt) {
        if (!G.input.mouse.down) G.count.heat = Math.max(0, (G.count.heat || 0) - dt * 0.2);
      } });

  V("deepfreeze", "Deep Freeze", "ice", "Slow stacks harder and lasts longer.",
    { onHit: function (G, b, e, L) { st(e, "slow", S(0.2, L)); if (e.st.slow > 0.6) st(e, "freeze", 0.5); } });
  V("shatterpoint", "Shatterpoint", "ice", "Heavily slowed goblins take crushing damage.",
    { onHit: function (G, b, e, L) {
        if (e.st.slow > 0.4) dmg(G, e, S(14, L));
      } });
  V("blizzard", "Blizzard", "ice", "Hail hits everything at once, constantly.",
    { onTick: function (G, dt, L) {
        if (G.time - (G.count.blizT || 0) < 0.5) return;
        G.count.blizT = G.time;
        var p = G.truck.pos();
        near(G, p.x, p.y, 620).forEach(function (e) { dmg(G, e, S(4, L)); st(e, "slow", 0.1); });
      } });
  V("glacier", "Glacier", "ice", "The frost patch is huge and freezes outright.",
    { onTick: function (G, dt, L) {
        if (G.time - (G.count.glacT || 0) < 0.5) return;
        G.count.glacT = G.time;
        var p = G.truck.localToWorld(-90, 10);
        G.addHazard(p.x, p.y, S(120, L), 7, "ice", S(3, L));
      } });
  V("absolutezero", "Absolute Zero", "ice", "A real chance to freeze, and freezing hurts.",
    { onHit: function (G, b, e, L) {
        if (rand(G) < S(0.16, L)) { st(e, "freeze", 2); dmg(G, e, S(10, L)); }
      } });
  V("frostnova", "Frost Nova", "ice", "Kills fire off a freezing shockwave.",
    { onKill: function (G, e, L) {
        near(G, e.x, e.y, S(190, L)).forEach(function (o) { st(o, "slow", 0.35); dmg(G, o, S(7, L)); });
        G.fx.ring(e.x, e.y, S(190, L), "#BFEFFF");
      } });
  V("shrapnelice", "Ice Shrapnel", "ice", "Shattering throws icicles outward.",
    { onHit: function (G, b, e, L) {
        if (!(e.st.freeze > 0)) return;
        boom(G, e.x, e.y, S(120, L), S(15, L), { el: "ice" });
        for (var i = 0; i < 5; i++) {
          var a = rand(G) * 6.283;
          shot(G, { x: e.x, y: e.y, vx: Math.cos(a) * 400, vy: Math.sin(a) * 400,
                    dmg: S(4, L), el: "ice", size: 4, life: 0.6, minor: true });
        }
      } });
  V("cryoengine", "Cryo Engine", "ice", "Slowed enemies also feed your damage.",
    { mods: function (G, L, s) {
        var n = G.enemies.filter(function (e) { return JC.hasStatus(e, "slow"); }).length;
        s.fireRate *= 1 + Math.min(0.8, n * S(0.06, L));
        s.damage *= 1 + Math.min(0.5, n * S(0.03, L));
      } });
  V("iceshell", "Ice Shell", "ice", "The shell is thicker and re-forms twice as fast.",
    { onTick: function (G, dt, L) {
        if (G.shield <= 0 && G.time - (G.count.iceT || 0) > 4.5 / S(1, L)) {
          G.count.iceT = G.time; G.shield = S(26, L);
        }
      } });
  V("frostmine", "Frost Mines", "ice", "Bullets that miss leave freezing mines.",
    { onHit: function (G, b, e, L) { G.addHazard(e.x, e.y, S(70, L), 5, "ice", S(3, L)); } });

  V("forkedarc", "Forked Arc", "volt", "Every hit chains, and chains further.",
    { onHit: function (G, b, e, L) { G.chainFrom(e, 2 + L, S(6, L)); } });
  V("tesladome", "Tesla Dome", "volt", "The ring is wider and stuns.",
    { onTick: function (G, dt, L) {
        var p = G.truck.pos();
        near(G, p.x, p.y, S(230, L)).forEach(function (e) {
          dmg(G, e, S(9, L) * dt); st(e, "shock", dt * 2);
          if (rand(G) < dt * 0.4) e.stun = Math.max(e.stun, 0.3);
        });
      } });
  V("railgun", "Railgun", "volt", "Every 5th shot is a piercing lance.",
    { onFire: function (G, b, L) {
        G.count.rail = (G.count.rail || 0) + 1;
        if (G.count.rail % 5) return;
        b.dmg *= S(5, L); b.pierce += 20; b.el = "volt"; b.speed *= 2.4; b.size *= 1.6; b.beam = true;
      } });
  V("conduction", "Conduction", "volt", "Shock also spreads to whoever is closest.",
    { onHit: function (G, b, e, L) {
        if (!JC.hasStatus(e, "shock")) return;
        dmg(G, e, S(4, L) * e.st.shock);
        var o = G.nearestEnemy(e.x, e.y, 200, e);
        if (o) st(o, "shock", 2);
      } });
  V("thunderhead", "Thunderhead", "volt", "Three bolts at a time, twice as often.",
    { onTick: function (G, dt, L) {
        if (G.time - (G.count.thT || 0) < 1.2 / S(1, L)) return;
        G.count.thT = G.time;
        var list = G.enemies.filter(function (e) { return !e.dead; });
        for (var i = 0; i < 3 && list.length; i++) {
          var e = list[Math.floor(rand(G) * list.length)];
          dmg(G, e, S(16, L)); st(e, "shock", 3);
          G.fx.bolt(e.x, e.y - 400, e.x, e.y);
        }
      } });
  V("stasispulse", "Stasis Pulse", "volt", "The stun is much longer and hits further.",
    { onHurt: function (G, amt, src, L) {
        var p = G.truck.pos();
        near(G, p.x, p.y, S(300, L)).forEach(function (e) { e.stun = Math.max(e.stun, S(1.4, L)); });
        G.fx.ring(p.x, p.y, S(300, L), "#FFE24F");
      } });
  V("flywheel", "Flywheel", "volt", "Speed charges boost and briefly boosts damage.",
    { onTick: function (G, dt, L) {
        var v = Math.abs(G.truck.vel().x);
        G.truck.fuel = Math.min(1, G.truck.fuel + v * dt * S(0.004, L));
        if (v > 9) G.buff("damage", 1 + S(0.2, L), 0.4);
      } });
  V("livewire", "Live Wire", "volt", "Anything touching the truck is being electrocuted.",
    { onTick: function (G, dt, L) {
        var p = G.truck.pos();
        near(G, p.x, p.y, 110).forEach(function (e) { dmg(G, e, S(22, L) * dt); st(e, "shock", dt * 2); });
      } });
  V("downpour", "Downpour", "volt", "Storm clouds also soak, which doubles the shock.",
    { onKill: function (G, e, L) {
        G.addHazard(e.x, e.y - 20, S(110, L), 5, "volt", S(8, L));
        near(G, e.x, e.y, 110).forEach(function (o) { st(o, "wet", 1); });
      } });
  V("saltwater", "Saltwater", "volt", "Hits soak the target, then shock it.",
    { combo: ["volt", "ice"], onHit: function (G, b, e, L) {
        st(e, "wet", 0.8); st(e, "shock", S(1.8, L)); dmg(G, e, S(6, L));
      } });

  V("necrotic", "Necrosis", "acid", "Poison stacks far higher and hits harder.",
    { onHit: function (G, b, e, L) { st(e, "poison", S(2.4, L), 26); } });
  V("dissolve", "Dissolve", "acid", "Corroded goblins take steadily mounting damage.",
    { onHit: function (G, b, e, L) {
        st(e, "corrode", S(2, L));
        if (JC.hasStatus(e, "corrode")) dmg(G, e, e.st.corrode * S(1.6, L));
      } });
  V("tarpit", "Tar Pit", "acid", "The slick is wide, sticky, and slows.",
    { onTick: function (G, dt, L) {
        if (G.time - (G.count.tarT || 0) < 0.4) return;
        G.count.tarT = G.time;
        var p = G.truck.localToWorld(-92, 12);
        G.addHazard(p.x, p.y, S(100, L), 8, "oil", 0, { slow: 0.4 });
      } });
  V("plaguebloom", "Plague Bloom", "acid", "Poisoned deaths spread further and hit harder.",
    { onKill: function (G, e, L) {
        near(G, e.x, e.y, S(220, L)).forEach(function (o) { st(o, "poison", S(3.5, L)); dmg(G, o, S(6, L)); });
      } });
  V("acidhull", "Acid Hull", "acid", "The whole hull weeps acid onto anything close.",
    { onTick: function (G, dt, L) {
        var p = G.truck.pos();
        near(G, p.x, p.y, 105).forEach(function (e) { st(e, "poison", dt * S(2, L)); });
      } });
  V("gutrot", "Gut Rot", "acid", "Poison pops sooner and takes the neighbours with it.",
    { onTick: function (G, dt, L) {
        G.enemies.forEach(function (e) {
          if (e.st.poison <= 5) return;
          e.st.poison = 1;
          boom(G, e.x, e.y, S(120, L), S(26, L), { el: "acid" });
        });
      } });
  V("greenfog", "Green Fog", "acid", "A permanent, much larger poison cloud.",
    { onTick: function (G, dt, L) {
        var p = G.truck.pos();
        near(G, p.x, p.y, S(190, L)).forEach(function (e) { st(e, "poison", dt * S(2.4, L)); });
      } });
  V("meltarmor", "Melt Armour", "acid", "Corrosion strips armour completely.",
    { onHit: function (G, b, e, L) {
        if (JC.hasStatus(e, "corrode")) { dmg(G, e, b.dmg * S(0.5, L)); e.knockRes = 0; }
      } });
  V("venomthorns", "Venom Thorns", "acid", "Attackers get a much bigger dose.",
    { onHurt: function (G, amt, src, L) {
        if (!src || !src.hurt) return;
        st(src, "poison", S(8, L)); dmg(G, src, S(14, L));
        near(G, src.x, src.y, 120).forEach(function (o) { st(o, "poison", S(3, L)); });
      } });
  V("blightfield", "Blight Field", "acid", "Kills leave a large, long-lived blight.",
    { onKill: function (G, e, L) { G.addHazard(e.x, e.y, S(130, L), 8, "acid", S(8, L)); } });

  V("gatling", "Gatling Mount", "kin", "Three extra bullets, and they cycle faster.",
    { maxLevel: 3, mods: function (G, L, s) { s.multishot += L * 2; s.fireRate *= 1.2; s.damage *= 0.82; } });
  V("scattergun", "Scattergun", "kin", "A whole cone of pellets, close range.",
    { onFire: function (G, b, L) {
        for (var i = -3; i <= 3; i++) {
          if (!i) continue;
          var a = Math.atan2(b.vy, b.vx) + i * 0.11;
          var sp = Math.hypot(b.vx, b.vy) * 0.85;
          shot(G, { x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                    dmg: b.dmg * S(0.42, L), size: b.size * 0.7, el: b.el, life: 0.5 });
        }
      } });
  V("railspike", "Rail Spike", "kin", "Bullets pass through everything and gain damage doing it.",
    { mods: function (G, L, s) { s.pierce += L * 3; },
      onHit: function (G, b, e, L) { b.dmg *= 1 + S(0.12, L); } });
  V("pinball", "Pinball", "kin", "Bounces many more times and grows each bounce.",
    { onHit: function (G, b, e, L) {
        if (b.bounced >= Math.round(S(4, L))) return;
        var o = G.nearestEnemy(e.x, e.y, 380, e);
        if (!o) return;
        b.bounced = (b.bounced || 0) + 1;
        b.dmg *= 1.18; b.size *= 1.06;
        var a = Math.atan2(o.y - e.y, o.x - e.x), sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
        b.life = Math.max(b.life, 0.7); b.hitList = [];
      } });
  V("cannonball", "Cannonball", "kin", "One enormous, slow, explosive shell.",
    { mods: function (G, L, s) {
        s.damage *= 1 + S(1.1, L); s.fireRate *= 0.5; s.bulletSize *= 2.4; s.splash += S(90, L);
      } });
  V("sledgehammer", "Sledgehammer", "kin", "Knockback becomes brutal, and it hurts.",
    { onHit: function (G, b, e, L) {
        e.knock(JC.sign(b.vx) * S(420, L), -S(190, L));
        dmg(G, e, S(6, L));
      } });
  V("executioner", "Executioner", "kin", "Crits are far more common and far bigger.",
    { mods: function (G, L, s) { s.crit += S(0.12, L); s.critMul += S(0.6, L); } });
  V("wreckingbar", "Wrecking Bar", "kin", "Ramming flattens almost anything.",
    { mods: function (G, L, s) { s.ram *= 1 + S(1.4, L); },
      onRam: function (G, e, L) { e.knock(JC.sign(G.truck.vel().x) * 500, -280); } });
  V("seeker", "Seeker Rounds", "kin", "Bullets track hard and never lose the scent.",
    { mods: function (G, L, s) { s.homing += S(7, L); s.bulletLife += 0.8; } });
  V("minigun", "Minigun", "kin", "Enormous fire rate, slightly weaker rounds.",
    { mods: function (G, L, s) { s.fireRate *= 1 + S(0.5, L); s.damage *= 0.8; } });

  V("ablative", "Ablative Armour", "guard", "Much heavier plating.",
    { mods: function (G, L, s) { s.armor += S(2.4, L); } });
  V("nanoweld", "Nanoweld", "guard", "Repairs are far faster and also mend cargo.",
    { mods: function (G, L, s) { s.regen += S(1.1, L); s.cargoRegen += S(0.3, L); } });
  V("reinforced", "Reinforced Frame", "guard", "A great deal more truck health.",
    { mods: function (G, L, s) { s.truckHp += S(70, L); } });
  V("hardlight", "Hard Light", "guard", "A much bigger shield that recharges quickly.",
    { mods: function (G, L, s) { s.shieldMax += S(55, L); s.shieldRegen *= 1.6; } });
  V("razorhull", "Razor Hull", "guard", "Contact damage becomes lethal.",
    { onHurt: function (G, amt, src, L) {
        if (src) { dmg(G, src, S(26, L)); st(src, "bleed", 3); }
      } });
  V("lastditch", "Last Ditch", "guard", "Triggers sooner, and freezes the field.",
    { onHurt: function (G, amt, src, L) {
        if (G.truckHp / G.stats.truckHp > 0.45 || G.count.ldT > G.time - 18) return;
        G.count.ldT = G.time;
        G.shield += S(60, L);
        G.buff("speed", 1.6, 6);
        G.enemies.forEach(function (e) { e.stun = Math.max(e.stun, 1.6); });
      } });
  V("impactcell", "Impact Cell", "guard", "Damage fully refunds as boost and shield.",
    { onHurt: function (G, amt, src, L) {
        G.truck.fuel = Math.min(1, G.truck.fuel + amt * S(0.04, L));
        G.shield += amt * S(0.2, L);
      } });
  V("phaseplate", "Phase Plate", "guard", "Dodges are common, and heal you a little.",
    { mods: function (G, L, s) { s.dodge += S(0.14, L); },
      onDodge: function (G, L) { G.healTruck(S(3, L)); } });
  V("vampiric", "Vampiric Grille", "guard", "Every kill heals the truck.",
    { onKill: function (G, e, L) { G.healTruck(S(2.2, L)); } });
  V("gyrolock", "Gyro Lock", "guard", "Almost impossible to shove or flip.",
    { mods: function (G, L, s) { s.stability += S(1.1, L); s.cargoGrip += 0.2; } });

  V("ratchetstrap", "Ratchet Straps", "cargo", "Crates barely move at all.",
    { mods: function (G, L, s) { s.cargoGrip += S(0.9, L); } });
  V("trailer", "Trailer Hitch", "cargo", "A great deal more cargo space.",
    { maxLevel: 4, mods: function (G, L, s) { s.cargoSlots += L * 3; } });
  V("crashfoam", "Crash Foam", "cargo", "Cargo is almost immune to knocks.",
    { mods: function (G, L, s) { s.cargoArmor += S(0.55, L); } });
  V("grabberarm", "Grabber Arm", "cargo", "Most spilled crates get recovered.",
    { onSpill: function (G, kind, L) {
        if (rand(G) < S(0.6, L)) { G.truck.loadCrate(kind); return true; }
      } });
  V("underwriter", "Underwriter", "cargo", "Lost crates pay out more than they were worth.",
    { onSpill: function (G, kind, L) {
        G.gold += Math.round((JC.CARGO[kind] || JC.CARGO.boxes).value * S(1.2, L));
      } });
  V("blackmarket", "Black Market", "cargo", "Cargo sells for a great deal more.",
    { mods: function (G, L, s) { s.sellMul += S(0.5, L); } });
  V("looter", "Looter", "cargo", "Goblins are considerably richer.",
    { mods: function (G, L, s) { s.goldMul += S(0.6, L); } });
  V("gravitywell", "Tractor Field", "cargo", "Everything on the map comes to you.",
    { mods: function (G, L, s) { s.magnet += S(400, L); } });
  V("counterweight", "Counterweight", "cargo", "A full bed makes you nearly immovable.",
    { mods: function (G, L, s) {
        s.stability += G.truck.crates.length * S(0.09, L);
        s.ram *= 1 + G.truck.crates.length * 0.04;
      } });
  V("dangerbonus", "Danger Bonus", "cargo", "Dangerous cargo makes you dangerous.",
    { mods: function (G, L, s) {
        var t = 0;
        G.truck.crates.forEach(function (c) { t += (JC.CARGO[c.userData.cargo] || {}).tier || 0; });
        s.damage *= 1 + t * S(0.06, L);
        s.fireRate *= 1 + t * S(0.02, L);
      } });

  V("afterburner", "Afterburner", "move", "The boost is violent and lasts longer.",
    { mods: function (G, L, s) { s.boostPower *= 1 + S(0.8, L); s.fuelDur *= 1.5; } });
  V("monstertyres", "Monster Tyres", "move", "Climbs anything. Ramming included.",
    { mods: function (G, L, s) { s.torque *= 1 + S(0.5, L); s.grip *= 1.3; s.ram *= 1.3; } });
  V("raceshocks", "Race Shocks", "move", "Perfect landings, no spills.",
    { mods: function (G, L, s) { s.cargoGrip += S(0.5, L); s.stability += S(0.5, L); s.fallRes += 0.3; } });
  V("turbo", "Turbocharger", "move", "A far higher ceiling, and it accelerates.",
    { mods: function (G, L, s) { s.maxSpeed *= 1 + S(0.4, L); s.torque *= 1.2; } });
  V("quickcharge", "Quick Charge", "move", "Boost is almost always available.",
    { mods: function (G, L, s) { s.fuelRegen *= 1 - Math.min(0.85, S(0.35, L)); } });
  V("skyhook", "Sky Hook", "move", "Total control in the air, and you fall slower.",
    { mods: function (G, L, s) { s.airControl += S(1.6, L); s.fallRes += 0.3; } });
  V("antigrav", "Antigrav Skirt", "move", "You can simply drive over a chasm.",
    { onTick: function (G, dt, L) {
        if (!G.terrain.isGap(G.truck.pos().x)) return;
        var pts = G.truck.chassis.pts;
        for (var i = 0; i < pts.length; i++) pts[i].y -= S(30, L) * dt * 60 * dt;
      } });
  V("spiketread", "Spike Tread", "move", "Grip on anything, and the tyres bite goblins.",
    { mods: function (G, L, s) { s.grip *= 1 + S(0.6, L); },
      onTick: function (G, dt, L) {
        G.truck.wheels.forEach(function (w) {
          var c = w.centroid();
          near(G, c.x, c.y, 44).forEach(function (e) { dmg(G, e, S(30, L) * dt); });
        });
      } });
  V("supersprung", "Super Sprung", "move", "Enormously bouncy. Fall damage is a memory.",
    { mods: function (G, L, s) { s.fallRes += S(0.9, L); s.bounce += S(0.4, L); } });
  V("bloodrush", "Blood Rush", "move", "Kills stack speed and fire rate together.",
    { onKill: function (G, e, L) {
        G.buff("speed", 1 + S(0.2, L), 4);
        G.buff("fireRate", 1 + S(0.14, L), 4);
      } });

  V("dronewing", "Drone Wing", "tech", "Three drones instead of one.",
    { mods: function (G, L, s) { s.drones = Math.max(s.drones, 3); s.droneDmg += S(4, L); } });
  V("sentrynest", "Sentry Nest", "tech", "Drops three turrets at once, on a shorter cooldown.",
    { active: { key: "g", cd: 9, run: function (G, L) {
        for (var i = 0; i < 3; i++) {
          var p = G.truck.localToWorld(-100 - i * 40, -10);
          G.addTurret(p.x, p.y, S(16, L), 20);
        }
      } } });
  V("predictor", "Predictor", "tech", "Bullets lead the target on their own.",
    { mods: function (G, L, s) { s.bulletSpeed *= 1 + S(0.4, L); s.crit += 0.08 * L; s.homing += 2; } });
  V("painttarget", "Paint The Target", "tech", "Marks several goblins, much harder.",
    { onTick: function (G, dt, L) {
        if (G.time - (G.count.ptT || 0) < 1.2) return;
        G.count.ptT = G.time;
        var sorted = G.enemies.slice().sort(function (a, b) { return b.hp - a.hp; });
        for (var i = 0; i < 3 && i < sorted.length; i++) st(sorted[i], "mark", S(4, L));
      } });
  V("cargobot", "Cargo Bot", "tech", "Actively rebuilds lost cargo over time.",
    { mods: function (G, L, s) { s.cargoRegen += S(1.1, L); },
      onTick: function (G, dt, L) {
        G.count.cbT = (G.count.cbT || 0) + dt;
        if (G.count.cbT < 22 / S(1, L)) return;
        G.count.cbT = 0;
        if (G.truck.crates.length < G.stats.cargoSlots) G.truck.loadCrate("boxes");
      } });
  V("hyperclock", "Hyperclock", "tech", "A longer, wilder overclock on a short cooldown.",
    { active: { key: "r", cd: 12, run: function (G, L) {
        G.buff("fireRate", 1 + S(2.6, L), 7);
        G.buff("damage", 1.3, 7);
      } } });
  V("instantshield", "Instant Shield", "tech", "Shields snap back almost immediately.",
    { mods: function (G, L, s) { s.shieldRegen *= 1 + S(2, L); s.shieldDelay *= 0.35; } });
  V("missilepod", "Missile Pod", "tech", "Six homing rockets, twice as often.",
    { onTick: function (G, dt, L) {
        if (G.time - (G.count.mpT || 0) < 3 / S(1, L)) return;
        G.count.mpT = G.time;
        var p = G.truck.turretMount();
        for (var i = 0; i < 6; i++) {
          var a = -1.6 + i * 0.24;
          shot(G, { x: p.x, y: p.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380,
                    dmg: S(14, L), size: 8, rocket: true, homing: 5, life: 3 });
        }
      } });
  V("kinetic_recl", "Kinetic Reclaimer", "tech", "Kills refund boost and a little health.",
    { onKill: function (G, e, L) {
        G.truck.fuel = Math.min(1, G.truck.fuel + S(0.14, L));
        G.healTruck(S(1, L));
      } });
  V("fortunecore", "Fortune Core", "tech", "Shops and cards both tilt heavily your way.",
    { mods: function (G, L, s) { s.luck += S(0.7, L); s.goldMul += 0.2; } });

  V("eventhorizon", "Event Horizon", "void", "Every kill collapses space around it.",
    { onKill: function (G, e, L) { G.addVortex(e.x, e.y, S(230, L), 2, S(420, L)); } });
  V("ghostround", "Ghost Rounds", "void", "Bullets ignore everything but flesh.",
    { mods: function (G, L, s) { s.phase = true; s.damage *= 1 + S(0.4, L); s.pierce += 2; } });
  V("decayaura", "Decay Aura", "void", "Everything nearby is always rotting.",
    { onTick: function (G, dt, L) {
        var p = G.truck.pos();
        near(G, p.x, p.y, S(300, L)).forEach(function (e) { dmg(G, e, S(9, L) * dt); });
      } });
  V("longstep", "Long Step", "void", "A far longer blink that damages on arrival.",
    { active: { key: "q", cd: 7, run: function (G, L) {
        var d = S(300, L);
        G.truck.chassis.translate(d, -40);
        G.truck.wheels.forEach(function (w) { w.translate(d, -40); });
        G.truck.crates.forEach(function (c) { c.translate(d, -40); });
        var p = G.truck.pos();
        boom(G, p.x, p.y, 200, S(24, L), { el: "void" });
      } } });
  V("deflector", "Deflector", "void", "Most incoming fire simply stops existing.",
    { mods: function (G, L, s) { s.bulletEat += S(0.5, L); } });
  V("reaper", "Reaper", "void", "Every 5th kill, and it pays out much more.",
    { onKill: function (G, e, L) {
        G.count.reap = (G.count.reap || 0) + 1;
        if (G.count.reap % 5) return;
        G.healTruck(S(18, L)); G.shield += S(22, L); G.healCargo(S(6, L));
      } });
  V("hex", "Hex", "void", "Cursed goblins barely do anything at all.",
    { onHit: function (G, b, e, L) {
        e.curse = Math.min(0.92, (e.curse || 0) + S(0.16, L));
        st(e, "slow", 0.08);
      } });
  V("doublecast", "Double Cast", "void", "Shots very often fire twice, sometimes thrice.",
    { onFire: function (G, b, L) {
        var n = rand(G) < S(0.4, L) ? (rand(G) < 0.3 ? 2 : 1) : 0;
        for (var i = 1; i <= n; i++) {
          (function (k) {
            setTimeout(function () {
              if (G.over) return;
              shot(G, { x: b.x, y: b.y, vx: b.vx, vy: b.vy, dmg: b.dmg, size: b.size, el: b.el });
            }, 70 * k);
          })(i);
        }
      } });
  V("singularity", "Singularity", "void", "A crushing well that also grinds them down.",
    { onTick: function (G, dt, L) {
        var p = G.truck.localToWorld(-120, -30);
        near(G, p.x, p.y, S(200, L)).forEach(function (e) {
          e.vx += (p.x - e.x) * S(3.4, L) * dt;
          e.vy += (p.y - e.y) * S(3.4, L) * dt;
          dmg(G, e, S(7, L) * dt);
        });
      } });
  V("annihilate", "Annihilate", "void", "A real chance to erase anything. Even elites.",
    { onHit: function (G, b, e, L) {
        if (rand(G) < S(0.05, L)) {
          e.hp = 0; e.die(G);
          G.fx.burst(e.x, e.y, "#D86AE8", 40);
          G.shake(8);
        }
      } });

  // ── which variants come from element pairings rather than levelling ───────
  JC.COMBOS = [
    { need: ["fire", "ice"],   gives: "steamburst" },
    { need: ["fire", "acid"],  gives: "napalm" },
    { need: ["volt", "ice"],   gives: "saltwater" },
    { need: ["volt", "acid"],  gives: "electrolysis" },
    { need: ["fire", "kin"],   gives: "tracerfire" },
    { need: ["ice", "kin"],    gives: "hailcannon" },
    { need: ["void", "fire"],  gives: "starcore" },
    { need: ["void", "ice"],   gives: "heatdeath" },
    { need: ["tech", "volt"],  gives: "arcreactor" },
    { need: ["guard", "fire"], gives: "furnaceplate" },
    { need: ["cargo", "void"], gives: "cargorift" },
    { need: ["move", "fire"],  gives: "flamewake" }
  ];

  // combo-only abilities (these count inside the 200)
  V("steamburst", "Steam Burst", "fire", "Fire meets ice: hits erupt in scalding steam.",
    { combo: true, onHit: function (G, b, e, L) {
        st(e, "wet", 0.6); st(e, "burn", 1.2);
        if (rand(G) < 0.3) boom(G, e.x, e.y, S(110, L), S(13, L), { el: "fire" });
      } });
  V("napalm", "Napalm", "fire", "Fire meets acid: sticky fire that will not go out.",
    { combo: true, onHit: function (G, b, e, L) {
        st(e, "burn", S(2, L)); st(e, "oiled", 1);
        G.addHazard(e.x, e.y, S(70, L), 6, "fire", S(8, L));
      } });
  V("electrolysis", "Electrolysis", "volt", "Volt meets acid: corrosion conducts.",
    { combo: true, onHit: function (G, b, e, L) {
        st(e, "corrode", S(2, L));
        if (JC.hasStatus(e, "corrode")) G.chainFrom(e, 2, S(7, L));
      } });
  V("tracerfire", "Tracer Fire", "kin", "Fire meets kinetic: rounds burn a line through.",
    { combo: true, mods: function (G, L, s) { s.pierce += 2; },
      onHit: function (G, b, e, L) { st(e, "burn", S(0.9, L)); dmg(G, e, S(4, L)); } });
  V("hailcannon", "Hail Cannon", "ice", "Ice meets kinetic: every shot is a frozen slug.",
    { combo: true, mods: function (G, L, s) { s.bulletSize *= 1.4; s.damage *= 1 + S(0.2, L); },
      onHit: function (G, b, e, L) { st(e, "slow", S(0.2, L)); e.knock(JC.sign(b.vx) * 180, -60); } });
  V("starcore", "Star Core", "void", "Void meets fire: a small sun follows the truck.",
    { combo: true, onTick: function (G, dt, L) {
        var a = G.time * 1.6;
        var p = G.truck.pos();
        var x = p.x + Math.cos(a) * 130, y = p.y + Math.sin(a) * 60 - 40;
        near(G, x, y, S(80, L)).forEach(function (e) { dmg(G, e, S(26, L) * dt); st(e, "burn", dt * 2); });
        G.fx.orb(x, y, "#FFAA3C", 14);
      } });
  V("heatdeath", "Heat Death", "void", "Void meets ice: everything simply stops.",
    { combo: true, onTick: function (G, dt, L) {
        if (G.time - (G.count.hdT || 0) < 9) return;
        G.count.hdT = G.time;
        G.enemies.forEach(function (e) { st(e, "freeze", S(1.6, L)); st(e, "slow", 0.5); });
        G.fx.ring(G.truck.pos().x, G.truck.pos().y, 700, "#BFEFFF");
      } });
  V("arcreactor", "Arc Reactor", "tech", "Tech meets volt: drones fire lightning.",
    { combo: true, mods: function (G, L, s) { s.drones = Math.max(s.drones, 2); s.droneDmg += S(6, L); s.droneEl = "volt"; } });
  V("furnaceplate", "Furnace Plate", "guard", "Guard meets fire: armour that cooks attackers.",
    { combo: true, mods: function (G, L, s) { s.armor += S(1.6, L); },
      onHurt: function (G, amt, src, L) { if (src) { st(src, "burn", S(4, L)); dmg(G, src, S(12, L)); } } });
  V("cargorift", "Cargo Rift", "cargo", "Cargo meets void: spilled crates teleport back.",
    { combo: true, onSpill: function (G, kind, L) {
        if (rand(G) < S(0.75, L)) { G.truck.loadCrate(kind); return true; }
      } });
  V("flamewake", "Flame Wake", "move", "Mobility meets fire: speed leaves a burning trail.",
    { combo: true, onTick: function (G, dt, L) {
        if (Math.abs(G.truck.vel().x) < 5) return;
        if (G.time - (G.count.fwT || 0) < 0.14) return;
        G.count.fwT = G.time;
        var p = G.truck.localToWorld(-92, 8);
        G.addHazard(p.x, p.y, S(60, L), 3, "fire", S(11, L));
      } });

  // ══════════════════════════════════════════════════════════════════════════
  //  STAT UPGRADE POOL — the plain, always-useful cards
  // ══════════════════════════════════════════════════════════════════════════
  JC.STATS = [
    { id: "s_dmg",    name: "Bigger Rounds",   desc: "+18% turret damage",     apply: function (s, n) { s.damage *= 1 + 0.18 * n; } },
    { id: "s_rate",   name: "Faster Cycling",  desc: "+15% fire rate",         apply: function (s, n) { s.fireRate *= 1 + 0.15 * n; } },
    { id: "s_hp",     name: "Thicker Steel",   desc: "+25 truck health",       apply: function (s, n) { s.truckHp += 25 * n; } },
    { id: "s_cargo",  name: "Cargo Bracing",   desc: "+20 cargo health",       apply: function (s, n) { s.cargoHp += 20 * n; } },
    { id: "s_armor",  name: "Welded Plate",    desc: "+1.2 armour",            apply: function (s, n) { s.armor += 1.2 * n; } },
    { id: "s_grip",   name: "Grippier Rubber", desc: "+15% grip",              apply: function (s, n) { s.grip *= 1 + 0.15 * n; } },
    { id: "s_torque", name: "More Torque",     desc: "+15% climbing power",    apply: function (s, n) { s.torque *= 1 + 0.15 * n; } },
    { id: "s_speed",  name: "Longer Gearing",  desc: "+12% top speed",         apply: function (s, n) { s.maxSpeed *= 1 + 0.12 * n; } },
    { id: "s_slots",  name: "Bed Extension",   desc: "+2 cargo slots",         apply: function (s, n) { s.cargoSlots += 2 * n; } },
    { id: "s_grips",  name: "Tie-Downs",       desc: "+25% cargo grip",        apply: function (s, n) { s.cargoGrip += 0.25 * n; } },
    { id: "s_gold",   name: "Haggling",        desc: "+20% gold from goblins", apply: function (s, n) { s.goldMul += 0.2 * n; } },
    { id: "s_sell",   name: "Better Contacts", desc: "+15% cargo sale price",  apply: function (s, n) { s.sellMul += 0.15 * n; } },
    { id: "s_crit",   name: "Sharp Eye",       desc: "+6% crit chance",        apply: function (s, n) { s.crit += 0.06 * n; } },
    { id: "s_pierce", name: "Hardened Tips",   desc: "+1 pierce",              apply: function (s, n) { s.pierce += n; } },
    { id: "s_regen",  name: "Spare Parts",     desc: "+0.5 health per second", apply: function (s, n) { s.regen += 0.5 * n; } },
    { id: "s_fuel",   name: "Fuel Pump",       desc: "Boost recharges 20% faster", apply: function (s, n) { s.fuelRegen *= Math.pow(0.8, n); } },
    { id: "s_luck",   name: "Lucky Charm",     desc: "+15% luck",              apply: function (s, n) { s.luck += 0.15 * n; } },
    { id: "s_bspeed", name: "Hotter Powder",   desc: "+20% bullet speed",      apply: function (s, n) { s.bulletSpeed *= 1 + 0.2 * n; } },
    { id: "s_shield", name: "Shield Cells",    desc: "+15 shield",             apply: function (s, n) { s.shieldMax += 15 * n; } },
    { id: "s_stab",   name: "Ballast Weights", desc: "+25% stability",         apply: function (s, n) { s.stability += 0.25 * n; } }
  ];

  // ── engine ────────────────────────────────────────────────────────────────
  JC.AbilitySet = function () {
    this.owned = {};        // id -> level
    this.order = [];
  };

  var AS = JC.AbilitySet.prototype;

  AS.has = function (id) { return !!this.owned[id]; };
  AS.level = function (id) { return this.owned[id] || 0; };
  AS.count = function () { return this.order.length; };

  AS.grant = function (id) {
    if (!JC.ABILITIES[id]) return;
    if (this.owned[id]) {
      var max = JC.ABILITIES[id].maxLevel;
      this.owned[id] = Math.min(max, this.owned[id] + 1);
    } else {
      this.owned[id] = 1;
      this.order.push(id);
    }
  };

  AS.elements = function () {
    var set = {};
    for (var i = 0; i < this.order.length; i++) set[JC.ABILITIES[this.order[i]].el] = true;
    return set;
  };

  /* Which variants are currently reachable. */
  AS.unlockedVariants = function () {
    var out = [], seen = {}, els = this.elements(), i;

    for (i = 0; i < this.order.length; i++) {
      var id = this.order[i], a = JC.ABILITIES[id];
      if (!a.variant || this.owned[a.variant] || this.owned[id] < 3) continue;
      // a combo-gated variant still wants its pairing, not just a level 3 base
      var vc = JC.ABILITIES[a.variant].combo;
      if (vc && vc.length && !(els[vc[0]] && els[vc[1]])) continue;
      if (!seen[a.variant]) { seen[a.variant] = 1; out.push(a.variant); }
    }

    for (i = 0; i < JC.COMBOS.length; i++) {
      var c = JC.COMBOS[i];
      if (!els[c.need[0]] || !els[c.need[1]] || this.owned[c.gives]) continue;
      /* Saltwater is both a combo and Superconductor upgraded form, so the
         pairing alone used to hand you the upgraded version of an ability you
         did not own. If it belongs to a base, you need that base first. */
      var base = JC.variantBase(c.gives);
      if (base && !this.owned[base]) continue;
      if (!seen[c.gives]) { seen[c.gives] = 1; out.push(c.gives); }
    }
    return out;
  };

  /* Abilities that can still be levelled up. */
  AS.upgradable = function () {
    var out = [];
    for (var i = 0; i < this.order.length; i++) {
      var id = this.order[i];
      if (this.owned[id] < JC.ABILITIES[id].maxLevel) out.push(id);
    }
    return out;
  };

  AS.fire = function (hook) {
    var args = Array.prototype.slice.call(arguments, 1);
    var handled = false;
    for (var i = 0; i < this.order.length; i++) {
      var id = this.order[i], a = JC.ABILITIES[id];
      if (!a[hook]) continue;
      var r = a[hook].apply(a, args.concat([this.owned[id]]));
      if (r) handled = true;
    }
    return handled;
  };

  AS.applyMods = function (G, s) {
    for (var i = 0; i < this.order.length; i++) {
      var id = this.order[i], a = JC.ABILITIES[id];
      if (a.mods) a.mods(G, this.owned[id], s);
    }
  };

  AS.actives = function () {
    var out = [];
    for (var i = 0; i < this.order.length; i++) {
      var a = JC.ABILITIES[this.order[i]];
      if (a.active) out.push({ id: a.id, a: a, L: this.owned[a.id] });
    }
    return out;
  };

  JC.abilityTotal = function () { return Object.keys(JC.ABILITIES).length; };

})(window.JC);
