/* The jelly truck: a soft chassis, two pressurised tyres, suspension joints,
   a roof turret, and a cargo bed that crates can genuinely bounce out of. */
window.JC = window.JC || {};
(function (JC) {
  "use strict";

  /* Side profile, nose pointing right. The bed is a real notch in the hull,
     so crates sit inside it instead of being pushed out as intersections. */
  var HULL = [
    [-92, -54],   // 0  tailgate, top outer
    [-80, -54],   // 1  tailgate, top inner
    [-80,   6],   // 2  bed floor, rear
    [  6,   6],   // 3  bed floor, front
    [  6, -78],   // 4  cab, rear roofline
    [ 62, -78],   // 5  cab, front roofline
    [ 72, -56],   // 6  above the grille
    [ 78,  20],   // 7  nose, bottom
    [ -6,  20],   // 8  under-body
    [-92,  20]    // 9  rear bottom
  ];

  var WHEEL_R = 30;
  var AXLES = [[-54, 32], [54, 32]];

  JC.Truck = function (world, x, y) {
    this.world = world;
    this.crates = [];
    this.turret = { ang: 0, cool: 0, recoil: 0 };
    this.fuel = 1;                 // rocket boost charge, 0..1
    this.boosting = 0;
    this.wheelSpin = [0, 0];
    this.airTime = 0;
    this.flipTimer = 0;
    this.squash = 0;      // spikes on impact, decays
    this.stretch = 0;     // positive while falling
    this.lastVy = 0;

    // ── chassis ──
    var ch = new JC.Body({ match: 0.14, friction: 0.35, color: "#E8453C", kind: "truck" });
    var i;
    var NOSE = { 6: 1, 7: 1 };                 // engine bay, up front
    for (i = 0; i < HULL.length; i++) {
      ch.add(x + HULL[i][0], y + HULL[i][1], NOSE[i] ? 3.1 : 1.6);
      ch.hull.push(i);
    }
    for (i = 0; i < HULL.length; i++) ch.link(i, (i + 1) % HULL.length, 0.55);
    // internal bracing, every non-adjacent pair at reduced stiffness
    for (i = 0; i < HULL.length; i++) {
      for (var j = i + 2; j < HULL.length; j++) {
        if (i === 0 && j === HULL.length - 1) continue;
        ch.link(i, j, 0.22);
      }
    }
    ch.bake();
    ch.userData.group = "truck";
    ch.userData.noSelf = true;                 // wheels live inside the arches
    this.chassis = world.add(ch);

    // ── wheels ──
    this.wheels = [];
    this.hubs = [];
    for (var w = 0; w < 2; w++) {
      var wx = x + AXLES[w][0], wy = y + AXLES[w][1];
      var tyre = JC.makeWheel(wx, wy, WHEEL_R, 12, {
        match: 0.055, pressure: 2.6, friction: 0.92, color: "#2E2A33", kind: "wheel"
      });
      var hub = tyre.add(wx, wy, 2.2);          // axle at the centre
      for (var k = 0; k < 12; k++) tyre.link(k, 12, 0.55);
      tyre.bake();
      tyre.userData.group = "truck";
      tyre.userData.noSelf = true;
      tyre.userData.hub = hub;
      world.add(tyre);
      this.wheels.push(tyre);

      // two links to the floor either side of the axle...
      var anchors = w === 0 ? [9, 8] : [8, 7];
      for (var a = 0; a < anchors.length; a++) {
        world.joint(hub, ch.pts[anchors[a]], undefined, 0.30);
      }
      // ...plus one near-vertical strut carrying the weight
      world.joint(hub, ch.pts[w === 0 ? 1 : 6], undefined, 0.26);
      this.hubs.push(hub);
    }

    // brace the two hubs together so the wheelbase cannot fold
    world.joint(this.hubs[0], this.hubs[1], undefined, 0.6);

    /* Bed geometry in the same frame localToWorld uses. Taken from the baked
       rest shape rather than the raw HULL numbers, which are relative to the
       spawn point, not the centroid. */
    var F = ch.frame;
    this.bed = {
      back:  F[2].x,      // inside face of the tailgate
      front: F[3].x,      // back of the cab
      floor: F[2].y,      // bed floor
      rail:  F[1].y       // top of the sides; above this a crate can leave
    };

    this.baseY = y;
  };

  var T = JC.Truck.prototype;

  T.pos = function () { return this.chassis.centroid(); };
  T.vel = function () { return this.chassis.velocity(); };
  T.angle = function () { return this.chassis.angle(); };

  /* Where the turret sits, in world space, following the squashed roof. */
  T.turretMount = function () {
    var a = this.chassis.pts[4], b = this.chassis.pts[5];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 6 };
  };

  T.localToWorld = function (lx, ly) {
    var c = this.chassis.centroid(), a = this.chassis.angle();
    var ca = Math.cos(a), sa = Math.sin(a);
    return { x: c.x + lx * ca - ly * sa, y: c.y + lx * sa + ly * ca };
  };

  // ── driving ───────────────────────────────────────────────────────────────
  /* throttle -1..1, lean -1..1. Mirrors Jelly Truck: up accelerates, left and
     right both lean the body and drive, and finesse beats flooring it. */
  T.drive = function (dt, throttle, lean, stats) {
    var torque = (stats.torque || 1);
    var grip = (stats.grip || 1);
    var maxSpd = (stats.maxSpeed || 1) * 1.45;

    var v = this.chassis.velocity();
    var speed = v.x;

    for (var i = 0; i < this.wheels.length; i++) {
      var wheel = this.wheels[i];
      var over = Math.abs(speed) > maxSpd && JC.sign(speed) === JC.sign(throttle);
      var t = over ? 0 : throttle;
      // grounded wheels bite, airborne ones just spin up
      var bite = wheel.grounded ? 1 : 0.22;
      wheel.spin += t * torque * 0.165 * bite * grip;
      this.wheelSpin[i] = JC.lerp(this.wheelSpin[i], t * 9, 0.25);
    }

    // a wheel with nothing under it should wind down, not whirl for ever
    for (var d = 0; d < this.wheels.length; d++) {
      var fw = this.wheels[d];
      if (fw.grounded || throttle) continue;
      fw.spin -= fw.spinRate() * 0.10;
    }

    var onGround = this.wheels[0].grounded || this.wheels[1].grounded;

    // leaning: gentle with the wheels down, full authority once airborne
    if (lean) {
      this.torque(((onGround ? 5 : 26)) * lean * dt);
    }

    /* With wheels on the ground the chassis wants to sit level with the slope.
       Without this the lean input just spins you over in a few seconds. */
    if (onGround) {
      var terr = this.world.terrain;
      var c2 = this.chassis.centroid();
      var target = Math.atan(JC.clamp(terr.slopeAt(c2.x), -1.2, 1.2));
      var err = JC.angDiff(this.chassis.angle(), target);
      this.torque(JC.clamp(err, -1, 1) * 130 * (1 + (stats.stability || 0)) * dt);
    }

    // airborne tracking, for the flip-recovery feel
    if (!this.chassis.grounded && !this.wheels[0].grounded && !this.wheels[1].grounded) {
      this.airTime += dt;
      if (!lean) {                                  // no input: settle level
        var lv = JC.angDiff(this.chassis.angle(), 0);
        this.torque(JC.clamp(lv, -1, 1) * 34 * dt);
      }
    } else {
      this.airTime = 0;
    }
  };

  T.updateSquash = function (dt) {
    var v = this.chassis.velocity();
    var dv = v.y - this.lastVy;
    this.lastVy = v.y;
    var impact = Math.max(0, -dv);                 // sudden stop = landing
    var hit = Math.min(0.42, impact * 0.16);
    this.squash = Math.max(this.squash * Math.pow(0.0006, dt), hit);
    this.stretch = JC.clamp(v.y * 0.05, -0.08, 0.28);
  };

  /* Rotate the chassis about its centroid. */
  T.torque = function (amount) {
    if (!amount) return;
    var c = this.chassis.centroid();
    for (var i = 0; i < this.chassis.pts.length; i++) {
      var p = this.chassis.pts[i];
      var dx = p.x - c.x, dy = p.y - c.y;
      var d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      p.x += (-dy / d) * amount;
      p.y += (dx / d) * amount;
    }
  };

  /* Rocket thrusters — held, drains the fuel bar, only usable when full. */
  T.boost = function (dt, stats) {
    if (this.fuel < 1 && this.boosting <= 0) return false;
    this.boosting = 1;
    var drain = dt / (stats.fuelDur || 1.1);
    this.fuel = Math.max(0, this.fuel - drain);
    if (this.fuel <= 0) { this.boosting = 0; return false; }

    var a = this.chassis.angle();
    var fx = Math.cos(a), fy = Math.sin(a);
    var power = 46 * (stats.boostPower || 1) * dt;
    for (var i = 0; i < this.chassis.pts.length; i++) {
      this.chassis.pts[i].x += fx * power;
      this.chassis.pts[i].y += fy * power;
    }
    return true;
  };

  T.rechargeFuel = function (dt, stats) {
    if (this.boosting) return;
    this.fuel = Math.min(1, this.fuel + dt / (stats.fuelRegen || 6));
  };

  // ── cargo ─────────────────────────────────────────────────────────────────
  /* Crates are real bodies dropped into the bed. Stack them past the tailgate
     and a hard landing will genuinely throw them out the back. */
  T.loadCrate = function (kind) {
    var bed = this.bedSlot(this.crates.length);
    var spec = JC.CARGO[kind] || JC.CARGO.boxes;
    var b = JC.makeBox(bed.x, bed.y, 21, 21, {
      match: 0.55, friction: 0.7, color: spec.color, kind: "cargo"
    });
    b.userData.group = "cargo";
    b.userData.cargo = kind;
    b.userData.settled = 0;
    this.world.add(b);
    this.crates.push(b);
    return b;
  };

  T.bedSlot = function (n) {
    var b = this.bed;
    var col = n % 3, row = Math.floor(n / 3);
    var span = (b.front - b.back - 63) / 2;             // centre three columns
    var lx = b.back + span + 10.5 + col * 21;
    var ly = b.floor - 10.5 - row * 21;
    return this.localToWorld(lx, ly);
  };

  T.unloadAll = function () {
    for (var i = 0; i < this.crates.length; i++) this.world.remove(this.crates[i]);
    var kinds = this.crates.map(function (c) { return c.userData.cargo; });
    this.crates.length = 0;
    return kinds;
  };

  /* Anything that has drifted well clear of the bed counts as lost. */
  T.checkSpills = function () {
    var c = this.chassis.centroid();
    var lost = [];
    for (var i = this.crates.length - 1; i >= 0; i--) {
      var box = this.crates[i];
      var b = box.centroid();
      var far = JC.dist(b.x, b.y, c.x, c.y) > 210;
      var behind = (b.x - c.x) < -140;
      var below = b.y - c.y > 110;
      if (far || behind || below) {
        lost.push(box.userData.cargo);
        this.crates.splice(i, 1);
        box.userData.spilled = true;
        box.color = JC.shade(box.color, -0.3);
        // leave it in the world briefly so you see it tumble away
        box.userData.despawnAt = performance.now() + 5000;
      }
    }
    return lost;
  };

  T.cargoValue = function () {
    var v = 0;
    for (var i = 0; i < this.crates.length; i++) {
      v += (JC.CARGO[this.crates[i].userData.cargo] || JC.CARGO.boxes).value;
    }
    return v;
  };

  // ── damage feedback ───────────────────────────────────────────────────────
  T.shove = function (ix, iy) {
    this.chassis.impulse(-ix, -iy);
  };

  T.isUpsideDown = function () {
    var a = this.angle();
    return Math.abs(a) > 2.1;
  };

  /* Nudge a flipped truck back over rather than ending the run on bad luck. */
  T.selfRight = function (dt) {
    if (!this.isUpsideDown()) { this.flipTimer = 0; return false; }
    this.flipTimer += dt;
    if (this.flipTimer < 1.1) return false;
    var c = this.chassis.centroid();
    var dir = this.angle() > 0 ? -1 : 1;
    for (var i = 0; i < this.chassis.pts.length; i++) {
      var p = this.chassis.pts[i];
      var dx = p.x - c.x, dy = p.y - c.y;
      var d = Math.hypot(dx, dy) || 1;
      p.x += (-dy / d) * dir * 34 * dt;
      p.y += (dx / d) * dir * 34 * dt;
      p.y -= 30 * dt;
    }
    return true;
  };

  // ── cargo kinds ───────────────────────────────────────────────────────────
  JC.CARGO = {
    boxes:   { name: "Crates",        value: 10,  color: "#C98A4B", buy: 14,  tier: 0,
               blurb: "Honest cardboard. Nobody pays much for honest cardboard." },
    water:   { name: "Water Drums",   value: 22,  color: "#4FB3E8", buy: 30,  tier: 1,
               blurb: "Heavy, sloshy, and worth a fair bit out in the dunes." },
    food:    { name: "Food Pallets",  value: 42,  color: "#7FC94F", buy: 58,  tier: 2,
               blurb: "Perishable. Goblins love it, which is the problem." },
    gas:     { name: "Fuel Cans",     value: 78,  color: "#E8A83C", buy: 105, tier: 3,
               blurb: "Explosive. Do not let the bombers near the bed." },
    nuclear: { name: "Nuclear Waste", value: 150, color: "#8FE84F", buy: 200, tier: 4,
               blurb: "Glows. Pays. Ask no further questions." }
  };

  JC.CARGO_ORDER = ["boxes", "water", "food", "gas", "nuclear"];

})(window.JC);
