/* Boot, title screen, and the frame loop. */
(function (JC) {
  "use strict";

  var canvas, ui, game, last = 0, running = false;

  /* The physics is a Verlet integrator, and Verlet is only stable at a fixed
     step: each step carries a per-step displacement, so stepping more often
     simply moves everything further. Fed the raw frame delta, a 144Hz screen
     ran the truck well over twice as fast as a 60Hz one. Simulate in fixed
     1/60 slices and draw once per frame, whatever the refresh rate. */
  var FIXED = 1 / 60;
  var MAX_CATCHUP = 5;              // never simulate more than this per frame
  var acc = 0;

  function start(snapshot) {
    if (game) game.destroy();
    document.getElementById("title").classList.add("gone");
    document.getElementById("hud").classList.add("on");
    game = new JC.Game(canvas, ui, snapshot ? snapshot.seed : Math.floor(Math.random() * 1e9));
    if (snapshot) JC.Save.restore(game, snapshot);
    window.__G = game;
    ui.clear();
    acc = 0;
    last = 0;
    running = true;
  }

  JC.restart = function () { JC.Save.clearRun(); start(); };
  JC.currentGame = function () { return game; };

  function paintTitle() {
    var p = JC.Save.profile();
    var box = document.getElementById("profile");
    var cont = document.getElementById("continue");
    var any = p.runs > 0;
    box.hidden = !any;
    if (any) {
      document.getElementById("p-best").textContent = Math.round(p.bestDistance / 40) + "m";
      document.getElementById("p-legs").textContent = p.bestLeg;
      document.getElementById("p-kills").textContent = p.totalKills;
      document.getElementById("p-seen").textContent = JC.Save.seenCount();
    }
    var run = JC.Save.loadRun();
    cont.hidden = !run;
    if (run) {
      cont.textContent = "Continue — Leg " + (run.leg + 1) + ", " +
                         Math.round(run.distance / 40) + "m";
    }
    var note = document.getElementById("transfer-note");
    if (!JC.Save.available) {
      note.textContent = "This browser is blocking local storage, so nothing can be saved here.";
    }
  }
  JC.paintTitle = paintTitle;

  function loop(now) {
    requestAnimationFrame(loop);
    var dt = last ? Math.min((now - last) / 1000, 0.25) : 0;
    last = now;
    if (!game) return;
    // the canvas can be sized before the page is actually visible, so keep
    // checking rather than trusting one resize event
    if (canvas.clientWidth !== game.renderer.w || canvas.clientHeight !== game.renderer.h) {
      game.renderer.resize();
    }
    if (running && !game.paused && !game.over) {
      acc += dt;
      var steps = 0;
      while (acc >= FIXED && steps < MAX_CATCHUP) {
        game.update(FIXED);
        acc -= FIXED;
        steps++;
      }
      // too far behind to catch up; drop the backlog rather than spiral
      if (acc > FIXED * MAX_CATCHUP) acc = 0;
    } else {
      acc = 0;
    }
    game.draw();
    ui.update(game);
  }

  function fit() {
    if (game) game.renderer.resize();
  }

  document.addEventListener("DOMContentLoaded", function () {
    canvas = document.getElementById("view");
    ui = new JC.UI();

    document.getElementById("play").addEventListener("click", function () {
      JC.Save.clearRun();
      start();
    });
    document.getElementById("continue").addEventListener("click", function () {
      var run = JC.Save.loadRun();
      if (run) start(run);
    });

    document.getElementById("btn-export").addEventListener("click", function () {
      ui.showCode(JC.Save.exportAll(game));
    });
    document.getElementById("btn-import").addEventListener("click", function () {
      ui.showImport(function (code) {
        var r = JC.Save.importAll(code);
        if (r.ok) paintTitle();
        return r;
      });
    });
    document.getElementById("btn-wipe").addEventListener("click", function () {
      if (!confirm("Wipe your save and lifetime stats on this computer?")) return;
      JC.Save.clearRun();
      JC.Save.resetProfile();
      paintTitle();
    });

    paintTitle();

    document.getElementById("count-ab").textContent = JC.abilityTotal();
    document.getElementById("count-gear").textContent = JC.GEAR.length;
    document.getElementById("count-enemy").textContent = Object.keys(JC.ENEMIES).length;
    document.getElementById("count-biome").textContent = Object.keys(JC.BIOMES).length;

    // never lose a run to a closed tab
    window.addEventListener("beforeunload", function () {
      if (game && !game.over) JC.Save.saveRun(game);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && game && !game.over) JC.Save.saveRun(game);
    });

    window.addEventListener("resize", fit);
    window.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" && e.key !== "Tab") return;
      if (e.key === "Tab") e.preventDefault();      // never move focus mid-run
      if (!game || game.over || game.atStop) return;
      if (!document.getElementById("title").classList.contains("gone")) return;
      if (game.paused) { ui.clear(); game.paused = false; }
      else { game.paused = true; ui.showPause(game, function () { game.paused = false; }); }
    });

    requestAnimationFrame(loop);
  });

})(window.JC);
