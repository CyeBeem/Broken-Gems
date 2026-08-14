/* Node graph editor: pan/zoom canvas, palette, wires, slots, undo, clipboard. */
window.BG = window.BG || {};
(function (BG) {
  "use strict";

  var WOFF = 8000;          // svg is offset so negative world coords still draw
  var MINZ = 0.25, MAXZ = 2.0;
  var GRID = 28;

  // ── small dom helper ──────────────────────────────────────────────────────
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  // ── floating layers (kept outside the zoom transform) ─────────────────────
  var overlay = null;
  function closeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }
  document.addEventListener("pointerdown", function (e) {
    if (overlay && !overlay.contains(e.target) && !e.target.closest(".dd-btn")) closeOverlay();
  }, true);
  window.addEventListener("blur", closeOverlay);

  /* Searchable dropdown. `resolve` returns [{id,label}] each time it opens. */
  function openDropdown(anchor, resolve, current, onPick) {
    closeOverlay();
    var box = el("div", "float dd-pop");
    var search = el("input", "dd-search");
    search.placeholder = "Search…";
    var list = el("div", "dd-list");
    box.appendChild(search);
    box.appendChild(list);

    var opts = resolve();

    function paint() {
      var q = search.value.trim().toLowerCase();
      list.innerHTML = "";
      var shown = opts.filter(function (o) {
        return !q || o.label.toLowerCase().indexOf(q) !== -1;
      });
      if (!shown.length) list.appendChild(el("div", "dd-empty", "nothing matches"));
      shown.forEach(function (o) {
        var it = el("div", "dd-item" + (o.id === current ? " on" : ""), o.label);
        it.addEventListener("pointerdown", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          closeOverlay();
          onPick(o.id);
        });
        list.appendChild(it);
      });
    }

    search.addEventListener("input", paint);
    search.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeOverlay(); }
      if (e.key === "Enter") {
        var first = list.querySelector(".dd-item");
        if (first) first.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      }
      e.stopPropagation();
    });

    paint();
    document.body.appendChild(box);
    overlay = box;

    var r = anchor.getBoundingClientRect();
    box.style.left = Math.min(r.left, window.innerWidth - box.offsetWidth - 12) + "px";
    var below = r.bottom + 4;
    box.style.top = (below + box.offsetHeight > window.innerHeight
      ? Math.max(8, r.top - box.offsetHeight - 4) : below) + "px";
    search.focus();
  }

  function openMenu(x, y, items) {
    closeOverlay();
    var box = el("div", "float ctx-pop");
    items.forEach(function (it) {
      if (it.sep) { box.appendChild(el("div", "ctx-sep")); return; }
      var b = el("div", "ctx-item" + (it.disabled ? " off" : ""), it.label);
      if (!it.disabled) {
        b.addEventListener("pointerdown", function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          closeOverlay(); it.run();
        });
      }
      box.appendChild(b);
    });
    document.body.appendChild(box);
    overlay = box;
    box.style.left = Math.min(x, window.innerWidth - box.offsetWidth - 8) + "px";
    box.style.top = Math.min(y, window.innerHeight - box.offsetHeight - 8) + "px";
  }

  // ── editor ────────────────────────────────────────────────────────────────
  BG.Editor = function (root, graph, opts) {
    this.root = root;
    this.graph = graph;
    this.opts = opts || {};
    this.zoom = 1;
    this.pan = { x: 60, y: 40 };
    this.sel = {};                 // nodeId -> true
    this.past = [];
    this.future = [];
    this.clip = null;
    this.portEls = {};
    this.nodeEls = {};
    this.drag = null;
    this.locked = false;           // true while the program is running

    this.build();
    this.renderAll();
  };

  var P = BG.Editor.prototype;

  P.emit = function () { if (this.opts.onChange) this.opts.onChange(this.graph); };

  // ── skeleton ──────────────────────────────────────────────────────────────
  P.build = function () {
    var self = this;
    this.root.innerHTML = "";
    this.root.classList.add("ed");

    // palette
    this.pal = el("aside", "pal");
    this.root.appendChild(this.pal);

    // canvas
    this.canvas = el("div", "ed-canvas");
    this.world = el("div", "ed-world");
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "wires");
    this.svg.style.left = -WOFF + "px";
    this.svg.style.top = -WOFF + "px";
    this.svg.setAttribute("width", WOFF * 2);
    this.svg.setAttribute("height", WOFF * 2);
    this.nodeLayer = el("div", "ed-nodes");
    this.world.appendChild(this.svg);
    this.world.appendChild(this.nodeLayer);
    this.canvas.appendChild(this.world);
    this.marquee = el("div", "marquee");
    this.marquee.style.display = "none";
    this.canvas.appendChild(this.marquee);
    this.root.appendChild(this.canvas);

    this.buildPalette();
    this.wireCanvasEvents();
    this.applyTransform();

    this.keyHandler = function (e) { self.onKey(e); };
    document.addEventListener("keydown", this.keyHandler);
  };

  P.destroy = function () {
    document.removeEventListener("keydown", this.keyHandler);
    closeOverlay();
  };

  // ── palette ───────────────────────────────────────────────────────────────
  P.buildPalette = function () {
    var self = this;
    this.pal.innerHTML = "";

    var head = el("div", "pal-head");
    var title = el("span", "pal-title", "Nodes");
    var collapse = el("button", "pal-toggle");
    collapse.title = "Collapse";
    collapse.innerHTML = "&#9666;";
    collapse.addEventListener("click", function () {
      self.root.classList.toggle("pal-collapsed");
      collapse.innerHTML = self.root.classList.contains("pal-collapsed") ? "&#9656;" : "&#9666;";
    });
    head.appendChild(title);
    head.appendChild(collapse);
    this.pal.appendChild(head);

    var search = el("input", "pal-search");
    search.placeholder = "Search nodes…";
    this.pal.appendChild(search);

    this.palBody = el("div", "pal-body");
    this.pal.appendChild(this.palBody);

    search.addEventListener("input", function () { self.paintPalette(search.value); });
    this.paintPalette("");
  };

  P.paintPalette = function (query) {
    var self = this;
    var q = (query || "").trim().toLowerCase();
    this.palBody.innerHTML = "";

    BG.PALETTE.forEach(function (group) {
      var cat = BG.CATS[group.cat];
      var sec = el("section", "pal-sec cat-" + group.cat);
      var h = el("button", "pal-sec-head");
      var dot = el("span", "cat-dot");
      dot.style.background = cat.color;
      h.appendChild(dot);
      h.appendChild(el("span", "pal-sec-name", cat.label));
      var caret = el("span", "pal-caret", "–");
      h.appendChild(caret);
      var body = el("div", "pal-sec-body");

      h.addEventListener("click", function () {
        sec.classList.toggle("shut");
        caret.textContent = sec.classList.contains("shut") ? "+" : "–";
      });

      var count = 0;
      group.items.forEach(function (item) {
        if (item.kind === "newvar") {
          if (q) return;
          var b = el("button", "pal-action", "+ Create variable");
          b.addEventListener("click", function () {
            self.pushUndo();
            BG.newVar(self.graph);
            self.paintPalette("");
            self.renderAll();
            self.emit();
          });
          body.appendChild(b);
          count++;
          return;
        }

        if (item.kind === "vars") {
          if (!self.graph.vars.length) {
            if (!q) { body.appendChild(el("div", "pal-note", "No variables yet.")); count++; }
            return;
          }
          self.graph.vars.forEach(function (v) {
            if (q && v.name.toLowerCase().indexOf(q) === -1) return;
            body.appendChild(self.varChip(v));
            count++;
          });
          return;
        }

        if (item.kind === "expr") {
          if (q && item.label.toLowerCase().indexOf(q) === -1) return;
          var ex = el("div", "pal-item pal-expr");
          ex.draggable = true;
          ex.appendChild(el("span", "pal-item-name", item.label));
          ex.appendChild(el("span", "pal-item-sub", item.sub));
          ex.addEventListener("dragstart", function (e) {
            e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "expr", ex: item.ex }));
            e.dataTransfer.effectAllowed = "copy";
          });
          body.appendChild(ex);
          count++;
          return;
        }

        var def = BG.NODES[item.type];
        if (q && def.title.toLowerCase().indexOf(q) === -1) return;

        var it = el("div", "pal-item");
        it.draggable = true;
        it.appendChild(el("span", "pal-item-name", def.title));
        if (def.hint) it.title = def.hint;
        it.addEventListener("dragstart", function (e) {
          e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "node", type: item.type }));
          e.dataTransfer.effectAllowed = "copy";
        });
        it.addEventListener("dblclick", function () {
          self.pushUndo();
          var n = BG.addNode(self.graph, item.type,
                             (-self.pan.x + 200) / self.zoom, (-self.pan.y + 160) / self.zoom);
          self.renderAll();
          self.select(n.id);
          self.emit();
        });
        body.appendChild(it);
        count++;
      });

      if (!count) return;
      sec.appendChild(h);
      sec.appendChild(body);
      self.palBody.appendChild(sec);
    });
  };

  P.varChip = function (v) {
    var self = this;
    var chip = el("div", "pal-item pal-var");
    chip.draggable = true;

    var name = el("span", "pal-item-name", v.name);
    chip.appendChild(name);

    var del = el("button", "pal-x", "×");
    del.title = "Delete variable";
    chip.appendChild(del);

    chip.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "var", id: v.id }));
      e.dataTransfer.effectAllowed = "copy";
    });

    // click the name to rename it
    name.addEventListener("click", function (e) {
      e.stopPropagation();
      var inp = el("input", "pal-rename");
      inp.value = v.name;
      chip.replaceChild(inp, name);
      inp.focus();
      inp.select();
      var finish = function () {
        var nv = inp.value.trim();
        if (nv && nv !== v.name) {
          self.pushUndo();
          v.name = nv;
          self.emit();
        }
        self.paintPalette("");
        self.renderAll();
      };
      inp.addEventListener("blur", finish);
      inp.addEventListener("keydown", function (ev) {
        ev.stopPropagation();
        if (ev.key === "Enter") inp.blur();
        if (ev.key === "Escape") { inp.value = v.name; inp.blur(); }
      });
    });

    del.addEventListener("click", function (e) {
      e.stopPropagation();
      self.pushUndo();
      self.graph.vars = self.graph.vars.filter(function (x) { return x.id !== v.id; });
      self.scrubVar(v.id);
      self.paintPalette("");
      self.renderAll();
      self.emit();
    });

    return chip;
  };

  /* Remove every reference to a deleted variable. */
  P.scrubVar = function (id) {
    var g = this.graph;
    function walk(e) {
      if (!e || typeof e !== "object") return e;
      if (e.k === "var") return e.id === id ? null : e;
      if (e.k === "cmp" || e.k === "ar") { e.a = walk(e.a); e.b = walk(e.b); }
      if (e.k === "sense") e.d = walk(e.d);
      return e;
    }
    Object.keys(g.nodes).forEach(function (nid) {
      var n = g.nodes[nid];
      Object.keys(n.slots).forEach(function (s) { n.slots[s] = walk(n.slots[s]); });
      if (n.fields.varId === id) n.fields.varId = "";
    });
  };

  // ── transform ─────────────────────────────────────────────────────────────
  P.applyTransform = function () {
    this.world.style.transform =
      "translate(" + this.pan.x + "px," + this.pan.y + "px) scale(" + this.zoom + ")";
    // four layers: fine verticals, fine horizontals, then the same again coarse.
    // Every layer must get a square size or the grid reads as rectangles.
    var g = GRID * this.zoom;
    var G = g * 5;
    var fine = g + "px " + g + "px";
    var coarse = G + "px " + G + "px";
    this.canvas.style.backgroundSize = [fine, fine, coarse, coarse].join(", ");
    var at = this.pan.x + "px " + this.pan.y + "px";
    this.canvas.style.backgroundPosition = [at, at, at, at].join(", ");
  };

  P.toWorld = function (clientX, clientY) {
    var r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.pan.x) / this.zoom,
      y: (clientY - r.top - this.pan.y) / this.zoom
    };
  };

  // ── rendering ─────────────────────────────────────────────────────────────
  P.renderAll = function () {
    var self = this;
    this.nodeLayer.innerHTML = "";
    this.portEls = {};
    this.nodeEls = {};
    Object.keys(this.graph.nodes).forEach(function (id) { self.renderNode(self.graph.nodes[id]); });
    this.drawWires();
  };

  P.renderNode = function (n) {
    var self = this;
    var def = BG.NODES[n.type];
    var cat = BG.CATS[def.cat];

    var box = el("div", "node cat-" + def.cat + (this.sel[n.id] ? " sel" : ""));
    box.dataset.id = n.id;
    box.style.left = n.x + "px";
    box.style.top = n.y + "px";
    box.style.setProperty("--cat", cat.color);

    var head = el("div", "nhead");
    head.appendChild(el("span", "ntitle", def.title));
    if (def.locked) head.appendChild(el("span", "nlock", "fixed"));
    box.appendChild(head);

    // ports
    var ports = el("div", "nports");
    var left = el("div", "pcol pin");
    var right = el("div", "pcol pout");

    def.ins.forEach(function (p) {
      var row = el("div", "prow");
      var dot = el("span", "port in");
      dot.dataset.node = n.id; dot.dataset.port = p.id; dot.dataset.side = "in";
      row.appendChild(dot);
      row.appendChild(el("span", "plabel", p.label));
      left.appendChild(row);
      self.portEls[n.id + ":" + p.id] = dot;
    });

    def.outs.forEach(function (p) {
      var row = el("div", "prow");
      row.appendChild(el("span", "plabel", p.label));
      var dot = el("span", "port out");
      dot.dataset.node = n.id; dot.dataset.port = p.id; dot.dataset.side = "out";
      row.appendChild(dot);
      right.appendChild(row);
      self.portEls[n.id + ":" + p.id] = dot;
    });

    ports.appendChild(left);
    ports.appendChild(right);
    box.appendChild(ports);

    // fields
    if (def.fields.length) {
      var fields = el("div", "nfields");
      def.fields.forEach(function (f) {
        var row = el("div", "frow");
        if (f.label) row.appendChild(el("span", "flabel", f.label));

        if (f.k === "dd") {
          row.appendChild(self.makeDropdown(n, f));
        } else {
          row.appendChild(self.makeSlot(
            function () { return n.slots[f.id]; },
            function (v) { n.slots[f.id] = v; },
            f.ph || ""
          ));
        }
        fields.appendChild(row);
      });
      box.appendChild(fields);
    }

    if (def.hint) {
      var tip = el("div", "nhint", def.hint);
      box.appendChild(tip);
    }

    this.nodeLayer.appendChild(box);
    this.nodeEls[n.id] = box;
    return box;
  };

  P.makeDropdown = function (n, f) {
    var self = this;
    var btn = el("button", "dd-btn");

    function label() {
      if (f.options === "@vars") {
        return n.fields[f.id] ? BG.varName(self.graph, n.fields[f.id]) : "choose variable";
      }
      return n.fields[f.id] || f.def;
    }

    function paint() { btn.textContent = label(); btn.appendChild(el("span", "dd-caret", "▾")); }
    paint();

    btn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (self.locked) return;
      openDropdown(btn, function () {
        if (f.options === "@vars") {
          return self.graph.vars.map(function (v) { return { id: v.id, label: v.name }; });
        }
        return f.options.map(function (o) { return { id: o, label: o }; });
      }, n.fields[f.id], function (id) {
        self.pushUndo();
        n.fields[f.id] = id;
        paint();
        self.emit();
      });
    });
    return btn;
  };

  /* A value slot: plain text, a variable chip, or a nested math expression. */
  P.makeSlot = function (get, set, ph) {
    var self = this;
    var host = el("span", "slot-host");

    function commitExpr(v) {
      self.pushUndo();
      set(v);
      paint();
      self.emit();
    }

    function paint() {
      host.innerHTML = "";
      var v = get();

      if (v && v.k === "var") {
        var chip = el("span", "chip chip-var");
        chip.appendChild(el("span", "chip-name", BG.varName(self.graph, v.id)));
        var x = el("button", "chip-x", "×");
        x.addEventListener("click", function (e) { e.stopPropagation(); commitExpr(null); });
        chip.appendChild(x);
        host.appendChild(chip);

      } else if (v && (v.k === "sense" || v.k === "dist")) {
        var sens = el("span", "expr sense");
        var isSense = v.k === "sense";

        if (!isSense) sens.appendChild(el("span", "expr-word", "distance"));

        sens.appendChild(self.miniPick(BG.DIRS, function () { return get().dir; },
          function (id) { var c = get(); c.dir = id; set(c); }));

        if (isSense) {
          sens.appendChild(self.makeSlot(
            function () { return get().d; },
            function (nv) { var c = get(); c.d = nv; set(c); }, "units"));
          sens.appendChild(self.miniPick(BG.TARGETS, function () { return get().target; },
            function (id) { var c = get(); c.target = id; set(c); }));
        }

        var srm = el("button", "chip-x", "×");
        srm.addEventListener("click", function (e) { e.stopPropagation(); commitExpr(null); });
        sens.appendChild(srm);
        host.appendChild(sens);

      } else if (v && (v.k === "cmp" || v.k === "ar")) {
        var wrap = el("span", "expr");
        wrap.appendChild(self.makeSlot(
          function () { return get().a; },
          function (nv) { var c = get(); c.a = nv; set(c); }, "a"));

        var ops = v.k === "cmp" ? BG.CMP_OPS : BG.AR_OPS;
        var ob = el("button", "dd-btn dd-mini");
        var cur = ops.filter(function (o) { return o.id === get().op; })[0] || ops[0];
        ob.textContent = cur.id;
        ob.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        ob.addEventListener("click", function (e) {
          e.stopPropagation();
          if (self.locked) return;
          openDropdown(ob, function () {
            return ops.map(function (o) { return { id: o.id, label: o.id + "   " + o.label }; });
          }, get().op, function (id) {
            self.pushUndo();
            var c = get(); c.op = id; set(c);
            paint();
            self.emit();
          });
        });
        wrap.appendChild(ob);

        wrap.appendChild(self.makeSlot(
          function () { return get().b; },
          function (nv) { var c = get(); c.b = nv; set(c); }, "b"));

        var rm = el("button", "chip-x", "×");
        rm.addEventListener("click", function (e) { e.stopPropagation(); commitExpr(null); });
        wrap.appendChild(rm);
        host.appendChild(wrap);

      } else {
        var inp = el("input", "slot");
        inp.placeholder = ph;
        inp.value = v && v.k === "lit" ? v.v : "";
        inp.size = Math.max(4, inp.value.length || ph.length || 4);

        inp.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        inp.addEventListener("input", function () {
          set(inp.value === "" ? null : { k: "lit", v: inp.value });
          inp.size = Math.max(4, inp.value.length);
        });
        var before = inp.value;
        inp.addEventListener("focus", function () { before = inp.value; self.pushUndo(true); });
        inp.addEventListener("change", function () {
          if (inp.value !== before) { self.commitPending(); self.emit(); }
        });
        inp.addEventListener("blur", function () {
          if (inp.value !== before) { self.commitPending(); self.emit(); }
          else self.dropPending();
        });
        inp.addEventListener("keydown", function (e) { e.stopPropagation(); });
        host.appendChild(inp);
      }
    }

    host.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.stopPropagation();
      host.classList.add("drop");
    });
    host.addEventListener("dragleave", function () { host.classList.remove("drop"); });
    host.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      host.classList.remove("drop");
      var data = readDrag(e);
      if (!data) return;
      if (data.kind === "var")  commitExpr({ k: "var", id: data.id });
      if (data.kind === "expr") commitExpr(BG.emptyExpr(data.ex));
    });

    paint();
    return host;
  };

  /* Compact searchable dropdown used inside expression widgets. */
  P.miniPick = function (options, get, apply) {
    var self = this;
    var b = el("button", "dd-btn dd-mini");
    function paint() { b.textContent = get(); }
    paint();
    b.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      if (self.locked) return;
      openDropdown(b, function () {
        return options.map(function (o) { return { id: o, label: o }; });
      }, get(), function (id) {
        self.pushUndo();
        apply(id);
        paint();
        self.emit();
      });
    });
    return b;
  };

  function readDrag(e) {
    try { return JSON.parse(e.dataTransfer.getData("text/plain")); }
    catch (err) { return null; }
  }

  // ── wires ─────────────────────────────────────────────────────────────────
  P.portCenter = function (nodeId, port) {
    var dot = this.portEls[nodeId + ":" + port];
    var n = this.graph.nodes[nodeId];
    if (!dot || !n) return null;
    return {
      x: n.x + dot.offsetLeft + dot.offsetWidth / 2,
      y: n.y + dot.offsetTop + dot.offsetHeight / 2
    };
  };

  P.drawWires = function () {
    var self = this;
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    this.graph.wires.forEach(function (w) {
      var a = self.portCenter(w.from.n, w.from.p);
      var b = self.portCenter(w.to.n, w.to.p);
      if (!a || !b) return;
      var src = self.graph.nodes[w.from.n];
      var color = BG.CATS[BG.NODES[src.type].cat].color;
      self.svg.appendChild(self.wirePath(a, b, color, w.id,
        self.sel[w.from.n] || self.sel[w.to.n]));
    });

    if (this.drag && this.drag.kind === "wire") {
      var a2 = this.portCenter(this.drag.node, this.drag.port);
      if (a2) {
        var p = this.wirePath(this.drag.side === "out" ? a2 : this.drag.cur,
                              this.drag.side === "out" ? this.drag.cur : a2,
                              "#8a8a8a", null, true);
        p.setAttribute("stroke-dasharray", "5 4");
        this.svg.appendChild(p);
      }
    }
  };

  P.wirePath = function (a, b, color, id, hot) {
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    var dx = Math.max(34, Math.min(170, Math.abs(b.x - a.x) * 0.55));
    path.setAttribute("d",
      "M " + (a.x + WOFF) + " " + (a.y + WOFF) +
      " C " + (a.x + dx + WOFF) + " " + (a.y + WOFF) +
      ", " + (b.x - dx + WOFF) + " " + (b.y + WOFF) +
      ", " + (b.x + WOFF) + " " + (b.y + WOFF));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", hot ? 2.6 : 1.9);
    path.setAttribute("stroke-opacity", hot ? 1 : 0.68);
    path.setAttribute("stroke-linecap", "round");
    if (id) {
      path.setAttribute("class", "wire");
      path.dataset.id = id;
    }
    return path;
  };

  // ── selection ─────────────────────────────────────────────────────────────
  P.select = function (id, additive) {
    if (!additive) this.sel = {};
    if (id) this.sel[id] = true;
    this.paintSelection();
  };

  P.paintSelection = function () {
    var self = this;
    Object.keys(this.nodeEls).forEach(function (id) {
      self.nodeEls[id].classList.toggle("sel", !!self.sel[id]);
    });
    this.drawWires();
  };

  P.selectedIds = function () {
    var self = this;
    return Object.keys(this.sel).filter(function (id) { return self.graph.nodes[id]; });
  };

  // ── history ───────────────────────────────────────────────────────────────
  P.pushUndo = function (pending) {
    var snap = BG.clone(this.graph);
    if (pending) { this.pending = snap; return; }
    this.past.push(snap);
    if (this.past.length > 80) this.past.shift();
    this.future.length = 0;
    this.pending = null;
  };

  P.commitPending = function () {
    if (!this.pending) return;
    this.past.push(this.pending);
    if (this.past.length > 80) this.past.shift();
    this.future.length = 0;
    this.pending = null;
  };

  P.dropPending = function () { this.pending = null; };

  P.undo = function () {
    if (!this.past.length) return;
    this.future.push(BG.clone(this.graph));
    this.graph = this.past.pop();
    this.afterHistory();
  };

  P.redo = function () {
    if (!this.future.length) return;
    this.past.push(BG.clone(this.graph));
    this.graph = this.future.pop();
    this.afterHistory();
  };

  P.afterHistory = function () {
    var self = this;
    Object.keys(this.sel).forEach(function (id) {
      if (!self.graph.nodes[id]) delete self.sel[id];
    });
    this.paintPalette("");
    this.renderAll();
    this.emit();
  };

  // ── clipboard ─────────────────────────────────────────────────────────────
  P.copy = function () {
    var self = this;
    var ids = this.selectedIds().filter(function (id) {
      return !BG.NODES[self.graph.nodes[id].type].locked;
    });
    if (!ids.length) return;
    var set = {};
    ids.forEach(function (i) { set[i] = true; });
    this.clip = {
      nodes: ids.map(function (id) { return BG.clone(self.graph.nodes[id]); }),
      wires: this.graph.wires.filter(function (w) { return set[w.from.n] && set[w.to.n]; })
                             .map(function (w) { return BG.clone(w); })
    };
  };

  P.paste = function (at) {
    if (!this.clip || !this.clip.nodes.length) return;
    this.pushUndo();

    var g = this.graph, map = {};
    var minX = Math.min.apply(null, this.clip.nodes.map(function (n) { return n.x; }));
    var minY = Math.min.apply(null, this.clip.nodes.map(function (n) { return n.y; }));
    var dx = at ? at.x - minX : 34;
    var dy = at ? at.y - minY : 34;

    this.sel = {};
    this.clip.nodes.forEach(function (n) {
      var copy = BG.clone(n);
      copy.id = "n" + (g.seq++);
      copy.x = n.x + dx;
      copy.y = n.y + dy;
      map[n.id] = copy.id;
      g.nodes[copy.id] = copy;
    });
    this.clip.wires.forEach(function (w) {
      if (!map[w.from.n] || !map[w.to.n]) return;
      BG.connect(g, map[w.from.n], w.from.p, map[w.to.n], w.to.p);
    });

    var self = this;
    Object.keys(map).forEach(function (k) { self.sel[map[k]] = true; });
    this.renderAll();
    this.emit();
  };

  P.duplicate = function () {
    var keep = this.clip;
    this.copy();
    this.paste();
    this.clip = keep || this.clip;
  };

  P.deleteSelection = function () {
    var self = this;
    var ids = this.selectedIds().filter(function (id) {
      return !BG.NODES[self.graph.nodes[id].type].locked;
    });
    if (!ids.length) return;
    this.pushUndo();
    ids.forEach(function (id) {
      BG.deleteNode(self.graph, id);
      delete self.sel[id];
    });
    this.renderAll();
    this.emit();
  };

  // ── input ─────────────────────────────────────────────────────────────────
  P.onKey = function (e) {
    if (this.locked) return;
    if (!this.root.isConnected) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (!this.root.closest("body")) return;

    var mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
    if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault(); this.redo(); return;
    }
    if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); this.copy(); return; }
    if (mod && e.key.toLowerCase() === "x") { e.preventDefault(); this.copy(); this.deleteSelection(); return; }
    if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); this.paste(); return; }
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); this.duplicate(); return; }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      var self = this;
      Object.keys(this.graph.nodes).forEach(function (id) { self.sel[id] = true; });
      this.paintSelection();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.deleteSelection(); return; }
    if (e.key === "Escape") { closeOverlay(); this.drag = null; this.drawWires(); }
  };

  P.wireCanvasEvents = function () {
    var self = this;

    this.canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = self.canvas.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var wx = (mx - self.pan.x) / self.zoom, wy = (my - self.pan.y) / self.zoom;
      var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      self.zoom = Math.max(MINZ, Math.min(MAXZ, self.zoom * factor));
      self.pan.x = mx - wx * self.zoom;
      self.pan.y = my - wy * self.zoom;
      self.applyTransform();
    }, { passive: false });

    this.canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    this.canvas.addEventListener("pointerdown", function (e) {
      closeOverlay();
      var portEl = e.target.closest(".port");
      var nodeEl = e.target.closest(".node");

      // middle button pans, anywhere
      if (e.button === 1) {
        e.preventDefault();
        self.drag = { kind: "pan", sx: e.clientX, sy: e.clientY,
                      px: self.pan.x, py: self.pan.y };
        self.canvas.setPointerCapture(e.pointerId);
        self.canvas.classList.add("panning");
        return;
      }

      if (e.button === 2) {
        self.openContext(e, nodeEl);
        return;
      }

      if (e.button !== 0) return;

      if (portEl && !self.locked) {
        e.preventDefault();
        self.drag = {
          kind: "wire",
          node: portEl.dataset.node,
          port: portEl.dataset.port,
          side: portEl.dataset.side,
          cur: self.toWorld(e.clientX, e.clientY)
        };
        self.canvas.setPointerCapture(e.pointerId);
        return;
      }

      if (nodeEl) {
        var id = nodeEl.dataset.id;
        if (e.target.closest(".nfields") || e.target.closest(".dd-btn")) {
          if (!self.sel[id]) self.select(id, e.shiftKey);
          return;
        }
        if (!self.sel[id]) self.select(id, e.shiftKey);
        else if (e.shiftKey) { delete self.sel[id]; self.paintSelection(); return; }

        if (self.locked) return;
        e.preventDefault();
        var start = self.toWorld(e.clientX, e.clientY);
        self.drag = {
          kind: "node", sx: start.x, sy: start.y, moved: false,
          origins: self.selectedIds().map(function (nid) {
            return { id: nid, x: self.graph.nodes[nid].x, y: self.graph.nodes[nid].y };
          })
        };
        self.canvas.setPointerCapture(e.pointerId);
        return;
      }

      // empty canvas: marquee select
      if (!e.shiftKey) self.select(null);
      var w0 = self.toWorld(e.clientX, e.clientY);
      var r0 = self.canvas.getBoundingClientRect();
      self.drag = { kind: "marquee", wx: w0.x, wy: w0.y,
                    cx: e.clientX - r0.left, cy: e.clientY - r0.top, add: e.shiftKey };
      self.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener("pointermove", function (e) {
      var d = self.drag;
      if (!d) return;

      if (d.kind === "pan") {
        self.pan.x = d.px + (e.clientX - d.sx);
        self.pan.y = d.py + (e.clientY - d.sy);
        self.applyTransform();
        return;
      }

      if (d.kind === "wire") {
        d.cur = self.toWorld(e.clientX, e.clientY);
        self.drawWires();
        return;
      }

      if (d.kind === "node") {
        var p = self.toWorld(e.clientX, e.clientY);
        var dx = p.x - d.sx, dy = p.y - d.sy;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) > 2) { self.pushUndo(); d.moved = true; }
        d.origins.forEach(function (o) {
          var n = self.graph.nodes[o.id];
          if (!n) return;
          n.x = o.x + dx;
          n.y = o.y + dy;
          var box = self.nodeEls[o.id];
          if (box) { box.style.left = n.x + "px"; box.style.top = n.y + "px"; }
        });
        self.drawWires();
        return;
      }

      if (d.kind === "marquee") {
        var r = self.canvas.getBoundingClientRect();
        var cx = e.clientX - r.left, cy = e.clientY - r.top;
        var x = Math.min(cx, d.cx), y = Math.min(cy, d.cy);
        var w = Math.abs(cx - d.cx), h = Math.abs(cy - d.cy);
        self.marquee.style.display = "block";
        self.marquee.style.left = x + "px";
        self.marquee.style.top = y + "px";
        self.marquee.style.width = w + "px";
        self.marquee.style.height = h + "px";

        var p2 = self.toWorld(e.clientX, e.clientY);
        var x0 = Math.min(d.wx, p2.x), x1 = Math.max(d.wx, p2.x);
        var y0 = Math.min(d.wy, p2.y), y1 = Math.max(d.wy, p2.y);

        if (!d.add) self.sel = {};
        Object.keys(self.graph.nodes).forEach(function (id) {
          var n = self.graph.nodes[id];
          var box = self.nodeEls[id];
          if (!box) return;
          var nx1 = n.x + box.offsetWidth, ny1 = n.y + box.offsetHeight;
          if (n.x < x1 && nx1 > x0 && n.y < y1 && ny1 > y0) self.sel[id] = true;
        });
        self.paintSelection();
      }
    });

    function endDrag(e) {
      var d = self.drag;
      self.canvas.classList.remove("panning");
      self.marquee.style.display = "none";
      if (!d) return;

      if (d.kind === "wire") {
        var target = document.elementFromPoint(e.clientX, e.clientY);
        var portEl = target && target.closest ? target.closest(".port") : null;
        if (portEl && portEl.dataset.node !== d.node && portEl.dataset.side !== d.side) {
          self.pushUndo();
          if (d.side === "out") {
            BG.connect(self.graph, d.node, d.port, portEl.dataset.node, portEl.dataset.port);
          } else {
            BG.connect(self.graph, portEl.dataset.node, portEl.dataset.port, d.node, d.port);
          }
          self.emit();
        } else if (!portEl && d.side === "out") {
          // dropping an output on empty space clears that wire
          var had = self.graph.wires.some(function (w) {
            return w.from.n === d.node && w.from.p === d.port;
          });
          if (had) {
            self.pushUndo();
            self.graph.wires = self.graph.wires.filter(function (w) {
              return !(w.from.n === d.node && w.from.p === d.port);
            });
            self.emit();
          }
        }
      }

      self.drag = null;
      self.drawWires();
    }

    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", function () {
      self.drag = null;
      self.marquee.style.display = "none";
      self.canvas.classList.remove("panning");
      self.drawWires();
    });

    // palette drops
    this.canvas.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    this.canvas.addEventListener("drop", function (e) {
      e.preventDefault();
      if (self.locked) return;
      var data = readDrag(e);
      if (!data || data.kind !== "node") return;
      var p = self.toWorld(e.clientX, e.clientY);
      self.pushUndo();
      var n = BG.addNode(self.graph, data.type, Math.round(p.x) - 70, Math.round(p.y) - 24);
      self.renderAll();
      self.select(n.id);
      self.emit();
    });
  };

  P.openContext = function (e, nodeEl) {
    var self = this;
    var items = [];
    var at = this.toWorld(e.clientX, e.clientY);

    if (nodeEl) {
      var id = nodeEl.dataset.id;
      if (!this.sel[id]) this.select(id);
      var lockedNode = BG.NODES[this.graph.nodes[id].type].locked;
      items.push({ label: "Copy", disabled: lockedNode, run: function () { self.copy(); } });
      items.push({ label: "Duplicate", disabled: lockedNode, run: function () { self.duplicate(); } });
      items.push({ label: "Delete", disabled: lockedNode, run: function () { self.deleteSelection(); } });
      items.push({ sep: true });
      items.push({ label: "Disconnect wires", disabled: false, run: function () {
        self.pushUndo();
        var ids = self.selectedIds();
        self.graph.wires = self.graph.wires.filter(function (w) {
          return ids.indexOf(w.from.n) === -1 && ids.indexOf(w.to.n) === -1;
        });
        self.renderAll();
        self.emit();
      }});
    } else {
      items.push({ label: "Paste", disabled: !this.clip, run: function () { self.paste(at); } });
      items.push({ label: "Select all", run: function () {
        Object.keys(self.graph.nodes).forEach(function (i) { self.sel[i] = true; });
        self.paintSelection();
      }});
      items.push({ sep: true });
      items.push({ label: "Reset view", run: function () {
        self.zoom = 1; self.pan = { x: 60, y: 40 }; self.applyTransform();
      }});
    }
    openMenu(e.clientX, e.clientY, items);
  };

  // ── run-time highlight ────────────────────────────────────────────────────
  P.setActive = function (ids) {
    var set = {};
    (ids || []).forEach(function (i) { set[i] = true; });
    var self = this;
    Object.keys(this.nodeEls).forEach(function (id) {
      self.nodeEls[id].classList.toggle("running", !!set[id]);
    });
  };

  P.setLocked = function (on) {
    this.locked = on;
    this.root.classList.toggle("locked", on);
  };

})(window.BG);
