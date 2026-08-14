/* Graph interpreter.
   Execution is split into fibers so that `while`, `split gate` and the
   always-on `either` outputs can run branches side by side. */
window.BG = window.BG || {};
(function (BG) {
  "use strict";

  var MAX_HOPS = 2000;      // instant transitions per fiber per frame

  BG.Interp = function (graph, world, hooks) {
    this.g = graph;
    this.world = world;
    this.hooks = hooks || {};
    this.reset();
  };

  BG.Interp.prototype.reset = function () {
    var self = this;
    this.vars = {};
    this.g.vars.forEach(function (v) { self.vars[v.id] = 0; });

    this.fibers = [];
    this.seq = 1;
    this.finished = false;
    this.stopReason = null;

    // one watcher per `while` block
    this.whiles = Object.keys(this.g.nodes)
      .filter(function (id) { return self.g.nodes[id].type === "while"; })
      .map(function (id) { return { id: id, fiber: null }; });

    var start = this.nodeOfType("start");
    if (start) this.spawnAt(start.id);
    else this.log("No Start node found.", "err");
  };

  // ── graph lookups ─────────────────────────────────────────────────────────
  BG.Interp.prototype.nodeOfType = function (t) {
    var g = this.g;
    var id = Object.keys(g.nodes).filter(function (k) { return g.nodes[k].type === t; })[0];
    return id ? g.nodes[id] : null;
  };

  BG.Interp.prototype.wireTarget = function (nodeId, port) {
    var w = this.g.wires.filter(function (w) {
      return w.from.n === nodeId && w.from.p === port;
    })[0];
    return w ? w.to.n : null;
  };

  // ── fibers ────────────────────────────────────────────────────────────────
  BG.Interp.prototype.spawnAt = function (nodeId) {
    if (!nodeId || !this.g.nodes[nodeId]) return null;
    var f = { id: "f" + (this.seq++), node: nodeId, entered: false, s: {}, loops: {} };
    this.fibers.push(f);
    return f;
  };

  BG.Interp.prototype.killFiber = function (f) {
    this.world.clearMotion(f.id);
    f.node = null;
    var i = this.fibers.indexOf(f);
    if (i >= 0) this.fibers.splice(i, 1);
  };

  BG.Interp.prototype.activeNodes = function () {
    return this.fibers.filter(function (f) { return f.node; })
                      .map(function (f) { return f.node; });
  };

  BG.Interp.prototype.log = function (msg, kind) {
    if (this.hooks.onLog) this.hooks.onLog(msg, kind || "info");
  };

  // ── values ────────────────────────────────────────────────────────────────
  BG.Interp.prototype.ctx = function () {
    var self = this;
    return {
      world: this.world,
      getVar: function (id) { var v = self.vars[id]; return v === undefined ? 0 : v; }
    };
  };

  BG.Interp.prototype.slot = function (node, key) {
    return BG.evalExpr(node.slots[key], this.ctx());
  };

  BG.Interp.prototype.slotNum = function (node, key, dflt) {
    var v = this.slot(node, key);
    if (v === null) return dflt === undefined ? null : dflt;
    var n = typeof v === "number" ? v : parseFloat(v);
    return isNaN(n) ? (dflt === undefined ? null : dflt) : n;
  };

  BG.Interp.prototype.condFn = function (node, key) {
    var self = this;
    if (BG.exprIsEmpty(node.slots[key])) return null;     // blank == run forever
    return function () { return BG.truthy(self.slot(node, key)); };
  };

  // ── main step ─────────────────────────────────────────────────────────────
  /* dt is already multiplied by the speed setting. */
  BG.Interp.prototype.step = function (dt) {
    if (this.finished) return;

    this.updateWhiles();

    for (var i = this.fibers.length - 1; i >= 0; i--) {
      var f = this.fibers[i];
      if (!f.node) { this.fibers.splice(i, 1); continue; }
      this.runFiber(f, dt);
      if (this.finished) return;
    }

    if (!this.fibers.length) {
      this.finished = true;
      this.stopReason = "end";
      if (this.hooks.onFinish) this.hooks.onFinish("end");
    }
  };

  /* A `while` block runs its `do` chain for as long as the node its
     `while` output points at is still executing. */
  BG.Interp.prototype.updateWhiles = function () {
    var self = this;
    this.whiles.forEach(function (w) {
      var watched = self.wireTarget(w.id, "while");
      var doTarget = self.wireTarget(w.id, "do");
      var active = watched && self.fibers.some(function (f) {
        return f.node === watched && f !== w.fiber;
      });

      if (active && doTarget) {
        if (!w.fiber || !w.fiber.node) w.fiber = self.spawnAt(doTarget);
      } else if (w.fiber) {
        if (w.fiber.node) self.killFiber(w.fiber);
        w.fiber = null;
      }
    });
  };

  BG.Interp.prototype.runFiber = function (f, dt) {
    var hops = 0;

    while (f.node && hops < MAX_HOPS) {
      var node = this.g.nodes[f.node];
      if (!node) { this.killFiber(f); return; }

      if (!f.entered) { f.entered = true; f.s = {}; }

      var out = this.tick(node, f, dt);
      if (out === null) return;                 // still busy this frame

      hops++;

      // extra ports fork a new branch; the first port keeps this fiber
      var ports = Array.isArray(out) ? out : [out];
      for (var i = 1; i < ports.length; i++) {
        var extra = this.wireTarget(node.id, ports[i]);
        if (extra) this.spawnAt(extra);
      }

      var next = this.wireTarget(node.id, ports[0]);
      if (!next) { this.killFiber(f); return; }
      f.node = next;
      f.entered = false;
    }

    if (hops >= MAX_HOPS) {
      this.log("Runaway loop — add a Wait or a Move so the branch can breathe.", "err");
      this.abort("runaway");
    }
  };

  BG.Interp.prototype.abort = function (reason) {
    this.finished = true;
    this.stopReason = reason;
    this.fibers.length = 0;
    this.world.clearMotion(null);
    if (this.hooks.onFinish) this.hooks.onFinish(reason);
  };

  // ── per-node behaviour ────────────────────────────────────────────────────
  /* Returns null while still running, a port id to continue on,
     or an array of ports where [0] continues and the rest fork. */
  BG.Interp.prototype.tick = function (node, f, dt) {
    var W = this.world;

    switch (node.type) {

      case "start":
        return "next";

      case "while":
        return null;                    // driven by updateWhiles, never walked into

      case "move": {
        if (!f.s.started) {
          var amt = this.slotNum(node, "amount", null);
          if (amt === null) {
            this.log("Move has an empty amount — skipping.", "warn");
            return "done";
          }
          if (!W.startMove(f.id, node.fields.dir, Math.abs(amt) * BG.UNIT, null)) return null;
          if (amt < 0) W.motion.vec = { x: -W.motion.vec.x, y: -W.motion.vec.y };
          f.s.started = true;
        }
        if (W.motion && W.motion.owner === f.id && W.motion.done) {
          W.clearMotion(f.id);
          return "done";
        }
        return null;
      }

      case "moveUntil": {
        if (!f.s.started) {
          if (!W.startMove(f.id, node.fields.dir, null, this.condFn(node, "cond"))) return null;
          f.s.started = true;
        }
        if (W.motion && W.motion.owner === f.id && W.motion.done) {
          W.clearMotion(f.id);
          return "done";
        }
        return null;
      }

      case "turn": {
        if (!f.s.started) {
          var deg = this.slotNum(node, "deg", null);
          if (deg === null) {
            this.log("Turn has an empty degrees box — skipping.", "warn");
            return "done";
          }
          if (!W.startTurn(f.id, deg, null)) return null;
          f.s.started = true;
        }
        if (W.motion && W.motion.owner === f.id && W.motion.done) {
          W.clearMotion(f.id);
          return "done";
        }
        return null;
      }

      case "turnUntil": {
        if (!f.s.started) {
          if (!W.startTurn(f.id, null, this.condFn(node, "cond"))) return null;
          f.s.started = true;
        }
        if (W.motion && W.motion.owner === f.id && W.motion.done) {
          W.clearMotion(f.id);
          return "done";
        }
        return null;
      }

      case "raycast": {
        var d = this.slotNum(node, "dist", null);
        var tiles = d === null ? null : Math.abs(d) * BG.UNIT;
        var yes = W.rayAnswer(node.fields.dir, tiles, node.fields.target);
        return [yes ? "yes" : "no", "either"];
      }

      case "wait": {
        if (f.s.left === undefined) {
          var secs = this.slotNum(node, "secs", null);
          if (secs === null) {
            this.log("Wait has an empty seconds box — skipping.", "warn");
            return "done";
          }
          f.s.left = Math.max(0, secs);
        }
        f.s.left -= dt;
        if (f.s.left <= 0) return "done";
        return null;
      }

      case "waitUntil": {
        var wc = this.condFn(node, "cond");
        if (!wc) {
          if (!f.s.warned) {
            this.log("Wait Until has an empty condition — this branch will wait forever.", "warn");
            f.s.warned = true;
          }
          return null;
        }
        return wc() ? "done" : null;
      }

      case "setVariable": {
        var vid = node.fields.varId;
        if (!vid) {
          this.log("Set Variable has no variable chosen — skipping.", "warn");
          return "done";
        }
        var val = this.slot(node, "value");
        this.vars[vid] = val === null ? 0 : val;
        return "done";
      }

      case "loop": {
        var count = this.slotNum(node, "count", null);
        if (count === null) return "back";                 // blank == forever
        var done = (f.loops[node.id] || 0) + 1;
        if (done < count) { f.loops[node.id] = done; return "back"; }
        f.loops[node.id] = 0;
        return "next";
      }

      case "if": {
        var t = BG.truthy(this.slot(node, "cond"));
        return [t ? "true" : "false", "either"];
      }

      case "splitGate":
        return ["a", "b"];

      case "mergeGate":
        return "out";

      default:
        this.log("Unknown node: " + node.type, "err");
        return null;
    }
  };

})(window.BG);
