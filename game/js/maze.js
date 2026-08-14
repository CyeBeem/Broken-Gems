/* Level templates + random maze generation.
   Grid is a tile map: 1 = wall, 0 = floor. Odd dimensions.        */
window.BG = window.BG || {};
(function (BG) {
  "use strict";

  /* Campaign ramp. `cells` is the maze size in cells; the tile grid
     ends up (cells*2+1) square. Difficulty per level is fixed, the
     layout itself is rerolled every attempt.                        */
  BG.LEVELS = [
    { n: 1,  kind: "corridor", turns: 1,  len: 5,  ghosts: 0, name: "One Turn" },
    { n: 2,  kind: "corridor", turns: 2,  len: 5,  ghosts: 0, name: "Two Turns" },
    { n: 3,  kind: "corridor", turns: 4,  len: 4,  ghosts: 0, name: "Switchback" },
    { n: 4,  kind: "maze", cells: 3, braid: 0.75, ghosts: 0, name: "First Maze" },
    { n: 5,  kind: "maze", cells: 4, braid: 0.55, ghosts: 0, name: "Small Maze" },
    { n: 6,  kind: "maze", cells: 5, braid: 0.45, ghosts: 0, name: "Wider" },
    { n: 7,  kind: "maze", cells: 5, braid: 0.30, ghosts: 0, name: "Dead Ends" },
    { n: 8,  kind: "maze", cells: 6, braid: 0.25, ghosts: 1, name: "Something Moved" },
    { n: 9,  kind: "maze", cells: 6, braid: 0.15, ghosts: 2, name: "Hunted" },
    { n: 10, kind: "maze", cells: 7, braid: 0.10, ghosts: 3, name: "The Gauntlet" }
  ];

  /* Infinite mode: pick a flavour, then it scales without end. */
  BG.INFINITE_TYPES = {
    corridors: {
      label: "Corridors",
      desc: "Twisting hallways. No monsters, ever. Pure pathing practice.",
      at: function (i) {
        return { kind: "corridor", turns: Math.min(2 + i, 14), len: 4, ghosts: 0,
                 name: "Corridor " + (i + 1) };
      }
    },
    mazes: {
      label: "Mazes",
      desc: "Mazes that keep growing. Still no monsters.",
      at: function (i) {
        return { kind: "maze", cells: Math.min(3 + Math.floor(i / 2), 12),
                 braid: Math.max(0.05, 0.7 - i * 0.06), ghosts: 0,
                 name: "Maze " + (i + 1) };
      }
    },
    hunted: {
      label: "Hunted",
      desc: "Mazes with monsters from the very first level. They only multiply.",
      at: function (i) {
        return { kind: "maze", cells: Math.min(4 + Math.floor(i / 2), 12),
                 braid: Math.max(0.05, 0.5 - i * 0.05),
                 ghosts: Math.min(1 + Math.floor(i / 2), 8),
                 name: "Hunt " + (i + 1) };
      }
    }
  };

  BG.levelConfig = function (save, level) {
    if (save.mode === "infinite") {
      var t = BG.INFINITE_TYPES[save.infType] || BG.INFINITE_TYPES.mazes;
      return t.at(level - 1);
    }
    return BG.LEVELS[Math.min(level, BG.LEVELS.length) - 1];
  };

  BG.campaignLength = function () { return BG.LEVELS.length; };

  // ── rng ───────────────────────────────────────────────────────────────────
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function blank(w, h) {
    var g = [];
    for (var y = 0; y < h; y++) {
      g.push([]);
      for (var x = 0; x < w; x++) g[y].push(1);
    }
    return g;
  }

  // ── corridor levels ───────────────────────────────────────────────────────
  /* A single snaking passage: `turns` corners, each leg `len` cells long.
     Carved into a grid sized to fit whatever it drew.                       */
  function buildCorridor(cfg) {
    var path = [{ x: 0, y: 0 }];
    var dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    var d = 0;                                        // start heading +x
    var cur = { x: 0, y: 0 };
    var used = { "0,0": true };

    for (var leg = 0; leg <= cfg.turns; leg++) {
      var legLen = cfg.len + Math.floor(Math.random() * 3) - 1;
      if (legLen < 2) legLen = 2;

      // pick a direction that doesn't reverse and doesn't re-cross the path
      if (leg > 0) {
        var opts = shuffle([0, 1, 2, 3]).filter(function (nd) {
          if ((nd + 2) % 4 === d || nd === d) return false;
          return !used[(cur.x + dirs[nd][0]) + "," + (cur.y + dirs[nd][1])];
        });
        if (!opts.length) break;
        d = opts[0];
      }

      for (var s = 0; s < legLen; s++) {
        var nx = cur.x + dirs[d][0], ny = cur.y + dirs[d][1];
        if (used[nx + "," + ny]) break;
        cur = { x: nx, y: ny };
        used[cur.x + "," + cur.y] = true;
        path.push({ x: cur.x, y: cur.y });
      }
    }

    // normalise to positive coords
    var minX = Math.min.apply(null, path.map(function (p) { return p.x; }));
    var minY = Math.min.apply(null, path.map(function (p) { return p.y; }));
    var maxX = Math.max.apply(null, path.map(function (p) { return p.x; }));
    var maxY = Math.max.apply(null, path.map(function (p) { return p.y; }));

    var cw = maxX - minX + 1, ch = maxY - minY + 1;
    var grid = blank(cw * 2 + 1, ch * 2 + 1);

    for (var i = 0; i < path.length; i++) {
      var cx = (path[i].x - minX) * 2 + 1;
      var cy = (path[i].y - minY) * 2 + 1;
      grid[cy][cx] = 0;
      if (i > 0) {                                  // knock out the wall between
        var px = (path[i - 1].x - minX) * 2 + 1;
        var py = (path[i - 1].y - minY) * 2 + 1;
        grid[(cy + py) / 2][(cx + px) / 2] = 0;
      }
    }

    var s0 = path[0], e0 = path[path.length - 1];
    return {
      grid: grid,
      start: { x: (s0.x - minX) * 2 + 1, y: (s0.y - minY) * 2 + 1 },
      goal:  { x: (e0.x - minX) * 2 + 1, y: (e0.y - minY) * 2 + 1 },
      facing: 0
    };
  }

  // ── maze levels ───────────────────────────────────────────────────────────
  /* Recursive backtracker, then "braid" away some dead ends so easier
     levels have fewer traps.                                            */
  function buildMaze(cfg) {
    var C = cfg.cells;
    var grid = blank(C * 2 + 1, C * 2 + 1);
    var seen = [];
    for (var y = 0; y < C; y++) { seen.push([]); for (var x = 0; x < C; x++) seen[y].push(false); }

    var stack = [{ x: 0, y: 0 }];
    seen[0][0] = true;
    grid[1][1] = 0;

    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    while (stack.length) {
      var c = stack[stack.length - 1];
      var next = shuffle(D.slice()).map(function (d) {
        return { x: c.x + d[0], y: c.y + d[1] };
      }).filter(function (p) {
        return p.x >= 0 && p.y >= 0 && p.x < C && p.y < C && !seen[p.y][p.x];
      })[0];

      if (!next) { stack.pop(); continue; }

      seen[next.y][next.x] = true;
      grid[next.y * 2 + 1][next.x * 2 + 1] = 0;
      grid[c.y + next.y + 1][c.x + next.x + 1] = 0;    // shared wall
      stack.push(next);
    }

    // braid: remove dead ends with probability cfg.braid
    for (var yy = 0; yy < C; yy++) {
      for (var xx = 0; xx < C; xx++) {
        if (Math.random() > cfg.braid) continue;
        var tx = xx * 2 + 1, ty = yy * 2 + 1;
        var open = D.filter(function (d) { return grid[ty + d[1]][tx + d[0]] === 0; });
        if (open.length > 1) continue;                 // not a dead end
        var walls = shuffle(D.filter(function (d) {
          var wx = tx + d[0], wy = ty + d[1];
          return wx > 0 && wy > 0 && wx < C * 2 && wy < C * 2 && grid[wy][wx] === 1;
        }));
        if (walls.length) grid[ty + walls[0][1]][tx + walls[0][0]] = 0;
      }
    }

    // goal goes in the cell furthest from the start, by BFS
    var start = { x: 1, y: 1 };
    var far = BG.farthestFloor(grid, start);

    return { grid: grid, start: start, goal: far, facing: 0 };
  }

  BG.farthestFloor = function (grid, from) {
    var dist = BG.bfs(grid, from);
    var best = from, bestD = -1;
    for (var y = 0; y < grid.length; y++) {
      for (var x = 0; x < grid[0].length; x++) {
        var d = dist[y][x];
        if (d > bestD) { bestD = d; best = { x: x, y: y }; }
      }
    }
    return best;
  };

  /* Flood fill returning step distance from `from`, -1 where unreachable. */
  BG.bfs = function (grid, from) {
    var H = grid.length, W = grid[0].length;
    var dist = [];
    for (var y = 0; y < H; y++) { dist.push([]); for (var x = 0; x < W; x++) dist[y].push(-1); }
    if (grid[from.y][from.x] === 1) return dist;

    var q = [from];
    dist[from.y][from.x] = 0;
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (var i = 0; i < q.length; i++) {
      var c = q[i];
      for (var k = 0; k < 4; k++) {
        var nx = c.x + D[k][0], ny = c.y + D[k][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (grid[ny][nx] === 1 || dist[ny][nx] !== -1) continue;
        dist[ny][nx] = dist[c.y][c.x] + 1;
        q.push({ x: nx, y: ny });
      }
    }
    return dist;
  };

  // ── entry point ───────────────────────────────────────────────────────────
  BG.buildLevel = function (cfg) {
    var lvl = cfg.kind === "corridor" ? buildCorridor(cfg) : buildMaze(cfg);
    lvl.cfg = cfg;
    lvl.ghosts = placeGhosts(lvl, cfg.ghosts || 0);
    return lvl;
  };

  /* Ghosts spawn on floor tiles that are a fair distance from the player
     so nothing is unfair on the first tick. */
  function placeGhosts(lvl, count) {
    if (!count) return [];
    var dist = BG.bfs(lvl.grid, lvl.start);
    var spots = [];
    for (var y = 0; y < lvl.grid.length; y++) {
      for (var x = 0; x < lvl.grid[0].length; x++) {
        if (dist[y][x] >= 6 && !(x === lvl.goal.x && y === lvl.goal.y)) {
          spots.push({ x: x, y: y, d: dist[y][x] });
        }
      }
    }
    shuffle(spots);
    spots.sort(function (a, b) { return b.d - a.d; });

    var out = [], used = {};
    for (var i = 0; i < spots.length && out.length < count; i++) {
      var s = spots[i];
      var tooClose = out.some(function (o) {
        return Math.abs(o.home.x - s.x) + Math.abs(o.home.y - s.y) < 4;
      });
      if (tooClose || used[s.x + "," + s.y]) continue;
      used[s.x + "," + s.y] = true;
      out.push({ home: { x: s.x, y: s.y } });
    }
    return out;
  }

})(window.BG);
