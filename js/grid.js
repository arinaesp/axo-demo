// Square-grid renderer shared by the learn-phase demo strips and the play
// levels. Coordinates: x = column (left→right), y = row (top→bottom), so
// facing "right" at (0,0) walks along the top row — matches lesson1.json.
// Goals are always inanimate items — the player animal is the only living
// character in the scene, so reaching the goal reads as "found the item".
// No crystal goal type: 💎 is the gem COLLECTIBLE — a crystal goal tile
// would be indistinguishable from a pickup.
export const GOAL_EMOJI = {
  gift_box: '🎁',
  soccer_ball: '⚽',
  treasure_chest: '📦',
  star: '⭐',
  trophy: '🏆',
  flag: '🚩', // exit-tile goal for collect-then-escape levels
};

// Collectibles sit ON a tile (never block movement) and are picked up by the
// "collect" command while standing on that tile. Gems are worth more — they
// reward taking the longer path.
export const ITEM_EMOJI = {
  coin: '🪙',
  gem: '💎',
};
export const ITEM_VALUE = { coin: 1, gem: 3 };

// Obstacles block "go": water is jumped over, stone is broken by remove,
// crates are pushed (into water they FLOAT on it, see crate_float), gates
// open with a key. NOTE: crate shares 📦 with the treasure_chest goal —
// levels with crates must use other goal types.
export const OBSTACLE_EMOJI = {
  water: '🌊',
  stone: '🪨',
  crate: '📦',
  // A crate pushed into shallow water FLOATS on it; it does not plug it.
  // The water sprite stays underneath, so the tile is still a blocker: "go"
  // is refused and only "jump" crosses it — push + jump is the combo.
  crate_float: '📦',
  gate: '🚪',
};

const FACING_ORDER = ['up', 'right', 'down', 'left'];
const FACING_DEG = { right: 0, down: 90, left: 180, up: 270 };
export const FACING_DELTA = {
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
  up: [0, -1],
};

