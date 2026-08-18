/* HUD, card draft, cargo stop, and the menus. Plain DOM over the canvas. */
window.JC = window.JC || {};
(function (JC) {
  "use strict";

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function $(s) { return document.querySelector(s); }

  JC.UI = function () {
    this.hud = $("#hud");
    this.overlay = $("#overlay");
    this.game = null;
    this.build();
  };

  var U = JC.UI.prototype;

  U.build = function () {
    this.hud.innerHTML = "";

    // top progress bar
    var top = el("div", "hud-top");
    this.legLabel = el("div", "leg-label", "LEG 1");
    this.biomeLabel = el("div", "biome-label", "Plains");
    var barWrap = el("div", "prog-wrap");
    this.progFill = el("div", "prog-fill");
    barWrap.appendChild(this.progFill);
    for (var i = 1; i <= 4; i++) {
      var tick = el("div", "prog-tick");
      tick.style.left = (i * 25) + "%";
      barWrap.appendChild(tick);
    }
    this.stopIcon = el("div", "prog-stop", "⛽");
    barWrap.appendChild(this.stopIcon);
    top.appendChild(this.legLabel);
    top.appendChild(barWrap);
    top.appendChild(this.biomeLabel);
    this.hud.appendChild(top);

    // left bars
    var left = el("div", "hud-left");
    this.truckBar = this.makeBar(left, "TRUCK", "truck");
    this.cargoBar = this.makeBar(left, "CARGO", "cargo");
    this.shieldBar = this.makeBar(left, "SHIELD", "shield");
    this.fuelBar = this.makeBar(left, "BOOST", "fuel");
    this.hud.appendChild(left);

    // right readouts
    var right = el("div", "hud-right");
    this.goldEl = el("div", "stat-chip gold", "0");
    this.killEl = el("div", "stat-chip", "0 kills");
    this.distEl = el("div", "stat-chip", "0 m");
    right.appendChild(this.goldEl);
    right.appendChild(this.killEl);
    right.appendChild(this.distEl);
    this.hud.appendChild(right);

    // owned abilities
    this.abilityRow = el("div", "ability-row");
    this.hud.appendChild(this.abilityRow);

    this.hint = el("div", "hint", "↑ / W accelerate · ← → lean · hold LMB to fire");
    this.hud.appendChild(this.hint);
  };

  U.makeBar = function (parent, label, cls) {
    var row = el("div", "bar-row " + cls);
    row.appendChild(el("span", "bar-label", label));
    var track = el("div", "bar-track");
    var fill = el("div", "bar-fill");
    var txt = el("span", "bar-text", "");
    track.appendChild(fill);
    track.appendChild(txt);
    row.appendChild(track);
    parent.appendChild(row);
    return { row: row, fill: fill, text: txt };
  };

  // ── per-frame HUD ─────────────────────────────────────────────────────────
  U.update = function (G) {
    var s = G.stats;
    setBar(this.truckBar, G.truckHp, s.truckHp);
    setBar(this.cargoBar, G.cargoHp, s.cargoHp);
    setBar(this.shieldBar, G.shield, s.shieldMax);
    setBar(this.fuelBar, G.truck.fuel * 100, 100, G.truck.fuel >= 1 ? "READY" : "");
    this.shieldBar.row.style.display = s.shieldMax > 0 ? "" : "none";
    this.fuelBar.row.style.display =
      (G.abilities.has("thrusters") || G.abilities.has("afterburner")) ? "" : "none";

    this.goldEl.textContent = "⬤ " + G.gold;
    this.killEl.textContent = G.kills + " kills";
    this.distEl.textContent = Math.round(G.distance / 40) + " m";

    this.progFill.style.width = (G.legProgress() * 100) + "%";
    this.legLabel.textContent = "LEG " + (G.leg + 1);
    var b = JC.BIOMES[G.terrain.biomeAt(G.truck.pos().x)];
    this.biomeLabel.textContent = b ? b.name : "";

    this.paintAbilities(G);
  };

  function setBar(bar, v, max, override) {
    var p = max > 0 ? JC.clamp(v / max, 0, 1) : 0;
    bar.fill.style.width = (p * 100) + "%";
    bar.text.textContent = override !== undefined && override !== ""
      ? override : Math.max(0, Math.round(v)) + " / " + Math.round(max);
  }

  U.paintAbilities = function (G) {
    var ids = G.abilities.order;
    if (this._abSig === ids.length + ":" + ids.join(",") + JSON.stringify(G.abilities.owned)) {
      // still refresh cooldown rings
      var acts = G.abilities.actives();
      for (var i = 0; i < acts.length; i++) {
        var node = this.abilityRow.querySelector('[data-ab="' + acts[i].id + '"]');
        if (!node) continue;
        var cd = G.count["cd_" + acts[i].id] || 0;
        node.classList.toggle("cooling", cd > 0);
        node.style.setProperty("--cd", (1 - cd / acts[i].a.active.cd) * 100 + "%");
      }
      return;
    }
    this._abSig = ids.length + ":" + ids.join(",") + JSON.stringify(G.abilities.owned);
    this.abilityRow.innerHTML = "";
    for (var k = 0; k < ids.length; k++) {
      var a = JC.ABILITIES[ids[k]];
      var pip = el("div", "ab-pip el-" + a.el);
      pip.dataset.ab = a.id;
      pip.appendChild(el("span", "ab-name", a.name));
      pip.appendChild(el("span", "ab-lv", "L" + G.abilities.level(a.id)));
      if (a.active) pip.appendChild(el("span", "ab-key", a.active.key.toUpperCase()));
      pip.title = a.desc;
      this.abilityRow.appendChild(pip);
    }
  };

  // ── overlays ──────────────────────────────────────────────────────────────
  U.clear = function () {
    this.overlay.innerHTML = "";
    this.overlay.classList.remove("on");
  };

  U.panel = function (cls) {
    this.overlay.innerHTML = "";
    this.overlay.classList.add("on");
    var p = el("div", "panel " + (cls || ""));
    this.overlay.appendChild(p);
    return p;
  };

  // ── card draft ────────────────────────────────────────────────────────────
  U.showCards = function (cards, G) {
    var self = this;
    var p = this.panel("cards");
    p.appendChild(el("h2", "panel-title", "Pick One"));
    p.appendChild(el("p", "panel-sub", cardSubtitle(cards)));

    var row = el("div", "card-row");
    cards.forEach(function (c, i) {
      var card = el("button", "card " + cardClass(c));
      card.style.animationDelay = (i * 0.08) + "s";

      card.appendChild(el("div", "card-kind", cardKind(c)));
      card.appendChild(el("div", "card-name", cardName(c)));
      card.appendChild(el("div", "card-desc", cardDesc(c)));

      if (c.kind !== "stat") {
        var elname = JC.ELEMENTS[c.ab.el];
        var tag = el("div", "card-el", elname ? elname.name : "");
        if (elname) tag.style.background = elname.color;
        card.appendChild(tag);
      }

      card.addEventListener("click", function () {
        G.takeCard(c);
        self.clear();
      });
      row.appendChild(card);
    });
    p.appendChild(row);
  };

  function cardSubtitle(cards) {
    var up = cards.filter(function (c) { return c.kind === "upgrade"; }).length;
    if (up) return "Upgrade draw — sharpen what you already run.";
    return "New gear for the road ahead.";
  }
  function cardClass(c) {
    if (c.kind === "stat") return "stat";
    if (c.kind === "variant") return "variant el-" + c.ab.el;
    if (c.kind === "upgrade") return "upgrade el-" + c.ab.el;
    return "ability el-" + c.ab.el;
  }
  function cardKind(c) {
    return { stat: "Stat Upgrade", upgrade: "Ability Upgrade",
             variant: "Variant Unlocked", "new": "New Ability" }[c.kind];
  }
  function cardName(c) { return c.kind === "stat" ? c.stat.name : c.ab.name; }
  function cardDesc(c) {
    if (c.kind === "stat") return c.stat.desc + (c.n > 1 ? "  ×" + c.n : "");
    if (c.kind === "upgrade") return c.ab.desc + "  →  Level " + c.to;
    return c.ab.desc;
  }

  // ── cargo stop ────────────────────────────────────────────────────────────
  U.showStop = function (G) {
    var self = this;
    var sold = G.sellAll();
    var p = this.panel("stop");

    p.appendChild(el("h2", "panel-title", "Cargo Stop " + (G.leg + 1)));
    p.appendChild(el("p", "panel-sub",
      sold.count
        ? "Sold " + sold.count + " crates for " + sold.total + " gold."
        : "You arrived with nothing to sell."));

    var wallet = el("div", "wallet");
    function refreshWallet() { wallet.textContent = "⬤ " + G.gold; }
    refreshWallet();
    p.appendChild(wallet);

    // gear
    p.appendChild(el("h3", "sec-title", "Gear"));
    var grid = el("div", "shop-grid");
    G.shop.forEach(function (entry) {
      var item = el("button", "shop-item");
      item.style.borderColor = entry.grade.color;

      var head = el("div", "shop-head");
      var gname = el("span", "shop-grade", entry.grade.name);
      gname.style.color = entry.grade.color;
      head.appendChild(gname);
      head.appendChild(el("span", "shop-cost", "⬤ " + entry.cost));
      item.appendChild(head);

      item.appendChild(el("div", "shop-name", entry.gear.name));
      item.appendChild(el("div", "shop-text", entry.gear.text(entry.mul)));

      item.addEventListener("click", function () {
        if (entry.bought) return;
        if (!G.buyGear(entry)) { item.classList.add("nope"); setTimeout(function () { item.classList.remove("nope"); }, 350); return; }
        item.classList.add("bought");
        item.querySelector(".shop-cost").textContent = "OWNED";
        refreshWallet();
      });
      grid.appendChild(item);
    });
    p.appendChild(grid);

    // cargo
    p.appendChild(el("h3", "sec-title", "Load Cargo"));
    var crow = el("div", "cargo-row");
    var slots = el("div", "slot-note", "");
    function refreshSlots() {
      slots.textContent = G.truck.crates.length + " / " + G.stats.cargoSlots + " slots filled";
    }
    JC.cargoOffers(G.leg).forEach(function (offer) {
      var c = el("button", "cargo-item");
      c.style.borderColor = offer.def.color;
      var swatch = el("div", "cargo-swatch");
      swatch.style.background = offer.def.color;
      c.appendChild(swatch);
      c.appendChild(el("div", "cargo-name", offer.def.name));
      c.appendChild(el("div", "cargo-blurb", offer.def.blurb));
      c.appendChild(el("div", "cargo-cost", "⬤ " + offer.cost +
        "  ·  sells ~" + JC.sellPrice(offer.kind, G.leg + 1, G.stats.sellMul)));
      c.addEventListener("click", function () {
        if (!G.buyCargo(offer)) { c.classList.add("nope"); setTimeout(function () { c.classList.remove("nope"); }, 350); return; }
        refreshWallet(); refreshSlots();
      });
      crow.appendChild(c);
    });
    p.appendChild(crow);
    refreshSlots();
    p.appendChild(slots);

    var go = el("button", "big-btn", "Back On The Road →");
    go.addEventListener("click", function () {
      G.leaveStop();
      self.clear();
    });
    p.appendChild(go);
  };

  // ── game over ─────────────────────────────────────────────────────────────
  U.showGameOver = function (G) {
    var p = this.panel("over");
    p.appendChild(el("h2", "panel-title", "Run Over"));
    p.appendChild(el("p", "panel-sub", G.reason));

    var grid = el("div", "final-grid");
    [["Distance", Math.round(G.distance / 40) + " m"],
     ["Cargo Stops", String(G.leg)],
     ["Goblins", String(G.kills)],
     ["Gold", String(G.gold)],
     ["Abilities", String(G.abilities.count())],
     ["Gear", String(G.gear.filter(function (g) { return g.kind === "gear"; }).length)]
    ].forEach(function (r) {
      var cell = el("div", "final-cell");
      cell.appendChild(el("div", "final-v", r[1]));
      cell.appendChild(el("div", "final-k", r[0]));
      grid.appendChild(cell);
    });
    p.appendChild(grid);

    if (G.abilities.count()) {
      p.appendChild(el("h3", "sec-title", "Your Build"));
      var row = el("div", "build-row");
      G.abilities.order.forEach(function (id) {
        var a = JC.ABILITIES[id];
        var pip = el("div", "ab-pip el-" + a.el);
        pip.appendChild(el("span", "ab-name", a.name));
        pip.appendChild(el("span", "ab-lv", "L" + G.abilities.level(id)));
        row.appendChild(pip);
      });
      p.appendChild(row);
    }

    var again = el("button", "big-btn", "Run It Again");
    again.addEventListener("click", function () { window.JC.restart(); });
    p.appendChild(again);

    var home = el("a", "quiet-link", "← Broken Gems");
    home.href = "../";
    p.appendChild(home);
  };

  // ── save codes ────────────────────────────────────────────────────────────
  U.showCode = function (code) {
    var self = this;
    var p = this.panel("code");
    p.appendChild(el("h2", "panel-title", "Save Code"));
    p.appendChild(el("p", "panel-sub",
      "Copy this and paste it into Jelly Cargo on the other computer. It carries your run and your lifetime stats."));

    var box = el("textarea", "code-box");
    box.value = code;
    box.readOnly = true;
    p.appendChild(box);

    var row = el("div", "transfer");
    var copy = el("button", "mini-btn", "Copy To Clipboard");
    copy.addEventListener("click", function () {
      box.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      if (navigator.clipboard) navigator.clipboard.writeText(code).catch(function () {});
      copy.textContent = ok || navigator.clipboard ? "Copied" : "Select it and press Ctrl+C";
    });
    var close = el("button", "mini-btn", "Close");
    close.addEventListener("click", function () { self.clear(); });
    row.appendChild(copy);
    row.appendChild(close);
    p.appendChild(row);
  };

  U.showImport = function (apply) {
    var self = this;
    var p = this.panel("code");
    p.appendChild(el("h2", "panel-title", "Paste Save Code"));
    p.appendChild(el("p", "panel-sub", "This replaces whatever is saved in this browser."));

    var box = el("textarea", "code-box");
    box.placeholder = "Paste the code here…";
    p.appendChild(box);

    var msg = el("p", "panel-sub", "");
    p.appendChild(msg);

    var row = el("div", "transfer");
    var load = el("button", "mini-btn", "Load It");
    load.addEventListener("click", function () {
      var r = apply(box.value.trim());
      if (!r.ok) { msg.textContent = r.why; box.classList.add("nope"); return; }
      msg.textContent = "Loaded.";
      setTimeout(function () { self.clear(); }, 700);
    });
    var close = el("button", "mini-btn", "Cancel");
    close.addEventListener("click", function () { self.clear(); });
    row.appendChild(load);
    row.appendChild(close);
    p.appendChild(row);
    box.focus();
  };

  // ── pause ─────────────────────────────────────────────────────────────────
  U.showPause = function (G, resume) {
    var self = this;
    var p = this.panel("pause");
    p.appendChild(el("h2", "panel-title", "Paused"));
    var b = el("button", "big-btn", "Resume");
    b.addEventListener("click", function () { self.clear(); resume(); });
    p.appendChild(b);

    var save = el("button", "mini-btn", "Save & Quit To Title");
    save.style.margin = "14px auto 0";
    save.addEventListener("click", function () {
      JC.Save.saveRun(G);
      location.reload();
    });
    p.appendChild(save);
    var home = el("a", "quiet-link", "← Broken Gems");
    home.href = "../";
    p.appendChild(home);
  };

})(window.JC);
