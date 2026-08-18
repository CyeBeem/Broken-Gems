/* Cargo stops: sell what survived, buy gear, load up again.

   Every piece of gear rolls a quality from 0 to 1. Luck and how far you are
   from the start both push that roll upward, so an early ram bar is usually
   junk and a late one can be the run-defining pickup. */
window.JC = window.JC || {};
(function (JC) {
  "use strict";

  JC.GRADES = [
    { at: 0.00, name: "Rusty",    color: "#9A8E80", mul: 0.55 },
    { at: 0.22, name: "Basic",    color: "#C8C2B4", mul: 0.80 },
    { at: 0.45, name: "Solid",    color: "#7FC94F", mul: 1.00 },
    { at: 0.66, name: "Fine",     color: "#4FB3E8", mul: 1.30 },
    { at: 0.83, name: "Prime",    color: "#B08FE8", mul: 1.70 },
    { at: 0.94, name: "Legendary",color: "#FFB23C", mul: 2.35 }
  ];

  JC.gradeFor = function (q) {
    var g = JC.GRADES[0];
    for (var i = 0; i < JC.GRADES.length; i++) if (q >= JC.GRADES[i].at) g = JC.GRADES[i];
    return g;
  };

  /* 20 pieces of gear. `apply` takes the rolled multiplier so quality
     genuinely changes how good the thing is. */
  JC.GEAR = [
    { id: "wheels", name: "Off-Road Wheels", cost: 90, icon: "wheel",
      text: function (m) { return "+" + pc(0.22 * m) + " climbing power, +" + pc(0.12 * m) + " grip"; },
      apply: function (s, m) { s.torque *= 1 + 0.22 * m; s.grip *= 1 + 0.12 * m; } },
    { id: "susp", name: "Rally Suspension", cost: 85, icon: "spring",
      text: function (m) { return "+" + pc(0.3 * m) + " stability, +" + pc(0.22 * m) + " cargo grip"; },
      apply: function (s, m) { s.stability += 0.3 * m; s.cargoGrip += 0.22 * m; } },
    { id: "armor", name: "Armour Plating", cost: 110, icon: "plate",
      text: function (m) { return "+" + (1.8 * m).toFixed(1) + " armour, +" + Math.round(18 * m) + " health"; },
      apply: function (s, m) { s.armor += 1.8 * m; s.truckHp += 18 * m; } },
    { id: "ram", name: "Ram Bar", cost: 100, icon: "ram",
      text: function (m) { return "+" + pc(0.7 * m) + " ramming damage"; },
      apply: function (s, m) { s.ram *= 1 + 0.7 * m; } },
    { id: "engine", name: "Engine Block", cost: 130, icon: "engine",
      text: function (m) { return "+" + pc(0.18 * m) + " top speed and torque"; },
      apply: function (s, m) { s.maxSpeed *= 1 + 0.18 * m; s.torque *= 1 + 0.18 * m; } },
    { id: "tank", name: "Auxiliary Tank", cost: 80, icon: "tank",
      text: function (m) { return "Boost recharges " + pc(0.3 * m) + " faster"; },
      apply: function (s, m) { s.fuelRegen *= 1 - Math.min(0.7, 0.3 * m); } },
    { id: "barrel", name: "Long Barrel", cost: 120, icon: "barrel",
      text: function (m) { return "+" + pc(0.25 * m) + " turret damage"; },
      apply: function (s, m) { s.damage *= 1 + 0.25 * m; } },
    { id: "loader", name: "Autoloader", cost: 125, icon: "loader",
      text: function (m) { return "+" + pc(0.22 * m) + " fire rate"; },
      apply: function (s, m) { s.fireRate *= 1 + 0.22 * m; } },
    { id: "net", name: "Heavy Cargo Net", cost: 70, icon: "net",
      text: function (m) { return "+" + pc(0.45 * m) + " cargo grip"; },
      apply: function (s, m) { s.cargoGrip += 0.45 * m; } },
    { id: "bed", name: "Bed Extension", cost: 140, icon: "bed",
      text: function (m) { return "+" + Math.max(1, Math.round(3 * m)) + " cargo slots"; },
      apply: function (s, m) { s.cargoSlots += Math.max(1, Math.round(3 * m)); } },
    { id: "spikes", name: "Spiked Bumper", cost: 95, icon: "spikes",
      text: function (m) { return "Attackers take " + Math.round(9 * m) + " damage"; },
      apply: function (s, m) { s.thorns += 9 * m; } },
    { id: "rad", name: "Field Radiator", cost: 105, icon: "rad",
      text: function (m) { return "+" + (0.7 * m).toFixed(1) + " health per second"; },
      apply: function (s, m) { s.regen += 0.7 * m; } },
    { id: "nitro", name: "Nitrous Bottle", cost: 115, icon: "nitro",
      text: function (m) { return "+" + pc(0.45 * m) + " boost power"; },
      apply: function (s, m) { s.boostPower *= 1 + 0.45 * m; } },
    { id: "axles", name: "Reinforced Axles", cost: 100, icon: "axle",
      text: function (m) { return "+" + Math.round(38 * m) + " truck health"; },
      apply: function (s, m) { s.truckHp += 38 * m; } },
    { id: "pad", name: "Crate Padding", cost: 85, icon: "pad",
      text: function (m) { return "Cargo takes " + pc(0.3 * m) + " less damage"; },
      apply: function (s, m) { s.cargoArmor += 0.3 * m; } },
    { id: "scanner", name: "Scanner Array", cost: 130, icon: "scan",
      text: function (m) { return "+" + pc(0.14 * m) + " crit chance"; },
      apply: function (s, m) { s.crit += 0.14 * m; } },
    { id: "magnet", name: "Magnet Coil", cost: 75, icon: "magnet",
      text: function (m) { return "+" + Math.round(220 * m) + " pickup range"; },
      apply: function (s, m) { s.magnet += 220 * m; } },
    { id: "winch", name: "Recovery Winch", cost: 110, icon: "winch",
      text: function (m) { return pc(0.35 * m) + " chance to recover spilled crates"; },
      apply: function (s, m) { s.spillSave += 0.35 * m; } },
    { id: "dice", name: "Loaded Dice", cost: 90, icon: "dice",
      text: function (m) { return "+" + pc(0.4 * m) + " luck"; },
      apply: function (s, m) { s.luck += 0.4 * m; } },
    { id: "emitter", name: "Shield Emitter", cost: 150, icon: "shield",
      text: function (m) { return "+" + Math.round(34 * m) + " shield"; },
      apply: function (s, m) { s.shieldMax += 34 * m; } }
  ];

  function pc(v) { return Math.round(v * 100) + "%"; }

  // ── rolling a shop ────────────────────────────────────────────────────────
  /* leg is how many stops you have already reached; luck comes from stats. */
  JC.rollShop = function (rng, leg, luck) {
    var pool = JC.GEAR.slice();
    var picks = rng.sample(pool, 5);
    return picks.map(function (g) {
      var q = rollQuality(rng, leg, luck);
      var grade = JC.gradeFor(q);
      return {
        gear: g,
        q: q,
        grade: grade,
        mul: grade.mul,
        cost: Math.round(g.cost * (0.7 + grade.mul * 0.75) * (1 + leg * 0.13)),
        bought: false
      };
    });
  };

  /* Two rolls, keep the better — luck and distance bias how many rolls you
     effectively get, which makes late shops feel meaningfully richer. */
  function rollQuality(rng, leg, luck) {
    var tries = 1 + Math.floor(leg * 0.5 + luck * 2);
    var best = 0;
    for (var i = 0; i < tries; i++) best = Math.max(best, rng());
    // a gentle upward push so nothing is ever purely floor-tier late on
    return JC.clamp(best * (0.82 + leg * 0.03 + luck * 0.1), 0, 0.999);
  }

  /* What cargo this stop is willing to sell you. Later stops unlock the
     dangerous, valuable stuff. */
  JC.cargoOffers = function (leg) {
    var out = [];
    for (var i = 0; i < JC.CARGO_ORDER.length; i++) {
      var k = JC.CARGO_ORDER[i];
      var c = JC.CARGO[k];
      if (c.tier > Math.floor(leg / 1.5)) continue;
      out.push({ kind: k, def: c, cost: Math.round(c.buy * (1 + leg * 0.08)) });
    }
    return out;
  };

  /* Cargo is worth more the further you have hauled it. */
  JC.sellPrice = function (kind, leg, sellMul) {
    var c = JC.CARGO[kind] || JC.CARGO.boxes;
    return Math.round(c.value * (1 + leg * 0.22) * (sellMul || 1));
  };

})(window.JC);