export function turnFacing(facing, word) {
  const step = word === 'turn-right' ? 1 : -1;
  const i = FACING_ORDER.indexOf(facing);
  return FACING_ORDER[(i + step + 4) % 4];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A picked-up thing flying from its tile to wherever it's being banked —
// the header counter in the play phase, the demo pouch in the learn phase.
// Lives here (not in play.js, where it started) because BOTH phases need
// the same motion: the flight is what tells a kid the item went somewhere
// rather than just vanishing. Fixed-position clone, so it can cross out of
// the grid; self-removing.
export function flyTo(fromEl, toEl) {
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const fly = document.createElement('span');
  fly.className = 'coin-fly';
  fly.textContent = fromEl.textContent;
  fly.style.left = `${a.left + a.width / 2}px`;
  fly.style.top = `${a.top + a.height / 2}px`;
  document.body.appendChild(fly);
  requestAnimationFrame(() => {
    const dx = b.left + b.width / 2 - a.left - a.width / 2;
    const dy = b.top + b.height / 2 - a.top - a.height / 2;
    fly.style.transform =
      `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.55)`;
  });
  setTimeout(() => fly.remove(), 500);
}

// The kid picks their animal once at game start; every grid (demo strips and
// levels) renders it from here.
let playerEmoji = '🐻';
export function setPlayerEmoji(emoji) {
  playerEmoji = emoji;
}


export class Grid {
  constructor(container, cols, rows) {
    this.cols = cols;
    this.rows = rows;
    container.innerHTML = '';
    container.style.setProperty('--cols', cols);
    container.style.setProperty('--rows', rows);

    this.el = document.createElement('div');
    this.el.className = 'grid';
    this.tiles = [];
    for (let i = 0; i < cols * rows; i++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      this.el.appendChild(tile);
      this.tiles.push(tile);
    }
    container.appendChild(this.el);

    this.player = null;
    this.goal = null;
    this.obstacles = new Map(); // "x,y" -> { type, el }
    this.items = new Map(); // "x,y" -> { type, value, el } — coins and gems
    this.coinsCollected = 0; // value collected this board (gem counts as 3)
    this.totalCoins = 0; // value of everything placed, for the "2/3" readout
    this.collected = { coin: 0, gem: 0 }; // per-type counts for the counter
    this.totalByType = { coin: 0, gem: 0 }; // per-type totals placed
    this.keyTiles = new Map(); // "x,y" -> el — 🔑, auto-pickup on step
    this.switches = new Map(); // "x,y" -> { opens: {x,y}, el } — 🔘
    this.fogTiles = new Map(); // "x,y" -> el — ☁️ hiding whatever is under it
    this.onCollect = null; // play phase hook: fly-to-counter takes over
    this.onKeyPickup = null; // play phase hook: key flies to the counter
    this.onKeySpent = null; // play phase hook: a key was used on a gate
  }

  _place(sprite, x, y) {
    sprite.style.width = `${100 / this.cols}%`;
    sprite.style.height = `${100 / this.rows}%`;
    sprite.style.left = `${(x / this.cols) * 100}%`;
    sprite.style.top = `${(y / this.rows) * 100}%`;
  }

  setGoal(x, y, type) {
    // Highlight the tile under the prize so the end point reads at a glance.
    this.tiles[y * this.cols + x].classList.add('tile-goal');
    this.goal = document.createElement('div');
    this.goal.className = 'sprite goal';
    this.goal.textContent = GOAL_EMOJI[type] || '⭐';
    this._place(this.goal, x, y);
    this.el.appendChild(this.goal);
  }

  setObstacle(x, y, type) {
    const el = document.createElement('div');
    // Per-type class: stone gets a dark backing block so it stands out
    // against the green tiles and its crumble on remove is unmissable.
    el.className = `sprite obstacle obstacle-${type}`;
    el.textContent = OBSTACLE_EMOJI[type] || '❓';
    this._place(el, x, y);
    this.el.appendChild(el);
    this.obstacles.set(`${x},${y}`, { type, el });
  }

  obstacleAt(x, y) {
    const o = this.obstacles.get(`${x},${y}`);
    return o ? o.type : null;
  }

  setItem(x, y, type) {
    const el = document.createElement('div');
    el.className = 'sprite item';
    // Inner span carries a small offset toward the tile corner, so the item
    // stays visible when the animal stands on the same tile (which is exactly
    // when the kid needs to see it — that's the moment to type "collect").
    const glyph = document.createElement('span');
    glyph.className = 'item-emoji';
    glyph.textContent = ITEM_EMOJI[type] || '🪙';
    el.appendChild(glyph);
    this._place(el, x, y);
    this.el.appendChild(el);
    const value = ITEM_VALUE[type] || 1;
    this.items.set(`${x},${y}`, { type, value, el });
    this.totalCoins += value;
    this.totalByType[type] = (this.totalByType[type] || 0) + 1;
  }

  itemAt(x, y) {
    const item = this.items.get(`${x},${y}`);
    return item ? item.type : null;
  }

  // Pickup feedback ON the tile: a sparkle that bursts in place and a "+1"
  // that floats up and fades. Purely cosmetic — self-removing, never
  // awaited, so run timing is untouched.
  // Why "+1" and not the item's VALUE (a gem is worth 3): the counter the
  // kid can see counts PIECES per type (🪙 2  💎 1) — value only feeds the
  // star/milestone maths. "+3" floating next to a counter ticking by one
  // would read as a bug to a 5-year-old. Don't "fix" this to item.value.
  collectBurst(x, y) {
    const burst = document.createElement('div');
    burst.className = 'sprite collect-burst';
    burst.textContent = '✨';
    this._place(burst, x, y);
    this.el.appendChild(burst);
    const plus = document.createElement('div');
    plus.className = 'sprite collect-plus';
    plus.textContent = '+1';
    this._place(plus, x, y);
    this.el.appendChild(plus);
    setTimeout(() => { burst.remove(); plus.remove(); }, 800);
  }

  // Collected: in the play phase the onCollect hook (fly-to-counter
  // animation) takes over and the tile item vanishes right away; without a
  // hook (learn demos) it floats up with a sparkle instead.
  async collectItem(x, y) {
    const item = this.items.get(`${x},${y}`);
    if (!item) return 0;
    this.items.delete(`${x},${y}`);
    this.coinsCollected += item.value;
    this.collected[item.type] = (this.collected[item.type] || 0) + 1;
    if (this.onCollect) {
      // The flight answers "where did my coin go"; the burst answers
      // "something just happened HERE" — at the tile the kid is watching,
      // which the flight alone never did (it starts as a fixed-position
      // clone and streaks away instantly). Only on this path: the learn
      // path below already floats the item up with its own sparkle.
      this.collectBurst(x, y);
      this.onCollect(item); // reads the tile position, then we clear it
      item.el.remove();
      // Still 200ms, deliberately NOT lengthened to cover the burst: the
      // burst is an overlay that happily plays on while the animal walks
      // off, and every extra ms here is added to the level clock — best
      // times already recorded on coin levels would get harder to beat.
      await sleep(200);
    } else {
      item.el.classList.add('collected');
      await sleep(500);
      item.el.remove();
    }
    return item.value;
  }

  // Remove cleared it: crumble away and the tile becomes walkable.
  async breakObstacle(x, y) {
    const o = this.obstacles.get(`${x},${y}`);
    if (!o) return;
    o.el.classList.add('crumble');
    await sleep(450);
    o.el.remove();
    this.obstacles.delete(`${x},${y}`);
  }

  splash(x, y) {
    const o = this.obstacles.get(`${x},${y}`);
    if (!o) return;
    o.el.classList.add('splash-hit');
    setTimeout(() => o.el.classList.remove('splash-hit'), 500);
  }

  // Keys sit on a tile and hop into the inventory automatically when the
  // animal lands on them — no command needed, unlike coins.
  setKey(x, y) {
    const el = document.createElement('div');
    el.className = 'sprite item';
    el.innerHTML = '<span class="item-emoji">🔑</span>';
    this._place(el, x, y);
    this.el.appendChild(el);
    this.keyTiles.set(`${x},${y}`, el);
  }

  keyAt(x, y) {
    return this.keyTiles.has(`${x},${y}`);
  }

  async takeKey(x, y) {
    const el = this.keyTiles.get(`${x},${y}`);
    if (!el) return;
    this.keyTiles.delete(`${x},${y}`);
    if (this.onKeyPickup) {
      this.onKeyPickup(el); // fly-to-counter takes over from here
      el.remove();
      await sleep(200);
    } else {
      el.classList.add('collected'); // same float-up sparkle as coins
      await sleep(400);
      el.remove();
    }
  }

  // A floor plate: pushing a crate onto it opens the gate at `opens`.
  setSwitch(x, y, opens) {
    const el = document.createElement('div');
    el.className = 'sprite switch';
    el.textContent = '🔘';
    this._place(el, x, y);
    this.el.appendChild(el);
    this.switches.set(`${x},${y}`, { opens, el });
  }

  switchInfo(x, y) {
    return this.switches.get(`${x},${y}`) || null;
  }

  // Slides the crate one tile. Into water it FLOATS on the surface: the water
  // stays put underneath and the tile stays a blocker — walkable only by
  // jumping over it (the water is still dangerous, boxes don't drain lakes).
  // Onto a switch it stays solid and presses the plate (caller opens the gate).
  async pushCrate(x, y, tx, ty) {
    const crate = this.obstacles.get(`${x},${y}`);
    if (!crate) return;
    this.obstacles.delete(`${x},${y}`);
    const target = this.obstacles.get(`${tx},${ty}`);
    this._place(crate.el, tx, ty);
    await sleep(480);
    if (target && target.type === 'water') {
      target.el.classList.add('splash-hit');
      setTimeout(() => target.el.classList.remove('splash-hit'), 500);
      // Both sprites now live on this tile, water underneath. Re-appending
      // the crate puts it last in DOM order, so it paints on top of the
      // water whatever order the level placed them in.
      crate.el.classList.replace('obstacle-crate', 'obstacle-crate_float');
      this.el.appendChild(crate.el);
      this.obstacles.set(`${tx},${ty}`, {
        type: 'crate_float',
        el: crate.el,
        under: target.el, // the water sprite, still on the board
      });
    } else {
      this.obstacles.set(`${tx},${ty}`, crate);
      const sw = this.switches.get(`${tx},${ty}`);
      if (sw) sw.el.classList.add('pressed');
    }
  }

  // Fog: an opaque cloud overlay placed AFTER the tile's real content, so
  // whatever the level put there (water, stone, a coin, or nothing) stays
  // hidden until revealed. The fog sprite's backing block does the hiding —
  // the sprites underneath are untouched, they just can't be seen.
  setFog(x, y) {
    const el = document.createElement('div');
    el.className = 'sprite fog';
    el.textContent = '☁️';
    this._place(el, x, y);
    this.el.appendChild(el);
    this.fogTiles.set(`${x},${y}`, el);
  }

  fogAt(x, y) {
    return this.fogTiles.has(`${x},${y}`);
  }

  // Lifts the fog: by scan (the taught way), or by walking/bumping into the
  // tile (trial and error is allowed — the reveal is the no-punishment
  // answer either way). No-op when the tile isn't fogged.
  async revealFog(x, y) {
    const el = this.fogTiles.get(`${x},${y}`);
    if (!el) return;
    this.fogTiles.delete(`${x},${y}`);
    el.classList.add('fog-lift');
    await sleep(450);
    el.remove();
  }

  // Build placed a bridge: the water is gone for good and a walkable bridge
  // plank takes its place — unlike jump, the crossing is permanent.
  async buildBridge(x, y) {
    const water = this.obstacles.get(`${x},${y}`);
    if (!water || water.type !== 'water') return;
    water.el.remove();
    this.obstacles.delete(`${x},${y}`);
    const el = document.createElement('div');
    el.className = 'sprite bridge';
    el.textContent = '🌉';
    this._place(el, x, y);
    this.el.appendChild(el);
    await sleep(450);
  }

  async openGate(x, y) {
    const gate = this.obstacles.get(`${x},${y}`);
    if (!gate || gate.type !== 'gate') return;
    gate.el.classList.add('crumble');
    await sleep(450);
    gate.el.remove();
    this.obstacles.delete(`${x},${y}`);
  }

  setPlayer(x, y, facing, emoji = playerEmoji) {
    if (!this.player) {
      this.player = document.createElement('div');
      this.player.className = 'sprite player';
      const face = document.createElement('span');
      face.className = 'player-emoji';
      face.textContent = emoji;
      const orbit = document.createElement('span');
      orbit.className = 'arrow-orbit';
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '➤';
      orbit.appendChild(arrow);
      this.player.append(face, orbit);
      this.el.appendChild(this.player);
    }
    this._place(this.player, x, y);
    this.setFacing(facing, false);
  }

  setFacing(facing, animate = true) {
    const orbit = this.player.querySelector('.arrow-orbit');
    orbit.style.transition = animate ? 'transform .4s ease' : 'none';
    orbit.style.transform = `rotate(${FACING_DEG[facing]}deg)`;
  }

  async movePlayer(x, y) {
    this._place(this.player, x, y);
    await sleep(480);
  }

  // Same slide as movePlayer plus an arc animation on the sprite.
  async jumpPlayer(x, y) {
    this.player.classList.add('jump');
    this._place(this.player, x, y);
    await sleep(520);
    this.player.classList.remove('jump');
  }

  // Gentle "can't go there" nudge — the no-fail state for walking off-grid.
  async bump() {
    this.player.classList.add('bump');
    await sleep(420);
    this.player.classList.remove('bump');
  }

  async turnPlayer(facing) {
    this.setFacing(facing, true);
    await sleep(450);
  }

  celebrateGoal() {
    if (this.goal) this.goal.classList.add('party');
    if (this.player) this.player.classList.add('party');
  }
}

// Keys are picked up by landing on their tile — called after every move.
async function pickUpKey(grid, state, audio, notify) {
  if (!grid.keyAt(state.x, state.y)) return;
  state.keys = (state.keys || 0) + 1;
  notify?.('🔑 You got a key!');
  audio?.play('key_get', 'a key!');
  await grid.takeKey(state.x, state.y);
}

// Executes one command against grid + state ({x, y, facing, keys}),
// animating as it goes. audio is optional (for splash/crunch effects);
// notify is an optional toast callback for gentle guidance. Returns true if
// the command changed anything; a blocked command just bumps — never a
// fail state.
export async function runCommand(grid, state, word, audio, notify) {
  const [dx, dy] = FACING_DELTA[state.facing];
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < grid.cols && y < grid.rows;

  if (word === 'go') {
    const nx = state.x + dx;
    const ny = state.y + dy;
    if (!inBounds(nx, ny) || grid.obstacleAt(nx, ny)) {
      // Bumping into fog lifts it — trying IS a way to find out what's there.
      if (inBounds(nx, ny)) grid.revealFog(nx, ny);
      // A floating crate is the one blocker a kid reads as walkable ground —
      // name the water underneath and point at the word that crosses it.
      if (grid.obstacleAt(nx, ny) === 'crate_float') {
        notify?.('The water is still there! Try jump 🌊');
      }
      await grid.bump();
      return false;
    }
    state.x = nx;
    state.y = ny;
    grid.revealFog(nx, ny); // stepping onto fog lifts it (not awaited — clears mid-stride)
    await grid.movePlayer(nx, ny);
    await pickUpKey(grid, state, audio, notify);
    return true;
  }

  if (word === 'jump') {
    // Leaps over the adjacent tile (that's where the water is) and lands two
    // ahead; blocked if the landing spot is off-grid or occupied. Only water,
    // a crate floating ON water (push + jump is the taught combo) or empty
    // ground can be jumped over — stone needs remove, a gate needs a key, a
    // crate on dry land needs push, so those block the jump too.
    const mx = state.x + dx;
    const my = state.y + dy;
    const lx = state.x + dx * 2;
    const ly = state.y + dy * 2;
    if (!inBounds(lx, ly) || grid.obstacleAt(lx, ly)) {
      if (inBounds(lx, ly)) grid.revealFog(lx, ly); // blocked landing shows why
      await grid.bump();
      return false;
    }
    const mid = grid.obstacleAt(mx, my);
    if (mid && mid !== 'water' && mid !== 'crate_float') {
      grid.revealFog(mx, my); // show what's in the way
      notify?.('Too big to jump over! Try another word 🙂');
      await grid.bump();
      return false;
    }
    grid.revealFog(mx, my); // leaping over fog blows it away
    grid.revealFog(lx, ly);
    if (grid.obstacleAt(mx, my) === 'water') {
      audio?.play('splash', 'splash!');
      grid.splash(mx, my);
    }
    state.x = lx;
    state.y = ly;
    await grid.jumpPlayer(lx, ly);
    await pickUpKey(grid, state, audio, notify);
    return true;
  }

  if (word === 'remove') {
    // Breaks a stone on the tile directly ahead; the tile becomes walkable.
    const tx = state.x + dx;
    const ty = state.y + dy;
    if (grid.obstacleAt(tx, ty) === 'stone') {
      audio?.play('crunch', 'crunch!');
      await grid.breakObstacle(tx, ty);
      return true;
    }
    await grid.bump(); // nothing to remove — gentle nudge, no penalty
    return false;
  }

  if (word === 'push') {
    // Slides the crate directly ahead one tile onward. The animal stays
    // put. Into water the crate floats on the surface (crate_float — the
    // tile still blocks "go", jump crosses it); onto a switch it presses the
    // plate and the linked gate opens. The target check below ("anything but
    // shallow water blocks") also stops a crate from being pushed onto an
    // already-floating crate — only open shallow water takes a crate.
    const cx = state.x + dx;
    const cy = state.y + dy;
    const tx = cx + dx;
    const ty = cy + dy;
    if (grid.obstacleAt(cx, cy) !== 'crate') {
      notify?.('Nothing to push! Face a 📦');
      await grid.bump();
      return false;
    }
    const target = inBounds(tx, ty) ? grid.obstacleAt(tx, ty) : 'edge';
    if (target && target !== 'water') {
      notify?.('The box has nowhere to go!');
      await grid.bump();
      return false;
    }
    if (target === 'water') audio?.play('splash', 'splash!');
    const sw = grid.switchInfo(tx, ty);
    await grid.pushCrate(cx, cy, tx, ty);
    if (sw && !target) await grid.openGate(sw.opens.x, sw.opens.y);
    return true;
  }

  if (word === 'open') {
    // Opens the gate directly ahead — needs a key, and each key opens one
    // gate. Keys are picked up by stepping on them.
    const gx = state.x + dx;
    const gy = state.y + dy;
    if (grid.obstacleAt(gx, gy) !== 'gate') {
      notify?.('No door to open here 🚪');
      await grid.bump();
      return false;
    }
    if (!state.keys) {
      notify?.('You need a key first! Look for 🔑');
      await grid.bump();
      return false;
    }
    state.keys--;
    grid.onKeySpent?.(); // counter ticks down: the key went into the lock
    await grid.openGate(gx, gy);
    return true;
  }

  if (word === 'collect') {
    // Picks up the coin/gem on the CURRENT tile — being next to it isn't
    // enough, the animal must stand on it (teaches precise positioning).
    if (grid.itemAt(state.x, state.y)) {
      audio?.play('coin_get', 'yay!');
      await grid.collectItem(state.x, state.y);
      return true;
    }
    notify?.('Move to the item first! 🪙');
    await grid.bump();
    return false;
  }

  if (word === 'scan') {
    // Reveals the fog on the tile directly ahead — look first, then decide.
    // The conditional thinking stays in the kid's head: scan tells you WHAT
    // is there, the kid picks the right command for it.
    const tx = state.x + dx;
    const ty = state.y + dy;
    if (inBounds(tx, ty) && grid.fogAt(tx, ty)) {
      audio?.play('scan_reveal', 'ooh!');
      await grid.revealFog(tx, ty);
      return true;
    }
    notify?.('No fog ahead — you can already see that tile! 👀');
    await grid.bump();
    return false;
  }

  if (word === 'build') {
    // Places a bridge on the water tile directly ahead. Unlike jump the
    // animal stays put, and the crossing is permanent — the way over double
    // water, where jump's landing spot is still wet.
    const tx = state.x + dx;
    const ty = state.y + dy;
    if (inBounds(tx, ty) && grid.fogAt(tx, ty)) {
      notify?.('Foggy! Try scan first 🔍');
      await grid.bump();
      return false;
    }
    if (inBounds(tx, ty) && grid.obstacleAt(tx, ty) === 'water') {
      audio?.play('build_bridge', 'build!');
      await grid.buildBridge(tx, ty);
      return true;
    }
    notify?.('No water to bridge here 🌊');
    await grid.bump();
    return false;
  }

  if (word === 'turn-left' || word === 'turn-right') {
    state.facing = turnFacing(state.facing, word);
    await grid.turnPlayer(state.facing);
    return true;
  }
  return false;
}
