/* Screens, save slots, and the run loop. */
window.BG = window.BG || {};
(function (BG) {
  "use strict";

  var SPEEDS = [0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  var S = {
    save: null,
    level: 1,
    world: null,
    interp: null,
    editor: null,
    running: false,
    paused: false,
    speed: 1,
    ctx: null,
    saveTimer: null
  };

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  // ── screens ───────────────────────────────────────────────────────────────
  function show(id) {
    document.querySelectorAll(".screen").forEach(function (s) {
      s.classList.toggle("on", s.id === id);
    });
  }

  /* The button swells and fades while the screen crosses over. */
  function burst(btn, then) {
    btn.classList.add("burst");
    var screen = btn.closest(".screen");
    if (screen) screen.classList.add("leaving");
    setTimeout(function () {
      btn.classList.remove("burst");
      if (screen) screen.classList.remove("leaving");
      then();
    }, 430);
  }

  // ── main menu ─────────────────────────────────────────────────────────────
  function initMenu() {
    $("#play-btn").addEventListener("click", function (e) {
      burst(e.currentTarget, function () { openSlots(); });
    });
    document.querySelectorAll("[data-back]").forEach(function (b) {
      b.addEventListener("click", function () { show(b.dataset.back); });
    });
  }

  // ── save slots ────────────────────────────────────────────────────────────
  function openSlots() {
    var list = $("#slot-list");
    list.innerHTML = "";

    if (!BG.Saves.available) {
      list.appendChild(el("p", "warn-note",
        "Your browser is blocking local storage, so progress cannot be saved. " +
        "You can still play — everything resets when you close the tab."));
    }

    var saves = BG.Saves.list();
    if (!saves.length) {
      list.appendChild(el("p", "empty-note", "No saves yet. Create one to begin."));
    }

    saves.forEach(function (sv) {
      var row = el("div", "slot");
      var main = el("button", "slot-main");

      var top = el("div", "slot-top");
      top.appendChild(el("span", "slot-name", sv.name));
      var mode = el("span", "slot-mode", sv.mode === "campaign" ? "Campaign" : "Infinite");
      mode.classList.add(sv.mode);
      top.appendChild(mode);
      main.appendChild(top);

      var sub = sv.mode === "campaign"
        ? "Level " + sv.level + " of " + BG.campaignLength()
        : (BG.INFINITE_TYPES[sv.infType] || { label: "Mazes" }).label + " · level " + sv.level;
      main.appendChild(el("div", "slot-sub", sub));

      main.addEventListener("click", function (e) {
        burst(e.currentTarget, function () { startGame(sv); });
      });

      var dl = el("button", "slot-icon");
      dl.title = "Download this save as a file";
      dl.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
        '<path d="M8 1.8 V9.8 M4.6 6.4 L8 9.8 L11.4 6.4 M2.6 13.4 H13.4" fill="none" ' +
        'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      dl.addEventListener("click", function (e) {
        e.stopPropagation();
        exportSave(sv);
      });

      var del = el("button", "slot-del", "×");
      del.title = "Delete save";
      del.addEventListener("click", function () {
        if (!confirm("Delete “" + sv.name + "” for good?")) return;
        BG.Saves.remove(sv.id);
        openSlots();
      });

      row.appendChild(main);
      row.appendChild(dl);
      row.appendChild(del);
      list.appendChild(row);
    });

    show("scr-slots");
  }

  // ── save files (for moving a save between computers) ─────────────────────
  function safeName(s) {
    return (s || "save").replace(/[^a-z0-9 _-]/gi, "").trim()
                        .replace(/[ ]+/g, "-").toLowerCase() || "save";
  }

  function exportSave(sv) {
    var payload = { app: "brokengems.trainai", ver: 1, exported: Date.now(), save: sv };
    var url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = safeName(sv.name) + ".bgsave.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function importSave(file) {
    var rd = new FileReader();
    rd.onerror = function () { alert("Could not read that file."); };
    rd.onload = function () {
      var data;
      try { data = JSON.parse(rd.result); }
      catch (e) { alert("That file is not valid JSON."); return; }

      var sv = data && data.save ? data.save : data;
      if (!sv || !sv.mode || !sv.graphs) {
        alert("That does not look like a Broken Gems save file.");
        return;
      }

      // always land as a new slot so an import can never clobber your progress
      var copy = BG.clone(sv);
      copy.id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      copy.updated = Date.now();
      var taken = BG.Saves.list().map(function (s) { return s.name; });
      if (taken.indexOf(copy.name) !== -1) copy.name = copy.name + " (imported)";

      if (!BG.Saves.save(copy)) {
        alert("Could not save — this browser is blocking local storage.");
        return;
      }
      openSlots();
    };
    rd.readAsText(file);
  }

  function initSlots() {
    var file = $("#import-file");
    $("#import-btn").addEventListener("click", function () {
      file.value = "";
      file.click();
    });
    file.addEventListener("change", function () {
      if (file.files && file.files[0]) importSave(file.files[0]);
    });
  }

  // ── new save ──────────────────────────────────────────────────────────────
  var draft = { mode: null, infType: null };

  function initNew() {
    $("#new-save-btn").addEventListener("click", function () {
      draft = { mode: null, infType: null };
      $("#save-name").value = "Save " + (BG.Saves.list().length + 1);
      paintDraft();
      show("scr-new");
    });

    document.querySelectorAll("[data-mode]").forEach(function (b) {
      b.addEventListener("click", function () {
        draft.mode = b.dataset.mode;
        if (draft.mode === "campaign") draft.infType = null;
        paintDraft();
      });
    });

    document.querySelectorAll("[data-inf]").forEach(function (b) {
      b.addEventListener("click", function () {
        draft.infType = b.dataset.inf;
        paintDraft();
      });
    });

    $("#create-btn").addEventListener("click", function (e) {
      if (!canCreate()) return;
      var sv = BG.Saves.create({
        name: $("#save-name").value.trim() || "Untitled",
        mode: draft.mode,
        section: "maze"
      });
      if (draft.mode === "infinite") {
        sv.infType = draft.infType;
        BG.Saves.save(sv);
      }
      burst(e.currentTarget, function () { startGame(sv); });
    });
  }

  function canCreate() {
    return draft.mode === "campaign" || (draft.mode === "infinite" && draft.infType);
  }

  function paintDraft() {
    document.querySelectorAll("[data-mode]").forEach(function (b) {
      b.classList.toggle("picked", b.dataset.mode === draft.mode);
    });
    document.querySelectorAll("[data-inf]").forEach(function (b) {
      b.classList.toggle("picked", b.dataset.inf === draft.infType);
    });
    $("#inf-types").classList.toggle("open", draft.mode === "infinite");
    $("#create-btn").disabled = !canCreate();
  }

  // ── gameplay ──────────────────────────────────────────────────────────────
  function startGame(sv) {
    S.save = sv;
    S.level = sv.level || 1;
    show("scr-play");
    loadLevel(true);
  }

  function loadLevel(freshGraph) {
    var cfg = BG.levelConfig(S.save, S.level);
    S.world = new BG.World(BG.buildLevel(cfg));

    $("#lvl-num").textContent = "Level " + S.level;
    $("#lvl-name").textContent = cfg.name;
    $("#lvl-ghosts").textContent = cfg.ghosts ? cfg.ghosts + (cfg.ghosts > 1 ? " monsters" : " monster") : "no monsters";
    $("#save-label").textContent = S.save.name;

    if (freshGraph) {
      if (S.editor) S.editor.destroy();
      var graph = BG.Saves.graphFor(S.save, S.level);
      S.editor = new BG.Editor($("#editor"), graph, { onChange: queueSave });
    }

    stopRun(true);
    setStatus("idle", "Ready. Build your code, then press Run.");
    clearLog();
    logLine("Level " + S.level + " — " + cfg.name + ". Reach the broken gem.", "info");
    fitCanvas();
  }

  function queueSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(function () {
      if (!S.save || !S.editor) return;
      BG.Saves.putGraph(S.save, S.level, S.editor.graph);
    }, 350);
  }

  // ── run controls ──────────────────────────────────────────────────────────
  function startRun() {
    if (S.running) {
      if (S.paused) resumeRun();
      return;
    }
    S.world.reset();
    S.interp = new BG.Interp(S.editor.graph, S.world, {
      onLog: function (m, k) { logLine(m, k); },
      onFinish: function (why) {
        if (why === "end" && !S.world.won && !S.world.failed) {
          setStatus("idle", "Code finished without reaching the gem.");
          logLine("Program ended. Nothing left to run.", "warn");
          endRun();
        }
      }
    });
    S.running = true;
    S.paused = false;
    S.editor.setLocked(true);
    paintControls();
    setStatus("run", "Running…");
    logLine("Run started.", "info");
  }

  function pauseRun() {
    if (!S.running) return;
    S.paused = true;
    paintControls();
    setStatus("idle", "Paused.");
  }

  function resumeRun() {
    S.paused = false;
    paintControls();
    setStatus("run", "Running…");
  }

  function endRun() {
    S.running = false;
    S.paused = false;
    S.editor.setLocked(false);
    S.editor.setActive([]);
    paintControls();
  }

  function stopRun(quiet) {
    var was = S.running;
    endRun();
    S.interp = null;
    S.world.reset();
    if (!quiet) {
      setStatus("idle", "Stopped. Back to the start.");
      if (was) logLine("Stopped by you.", "info");
    }
  }

  function paintControls() {
    $("#btn-run").textContent = S.running && !S.paused ? "Running" : "Run";
    $("#btn-run").disabled = S.running && !S.paused;
    $("#btn-pause").textContent = S.paused ? "Resume" : "Pause";
    $("#btn-pause").disabled = !S.running;
    $("#btn-stop").disabled = !S.running;
    $("#btn-reroll").disabled = S.running;
  }

  function setStatus(kind, msg) {
    var s = $("#status");
    s.className = "status " + kind;
    s.textContent = msg;
  }

  function clearLog() { $("#log").innerHTML = ""; }

  function logLine(msg, kind) {
    var log = $("#log");
    var line = el("div", "log-line " + (kind || "info"), msg);
    log.appendChild(line);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  // ── outcomes ──────────────────────────────────────────────────────────────
  function onCrash(reason) {
    endRun();
    S.interp = null;
    var msg = reason === "caught"
      ? "A monster caught you. Code stopped."
      : "You hit a wall. Code stopped.";
    setStatus("fail", msg);
    logLine(msg + " Back to the start — revise and run again.", "err");
    setTimeout(function () { if (!S.running) S.world.reset(); }, 700);
  }

  function onWin() {
    endRun();
    S.interp = null;

    var campaign = S.save.mode === "campaign";
    var last = campaign && S.level >= BG.campaignLength();

    S.save.cleared = Math.max(S.save.cleared || 0, S.level);
    BG.Saves.putGraph(S.save, S.level, S.editor.graph);

    if (last) {
      setStatus("win", "Campaign complete. Every gem collected.");
      logLine("Campaign complete.", "win");
    } else {
      setStatus("win", "Gem reached. Level " + S.level + " cleared.");
      logLine("Cleared. Press Next Level to continue.", "win");
    }
    $("#btn-next").hidden = last;
  }

  function nextLevel() {
    S.level += 1;
    S.save.level = S.level;
    BG.Saves.save(S.save);
    $("#btn-next").hidden = true;
    loadLevel(true);
  }

  // ── canvas + loop ─────────────────────────────────────────────────────────
  function fitCanvas() {
    var c = $("#view");
    var pane = c.parentElement;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = pane.clientWidth, h = pane.clientHeight;
    if (w <= 0 || h <= 0) return;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + "px";
    c.style.height = h + "px";
    S.ctx = c.getContext("2d");
    S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S.vw = w; S.vh = h;
  }

  var lastT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
    lastT = now;

    if (S.world) {
      if (S.running && !S.paused && S.interp) {
        var budget = dt * S.speed;
        var guard = 0;
        while (budget > 1e-6 && guard++ < 60) {
          var s = Math.min(budget, 1 / 60);
          S.interp.step(s);
          S.world.update(s);
          budget -= s;
          if (S.world.failed || S.world.won || !S.running) break;
        }
        if (S.editor) S.editor.setActive(S.interp ? S.interp.activeNodes() : []);

        if (S.world.failed) onCrash(S.world.failed);
        else if (S.world.won) onWin();
      } else {
        S.world.time += dt;                      // keep idle animation alive
      }

      if (S.ctx) S.world.render(S.ctx, S.vw, S.vh);
    }
  }

  // ── split resizer ─────────────────────────────────────────────────────────
  function initSplit() {
    var split = $("#split");
    var gutter = $("#gutter");
    var dragging = false;

    function setPct(pct) {
      pct = Math.max(18, Math.min(76, pct));
      split.style.setProperty("--view", pct + "%");
      try { localStorage.setItem("brokengems.split", String(pct)); } catch (e) {}
      fitCanvas();
    }

    try {
      var saved = parseFloat(localStorage.getItem("brokengems.split"));
      if (saved) split.style.setProperty("--view", saved + "%");
    } catch (e) {}

    gutter.addEventListener("pointerdown", function (e) {
      dragging = true;
      gutter.setPointerCapture(e.pointerId);
      gutter.classList.add("on");
      e.preventDefault();
    });
    gutter.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var r = split.getBoundingClientRect();
      setPct((r.right - e.clientX) / r.width * 100);
    });
    function stop() { dragging = false; gutter.classList.remove("on"); }
    gutter.addEventListener("pointerup", stop);
    gutter.addEventListener("pointercancel", stop);
    gutter.addEventListener("dblclick", function () { setPct(38); });

    window.addEventListener("resize", fitCanvas);
  }

  // ── play screen wiring ────────────────────────────────────────────────────
  function initPlay() {
    var sel = $("#speed");
    SPEEDS.forEach(function (s) {
      var o = el("option", null, s + "×");
      o.value = String(s);
      if (s === 1) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { S.speed = parseFloat(sel.value); });

    $("#btn-run").addEventListener("click", startRun);
    $("#btn-pause").addEventListener("click", function () {
      if (S.paused) resumeRun(); else pauseRun();
    });
    $("#btn-stop").addEventListener("click", function () { stopRun(false); });
    $("#btn-next").addEventListener("click", nextLevel);

    $("#btn-reroll").addEventListener("click", function () {
      if (S.running) return;
      loadLevel(false);
      logLine("New random layout, same difficulty.", "info");
    });

    $("#btn-quit").addEventListener("click", function () {
      if (S.editor) BG.Saves.putGraph(S.save, S.level, S.editor.graph);
      S.save.level = S.level;
      BG.Saves.save(S.save);
      stopRun(true);
      if (S.editor) { S.editor.destroy(); S.editor = null; }
      S.world = null;
      show("scr-menu");
    });
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    initMenu();
    initSlots();
    initNew();
    initPlay();
    initSplit();
    show("scr-menu");
    document.body.classList.add("ready");
    requestAnimationFrame(frame);
  });

})(window.BG);
