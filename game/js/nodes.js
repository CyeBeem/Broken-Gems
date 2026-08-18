/* Node type registry + graph helpers for "Create an Algorithm To Solve Puzzles". */
window.BG = window.BG || {};
(function (BG) {
  "use strict";

  // ── categories (drive the coloured outlines) ──────────────────────────────
  BG.CATS = {
    core:      { label: "Core",      color: "#cfcfcf" },
    movement:  { label: "Movement",  color: "#5b8dd9" },
    sensing:   { label: "Sensing",   color: "#3fb0a0" },
    control:   { label: "Control",   color: "#9b7bd4" },
    gates:     { label: "Gates",     color: "#d1854a" },
    variables: { label: "Variables", color: "#68ac6b" },
    math:      { label: "Math",      color: "#d0b155" }
  };

  var DIRS    = ["front", "back", "left", "right"];
  var TARGETS = ["wall", "enemy", "goal", "air"];
  BG.DIRS = DIRS;
  BG.TARGETS = TARGETS;

  /* Field kinds:
       dd   - dropdown (searchable)
       slot - value slot; accepts typed text, a dragged variable, or a math node  */
  BG.NODES = {
    start: {
      cat: "core", title: "Start", locked: true, unique: true,
      hint: "Runs first. Cannot be deleted.",
      ins: [], outs: [{ id: "next", label: "next" }], fields: []
    },

    while: {
      cat: "control", title: "While", standalone: true,
      hint: "Wire 'while' to any node. The 'do' chain repeats for as long as that node is still running.",
      ins: [], outs: [{ id: "while", label: "while" }, { id: "do", label: "do" }], fields: []
    },

    move: {
      cat: "movement", title: "Move",
      hint: "Moves relative to the way you are facing. 1 = one tile.",
      ins: [{ id: "in", label: "in" }], outs: [{ id: "done", label: "done" }],
      fields: [
        { k: "dd", id: "dir", options: DIRS, def: "front" },
        { k: "slot", id: "amount", label: "amount", ph: "tiles" }
      ]
    },

    moveUntil: {
      cat: "movement", title: "Move Until",
      hint: "Keeps moving until the condition is true. Leave it blank to move forever.",
      ins: [{ id: "in", label: "in" }], outs: [{ id: "done", label: "done" }],
      fields: [
        { k: "dd", id: "dir", options: DIRS, def: "front" },
        { k: "slot", id: "cond", label: "until", ph: "condition" }
      ]
    },

    turn: {
      cat: "movement", title: "Turn",
      hint: "Rotates you. Positive degrees turn right.",
      ins: [{ id: "in", label: "in" }], outs: [{ id: "done", label: "done" }],
      fields: [{ k: "slot", id: "deg", label: "degrees", ph: "90" }]
    },

    turnUntil: {
      cat: "movement", title: "Turn Until",
      hint: "Keeps turning until the condition is true. Blank turns forever.",
      ins: [{ id: "in", label: "in" }], outs: [{ id: "done", label: "done" }],
      fields: [{ k: "slot", id: "cond", label: "until", ph: "condition" }]
    },

    raycast: {
      cat: "sensing", title: "Raycast",
      hint: "Scans tile by tile. 1 = the tile you are about to step into. 'Detects' is the side of the beam that looks for the target; leave it matching 'fire' to look straight ahead.",
      ins: [{ id: "in", label: "in" }],
      outs: [{ id: "yes", label: "yes" }, { id: "no", label: "no" }, { id: "either", label: "either" }],
      fields: [
        { k: "dd", id: "dir", options: DIRS, def: "front" },
        { k: "slot", id: "dist", label: "distance", ph: "tiles" },
        { k: "dd", id: "target", options: TARGETS, def: "wall", label: "looking for" },
        { k: "dd", id: "detect", options: DIRS, def: "front", label: "detects" }
      ]
    },

    raycastAt: {
      cat: "sensing", title: "Raycast At Raycast",
      hint: "Fires one beam, then fires a second from wherever the first came to rest. Bends a scan around a corner.",
      ins: [{ id: "in", label: "in" }],
      outs: [{ id: "yes", label: "yes" }, { id: "no", label: "no" }, { id: "either", label: "either" }],
      fields: [
        { k: "head", label: "beam 1" },
        { k: "dd", id: "detect1", options: DIRS, def: "front", label: "detects" },
        { k: "dd", id: "dir1", options: DIRS, def: "front", label: "fire" },
        { k: "slot", id: "dist1", label: "distance", ph: "tiles" },
        { k: "toggle", id: "stop1", def: true, label: "stop at target" },
        { k: "dd", id: "target1", options: TARGETS, def: "wall", label: "looking for" },
        { k: "head", label: "beam 2" },
        { k: "slot", id: "dist2", label: "distance", ph: "tiles" },
        { k: "dd", id: "dir2", options: DIRS, def: "left", label: "fire" },
        { k: "dd", id: "target2", options: TARGETS, def: "goal", label: "looking for" }
      ]
    },

    wait: {
      cat: "control", title: "Wait",
      hint: "Pauses this branch. Scales with the speed multiplier.",
      ins: [{ id: "in", label: "in" }], outs: [{ id: "done", label: "done" }],
      fields: [{ k: "slot", id: "secs", label: "seconds", ph: "1" }]
    },

    waitUntil: {
      cat: "control", title: "Wait Until",
      hint: "Holds this branch until the condition turns true. Blank waits forever.",
      ins: [{ id: "in", label: "in" }], outs: [{ id: "done", label: "done" }],
      fields: [{ k: "slot", id: "cond", label: "until", ph: "condition" }]
    },

    setVariable: {
      cat: "variables", title: "Set Variable",
      hint: "Stores a value in a variable.",
      ins: [{ id: "in", label: "in" }], outs: [{ id: "done", label: "done" }],
      fields: [
        { k: "dd", id: "varId", options: "@vars", def: "" },
        { k: "slot", id: "value", label: "to", ph: "value" }
      ]
    },

    loop: {
      cat: "control", title: "Loop",
      hint: "Sends flow back to whatever 'loop back to' points at. Leave the count blank to loop forever.",
      ins: [{ id: "in", label: "in" }],
      outs: [{ id: "back", label: "loop back to" }, { id: "next", label: "next" }],
      fields: [{ k: "slot", id: "count", label: "times", ph: "forever" }]
    },

    if: {
      cat: "control", title: "If",
      hint: "Checks a condition once and branches.",
      ins: [{ id: "in", label: "in" }],
      outs: [{ id: "true", label: "true" }, { id: "false", label: "false" }, { id: "either", label: "either" }],
      fields: [{ k: "slot", id: "cond", label: "condition", ph: "condition" }]
    },

    splitGate: {
      cat: "gates", title: "Split Gate",
      hint: "One in, two out. Both branches fire at once.",
      ins: [{ id: "in", label: "in" }],
      outs: [{ id: "a", label: "out A" }, { id: "b", label: "out B" }], fields: []
    },

    mergeGate: {
      cat: "gates", title: "Merge Gate",
      hint: "Either input fires the single output.",
      ins: [{ id: "a", label: "in A" }, { id: "b", label: "in B" }],
      outs: [{ id: "out", label: "out" }], fields: []
    }
  };

  // Math ops live in slots, never on the canvas.
  BG.CMP_OPS = [
    { id: ">",  label: "greater than" },
    { id: ">=", label: "greater than or equal to" },
    { id: "<",  label: "less than" },
    { id: "<=", label: "less than or equal to" },
    { id: "==", label: "equal to" }
  ];

  BG.AR_OPS = [
    { id: "+", label: "plus" },
    { id: "-", label: "minus" },
    { id: "*", label: "multiply" },
    { id: "/", label: "divide" }
  ];

  // What shows up in the palette, in order.
  BG.PALETTE = [
    { cat: "movement", items: [
      { kind: "node", type: "move" },
      { kind: "node", type: "moveUntil" },
      { kind: "node", type: "turn" },
      { kind: "node", type: "turnUntil" }
    ]},
    { cat: "sensing", items: [
      { kind: "node", type: "raycast" },
      { kind: "node", type: "raycastAt" },
      { kind: "expr", ex: "sense", label: "Sense", sub: "true / false" },
      { kind: "expr", ex: "dist",  label: "Distance", sub: "open tiles" }
    ]},
    { cat: "control", items: [
      { kind: "node", type: "while" },
      { kind: "node", type: "loop" },
      { kind: "node", type: "if" },
      { kind: "node", type: "wait" },
      { kind: "node", type: "waitUntil" }
    ]},
    { cat: "gates", items: [
      { kind: "node", type: "splitGate" },
      { kind: "node", type: "mergeGate" }
    ]},
    { cat: "variables", items: [
      { kind: "newvar" },
      { kind: "node", type: "setVariable" },
      { kind: "vars" }
    ]},
    { cat: "math", items: [
      { kind: "expr", ex: "cmp", label: "Compare", sub: "a  ▾  b" },
      { kind: "expr", ex: "ar",  label: "Arithmetic", sub: "a  ▾  b" }
    ]}
  ];

  // ── graph construction ────────────────────────────────────────────────────
  BG.newGraph = function () {
    return {
      seq: 2,
      nodes: { n1: BG.makeNode("start", "n1", 140, 220) },
      wires: [],
      vars: []
    };
  };

  BG.makeNode = function (type, id, x, y) {
    var def = BG.NODES[type];
    var n = { id: id, type: type, x: x, y: y, fields: {}, slots: {} };
    (def.fields || []).forEach(function (f) {
      if (f.k === "dd") n.fields[f.id] = f.def || "";
      else if (f.k === "toggle") n.fields[f.id] = !!f.def;
      else if (f.k === "slot") n.slots[f.id] = null;               // null == empty slot
    });
    return n;
  };

  BG.addNode = function (g, type, x, y) {
    var id = "n" + (g.seq++);
    g.nodes[id] = BG.makeNode(type, id, x, y);
    return g.nodes[id];
  };

  BG.deleteNode = function (g, id) {
    if (!g.nodes[id] || BG.NODES[g.nodes[id].type].locked) return false;
    delete g.nodes[id];
    g.wires = g.wires.filter(function (w) { return w.from.n !== id && w.to.n !== id; });
    return true;
  };

  /* Every port takes as many wires as you like, in or out. Only an exact
     duplicate of an existing wire is refused. */
  BG.connect = function (g, fromNode, fromPort, toNode, toPort) {
    if (fromNode === toNode) return null;
    var dup = g.wires.some(function (w) {
      return w.from.n === fromNode && w.from.p === fromPort &&
             w.to.n === toNode && w.to.p === toPort;
    });
    if (dup) return null;
    var w = { id: "w" + (g.seq++), from: { n: fromNode, p: fromPort }, to: { n: toNode, p: toPort } };
    g.wires.push(w);
    return w;
  };

  BG.newVar = function (g, name) {
    var id = "v" + (g.seq++);
    if (!name) {
      var i = 1;
      while (g.vars.some(function (v) { return v.name === "var" + i; })) i++;
      name = "var" + i;
    }
    g.vars.push({ id: id, name: name });
    return g.vars[g.vars.length - 1];
  };

  BG.varName = function (g, id) {
    var v = g.vars.filter(function (v) { return v.id === id; })[0];
    return v ? v.name : "?";
  };

  BG.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  // ── expression values ─────────────────────────────────────────────────────
  BG.emptyExpr = function (kind) {
    if (kind === "cmp")   return { k: "cmp", op: ">", a: null, b: null };
    if (kind === "ar")    return { k: "ar",  op: "+", a: null, b: null };
    if (kind === "sense") return { k: "sense", dir: "front", d: { k: "lit", v: "1" }, target: "wall", detect: "front" };
    if (kind === "dist")  return { k: "dist", dir: "front" };
    return null;
  };

  BG.exprIsEmpty = function (e) {
    return e === null || e === undefined || (e.k === "lit" && String(e.v).trim() === "");
  };

  /* Evaluates a slot against the running machine state.
     Returns a number, a boolean, or null when the slot is empty. */
  BG.evalExpr = function (e, ctx) {
    if (BG.exprIsEmpty(e)) return null;

    if (e.k === "lit") {
      var s = String(e.v).trim();
      if (s === "true")  return true;
      if (s === "false") return false;
      var n = parseFloat(s);
      return isNaN(n) ? s : n;
    }

    if (e.k === "var") return ctx.getVar(e.id);

    /* Sensors read the live world, so conditions can actually mean something. */
    if (e.k === "sense") {
      if (!ctx.world) return false;
      var dv = BG.evalExpr(e.d, ctx);
      var tiles = dv === null ? null
        : Math.abs(typeof dv === "number" ? dv : parseFloat(dv) || 0) * BG.UNIT;
      return ctx.world.rayAnswer(e.dir, tiles, e.target, e.detect);
    }

    /* How many tiles you can actually move before hitting something —
       so `move front [distance front]` walks right up to the wall. */
    if (e.k === "dist") {
      if (!ctx.world) return 0;
      var h = ctx.world.raycast(e.dir, null);
      return h.type ? h.dist - 1 : h.dist;
    }

    var a = BG.evalExpr(e.a, ctx);
    var b = BG.evalExpr(e.b, ctx);
    var na = typeof a === "number" ? a : parseFloat(a) || 0;
    var nb = typeof b === "number" ? b : parseFloat(b) || 0;

    if (e.k === "ar") {
      if (e.op === "+") return na + nb;
      if (e.op === "-") return na - nb;
      if (e.op === "*") return na * nb;
      return nb === 0 ? 0 : na / nb;
    }

    if (e.k === "cmp") {
      if (e.op === "==") return a === b || na === nb;
      if (e.op === ">")  return na >  nb;
      if (e.op === ">=") return na >= nb;
      if (e.op === "<")  return na <  nb;
      return na <= nb;
    }
    return null;
  };

  BG.truthy = function (v) {
    if (v === null || v === undefined) return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    return String(v).trim() !== "" && String(v) !== "false";
  };

})(window.BG);
