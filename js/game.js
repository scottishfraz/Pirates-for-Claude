// Broadside — a small open-sea sailing & cannon-combat prototype.
// Rendered as a top-down 2D "nautical chart" on a canvas — no 3D engine,
// no external art assets. The camera is centered on the player and
// rotates so the player's own heading always points "up" on screen,
// which is what makes ships to your left/right visible at a glance
// (a fixed chase camera, by contrast, cannot show what's to your side).
//
// Coordinate convention (read this before touching headings/vectors):
// world (x, y) matches the canvas — y increases DOWNWARD, same as
// screen pixels. Heading is a compass bearing in radians, 0 = "up"
// (north) on an unrotated view, increasing clockwise. That makes:
//   forwardVec(h) = ( sin(h), -cos(h) )   // h=0 -> (0,-1), i.e. up
//   rightVec(h)   = ( cos(h),  sin(h) )   // h=0 -> (1,0), i.e. right
// Every position update, AI heading calc, and cannon-firing direction
// in this file is built from those two functions, so the whole game
// only has one place where the orientation convention could go wrong.

function forwardVec(h) { return { x: Math.sin(h), y: -Math.cos(h) }; }
function rightVec(h) { return { x: Math.cos(h), y: Math.sin(h) }; }
function headingTo(dx, dy) { return Math.atan2(dx, -dy); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function angleDiff(target, current) {
  return ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}
function turnToward(current, target, maxDelta) {
  return current + clamp(angleDiff(target, current), -maxDelta, maxDelta);
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------
// Canvas / camera
// ---------------------------------------------------------------------
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
let dpr = 1;
let viewScale = 1;
const VIEW_RADIUS = 170; // world units guaranteed visible at the screen's narrower dimension

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  viewScale = Math.min(innerWidth, innerHeight) / (VIEW_RADIUS * 2);
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------
// Ships
// ---------------------------------------------------------------------
const HULL_BOW = 8, HULL_STERN = 7.4, HULL_HALF_W = 3.6;
const MAX_SPEED = 26, ACCEL = 1.2, TURN_RATE = 0.9;
const RELOAD_TIME = 1.6, CANNON_SPEED = 62, CANNON_RANGE = 130, HIT_RADIUS = 7.2;

// Historically, round shot holed the hull, chain shot shredded rigging to
// slow/cripple a ship, and grape shot cut down the crew on deck — three
// distinct tactical choices rather than one damage number.
const AMMO = {
  round: { label: 'Round Shot', hull: 20, sail: 0, crew: 2 },
  chain: { label: 'Chain Shot', hull: 3, sail: 28, crew: 0 },
  grape: { label: 'Grape Shot', hull: 3, sail: 0, crew: 22 },
};

const SHIP_NATIONS = ['Spanish', 'British', 'French', 'Dutch'];
const SHIP_CLASSES = ['War Galleon', 'Frigate', 'Brigantine', 'Sloop'];
const SHIP_NAMES = ['Santa Marta', 'Retribution', "Fortune's Favor", 'Zeearend', 'Perle Noire', 'San Cristobal', 'Windhound', 'Espadon'];
function randomShipLabel() {
  const nation = SHIP_NATIONS[Math.floor(Math.random() * SHIP_NATIONS.length)];
  const cls = SHIP_CLASSES[Math.floor(Math.random() * SHIP_CLASSES.length)];
  const name = SHIP_NAMES[Math.floor(Math.random() * SHIP_NAMES.length)];
  return `${nation} ${cls} "${name}"`;
}

function createShip(faction) {
  return {
    faction,
    x: 0, y: 0,
    heading: 0,
    speed: 0,
    throttle: faction === 'player' ? 0 : 0.55,
    health: 100,
    maxHealth: 100,
    sailHealth: 100,
    maxSailHealth: 100,
    crew: 100,
    maxCrew: 100,
    crewRoutedLogged: false,
    ammo: 'round',
    reload: { left: 0, right: 0 },
    state: 'active',
    sinkTimer: 0,
    aiState: 'patrol',
    aiTimer: Math.random() * 3,
    flagPhase: Math.random() * Math.PI * 2,
    wake: [],
    label: faction === 'enemy' ? randomShipLabel() : null,
    palette: faction === 'player'
      ? { hull: '#5b3a24', hullLow: '#3c2818', deck: '#8a6a45', sail: '#ece2c8', sailShade: '#c9bf9f', trim: '#2f5a86', flag: '#2f5a86' }
      : { hull: '#3a2a26', hullLow: '#241814', deck: '#4d3a30', sail: '#cbb9a3', sailShade: '#a5947f', trim: '#6a1f1a', flag: '#6a1f1a' },
  };
}

const player = createShip('player');
const enemies = [];
const MAX_ENEMIES = 3;

function spawnEnemy() {
  const ship = createShip('enemy');
  const angle = Math.random() * Math.PI * 2;
  const dist = 160 + Math.random() * 90;
  ship.x = player.x + Math.sin(angle) * dist;
  ship.y = player.y - Math.cos(angle) * dist;
  ship.heading = Math.random() * Math.PI * 2;
  enemies.push(ship);
}
for (let i = 0; i < MAX_ENEMIES; i++) spawnEnemy();

function pickEnemyAmmo() {
  const r = Math.random();
  return r < 0.7 ? 'round' : r < 0.85 ? 'chain' : 'grape';
}

// ---------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------
const wind = { angle: Math.random() * Math.PI * 2 };

// ---------------------------------------------------------------------
// Cannonballs & particles
// ---------------------------------------------------------------------
const cannonballs = [];
const particles = [];

function fireCannon(ship, side, ammoType) {
  if (ship.reload[side] > 0) return;
  if (ship.crew <= 0) {
    if (ship === player && !ship.crewRoutedLogged) {
      log("Your deck is cleared — there's no one left to load a gun!");
      ship.crewRoutedLogged = true;
    }
    return;
  }
  ship.reload[side] = RELOAD_TIME;
  const ammo = ammoType || ship.ammo || 'round';

  const fwd = forwardVec(ship.heading);
  const right = rightVec(ship.heading);
  const mountOffset = side === 'left' ? -HULL_HALF_W * 0.8 : HULL_HALF_W * 0.8;
  const originX = ship.x + right.x * mountOffset;
  const originY = ship.y + right.y * mountOffset;

  const spread = (Math.random() - 0.5) * 0.08;
  const outSign = side === 'left' ? -1 : 1;
  const dirX = right.x * outSign * Math.cos(spread) + fwd.x * Math.sin(spread) * outSign;
  const dirY = right.y * outSign * Math.cos(spread) + fwd.y * Math.sin(spread) * outSign;

  cannonballs.push({
    x: originX, y: originY,
    vx: dirX * CANNON_SPEED + fwd.x * ship.speed * 0.5,
    vy: dirY * CANNON_SPEED + fwd.y * ship.speed * 0.5,
    life: CANNON_RANGE / CANNON_SPEED,
    owner: ship,
    ammo,
  });

  spawnSpark(originX, originY);
  if (ship === player) log(`You fire ${AMMO[ammo].label} from the ${side} broadside.`);
}

function spawnSplash(x, y) { particles.push({ x, y, life: 0.6, maxLife: 0.6, r: 1.5, growth: 9, kind: 'splash' }); }
function spawnSpark(x, y) { particles.push({ x, y, life: 0.3, maxLife: 0.3, r: 1, growth: 7, kind: 'spark' }); }

// ---------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (gameState === 'playing') {
    if (e.code === 'KeyQ') fireCannon(player, 'left');
    if (e.code === 'KeyE') fireCannon(player, 'right');
    if (e.code === 'Digit1') setAmmo('round');
    if (e.code === 'Digit2') setAmmo('chain');
    if (e.code === 'Digit3') setAmmo('grape');
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

// ---------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const healthFill = el('healthFill');
const sailFill = el('sailFill');
const crewFill = el('crewFill');
const speedValue = el('speedValue');
const windArrow = el('windArrow');
const headingArrow = el('headingArrow');
const scoreValue = el('scoreValue');
const messageLog = el('messageLog');
const reloadLeftBar = el('reloadLeft');
const reloadRightBar = el('reloadRight');
const titleScreen = el('titleScreen');
const gameOverScreen = el('gameOverScreen');
const finalScoreValue = el('finalScoreValue');
const damageVignette = el('damageVignette');

let score = 0;
let gameState = 'title';

// ---------------------------------------------------------------------
// Touch controls (virtual joystick + fire buttons)
// ---------------------------------------------------------------------
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const joystickBase = el('joystickBase');
const joystickKnob = el('joystickKnob');
const joystick = { active: false, dx: 0, dy: 0, pointerId: null };
const JOY_RADIUS = 39;

function updateJoystick(e) {
  const rect = joystickBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = e.clientX - cx;
  let dy = e.clientY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > JOY_RADIUS) { dx = (dx / dist) * JOY_RADIUS; dy = (dy / dist) * JOY_RADIUS; }
  joystick.dx = dx / JOY_RADIUS;
  joystick.dy = dy / JOY_RADIUS;
  joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
}
function resetJoystick() {
  joystick.active = false;
  joystick.pointerId = null;
  joystick.dx = 0;
  joystick.dy = 0;
  joystickKnob.style.transform = 'translate(0, 0)';
}
joystickBase.addEventListener('pointerdown', (e) => {
  joystick.active = true;
  joystick.pointerId = e.pointerId;
  joystickBase.setPointerCapture(e.pointerId);
  updateJoystick(e);
});
joystickBase.addEventListener('pointermove', (e) => {
  if (joystick.active && e.pointerId === joystick.pointerId) updateJoystick(e);
});
joystickBase.addEventListener('pointerup', (e) => {
  if (e.pointerId === joystick.pointerId) resetJoystick();
});
joystickBase.addEventListener('pointercancel', resetJoystick);

function bindFireButton(button, side) {
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (gameState === 'playing') fireCannon(player, side);
  });
}
bindFireButton(el('portBtn'), 'left');
bindFireButton(el('starboardBtn'), 'right');

const ammoButtons = { round: el('ammoRound'), chain: el('ammoChain'), grape: el('ammoGrape') };
function setAmmo(type) {
  player.ammo = type;
  for (const key in ammoButtons) ammoButtons[key].classList.toggle('active', key === type);
}
for (const key in ammoButtons) {
  ammoButtons[key].addEventListener('pointerdown', (e) => { e.preventDefault(); setAmmo(key); });
}

if (isTouch) {
  el('touchControls').classList.remove('hidden');
  el('portKeyHint').textContent = 'Tap — Port';
  el('starboardKeyHint').textContent = 'Tap — Starboard';
  el('controlsHint').innerHTML =
    '<div><b>Left stick</b> — trim sails &amp; steer</div>' +
    '<div><b>Port / Stbd</b> buttons — fire cannons</div>' +
    '<div><b>Round / Chain / Grape</b> — tap to choose shot</div>';
}

const messages = [];
function log(text) {
  messages.push({ text, life: 4 });
  if (messages.length > 4) messages.shift();
  renderLog();
}
function renderLog() {
  messageLog.innerHTML = messages.map((m) => `<div class="log-line" style="opacity:${Math.min(1, m.life)}">${m.text}</div>`).join('');
}

el('startBtn').addEventListener('click', startGame);
el('restartBtn').addEventListener('click', startGame);

function startGame() {
  titleScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  gameState = 'playing';
  score = 0;
  player.health = player.maxHealth;
  player.sailHealth = player.maxSailHealth;
  player.crew = player.maxCrew;
  player.crewRoutedLogged = false;
  player.throttle = 0;
  player.speed = 0;
  player.x = 0; player.y = 0;
  player.heading = 0;
  player.wake = [];
  setAmmo('round');
  messages.length = 0;
  log('Anchors aweigh. Q/E fire cannons, arrows to sail.');
  enemies.length = 0;
  for (let i = 0; i < MAX_ENEMIES; i++) spawnEnemy();
}

function gameOver() {
  gameState = 'gameover';
  finalScoreValue.textContent = score;
  gameOverScreen.classList.remove('hidden');
}

// ---------------------------------------------------------------------
// Physics & AI
// ---------------------------------------------------------------------
function updateShipPhysics(ship, dt, elapsed) {
  const fwd = forwardVec(ship.heading);
  const windVec = forwardVec(wind.angle);
  const alignment = fwd.x * windVec.x + fwd.y * windVec.y;
  const windMultiplier = lerp(0.4, 1.35, (alignment + 1) / 2);
  const sailFactor = lerp(0.4, 1, ship.sailHealth / ship.maxSailHealth);
  const targetSpeed = ship.throttle * MAX_SPEED * windMultiplier * sailFactor;
  ship.speed += (targetSpeed - ship.speed) * Math.min(1, dt * ACCEL);

  ship.x += fwd.x * ship.speed * dt;
  ship.y += fwd.y * ship.speed * dt;

  if (ship.speed > 2) {
    ship.wake.push({ x: ship.x - fwd.x * 6, y: ship.y - fwd.y * 6, life: 1.4 });
    if (ship.wake.length > 40) ship.wake.shift();
  }
  for (const w of ship.wake) w.life -= dt;
  while (ship.wake.length && ship.wake[0].life <= 0) ship.wake.shift();

  ship.sailTrim = clamp(ship.throttle * windMultiplier, 0.15, 1);
  ship.reload.left = Math.max(0, ship.reload.left - dt);
  ship.reload.right = Math.max(0, ship.reload.right - dt);
}

function updateEnemyAI(ship, dt) {
  const dx = player.x - ship.x, dy = player.y - ship.y;
  const dist = Math.hypot(dx, dy);
  ship.aiTimer -= dt;

  if (ship.aiState === 'patrol') {
    ship.throttle = 0.35;
    if (ship.aiTimer <= 0) {
      ship.heading += (Math.random() - 0.5) * 1.2;
      ship.aiTimer = 2 + Math.random() * 3;
    }
    if (dist < 210) ship.aiState = 'hunt';
  } else if (ship.aiState === 'hunt') {
    ship.throttle = 0.85;
    ship.heading = turnToward(ship.heading, headingTo(dx, dy), dt * 1.1);
    if (dist < 130) ship.aiState = 'engage';
    if (dist > 260) ship.aiState = 'patrol';
  } else if (ship.aiState === 'engage') {
    ship.throttle = 0.55;
    ship.heading = turnToward(ship.heading, headingTo(dx, dy) + Math.PI / 2, dt * 0.8);
    if (dist > 200) ship.aiState = 'hunt';

    const right = rightVec(ship.heading);
    const side = (right.x * dx + right.y * dy) > 0 ? 'right' : 'left';
    if (dist < 150 && ship.reload[side] <= 0 && Math.random() < 0.7) fireCannon(ship, side, pickEnemyAmmo());
  }
}

function sinkShip(ship, dt) {
  ship.sinkTimer += dt;
  ship.sinkScale = Math.max(0, 1 - ship.sinkTimer / 3);
  for (const w of ship.wake) w.life -= dt;
  while (ship.wake.length && ship.wake[0].life <= 0) ship.wake.shift();
  if (ship.sinkTimer > 3) {
    const idx = enemies.indexOf(ship);
    if (idx >= 0) enemies.splice(idx, 1);
  }
}

let damageFlash = 0;

function checkCannonballHits(ball) {
  const targets = ball.owner === player ? enemies : [player];
  for (const target of targets) {
    if (target.state !== 'active') continue;
    const dx = ball.x - target.x, dy = ball.y - target.y;
    if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) {
      const dmg = AMMO[ball.ammo] || AMMO.round;
      target.health -= dmg.hull;
      target.sailHealth = Math.max(0, target.sailHealth - dmg.sail);
      target.crew = Math.max(0, target.crew - dmg.crew);
      spawnSpark(ball.x, ball.y);
      const you = target === player;
      if (dmg.sail > dmg.hull && dmg.sail > dmg.crew) {
        log(you ? 'Chain shot tears through your rigging!' : "Chain shot shreds the enemy's rigging!");
      } else if (dmg.crew > dmg.hull && dmg.crew > dmg.sail) {
        log(you ? 'Grapeshot rakes your deck!' : "Grapeshot sweeps the enemy's deck!");
      } else {
        log(you ? 'Your hull shudders under fire!' : 'A direct hit on the enemy vessel!');
      }
      if (you) damageFlash = 1;
      if (target.health <= 0 && target.state === 'active') {
        target.state = 'sinking';
        target.sinkTimer = 0;
        target.sinkScale = 1;
        if (target === player) gameOver();
        else {
          score += 1;
          log('Enemy vessel sent to the depths.');
          setTimeout(() => { if (gameState === 'playing') spawnEnemy(); }, 2500);
        }
      }
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------
function drawChartSea() {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, VIEW_RADIUS * 2.4);
  g.addColorStop(0, '#1f5560');
  g.addColorStop(1, '#0d3038');
  ctx.fillStyle = g;
  ctx.fillRect(-innerWidth, -innerHeight, innerWidth * 2, innerHeight * 2);

  const spacing = 40;
  const reach = VIEW_RADIUS * 1.6;
  const startX = Math.floor((player.x - reach) / spacing) * spacing;
  const startY = Math.floor((player.y - reach) / spacing) * spacing;
  ctx.strokeStyle = 'rgba(224, 176, 96, 0.14)';
  ctx.lineWidth = 1 / viewScale;
  ctx.beginPath();
  for (let x = startX; x <= player.x + reach; x += spacing) {
    ctx.moveTo(x, player.y - reach);
    ctx.lineTo(x, player.y + reach);
  }
  for (let y = startY; y <= player.y + reach; y += spacing) {
    ctx.moveTo(player.x - reach, y);
    ctx.lineTo(player.x + reach, y);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(224, 176, 96, 0.22)';
  for (let x = startX; x <= player.x + reach; x += spacing) {
    for (let y = startY; y <= player.y + reach; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Cheap deterministic sun-glint shimmer: a hash of each grid cell decides
// whether it twinkles at all, so points don't jump around frame to frame.
function drawSparkles(elapsed) {
  const spacing = 27;
  const reach = VIEW_RADIUS * 1.3;
  const startX = Math.floor((player.x - reach) / spacing) * spacing;
  const startY = Math.floor((player.y - reach) / spacing) * spacing;
  for (let x = startX; x <= player.x + reach; x += spacing) {
    for (let y = startY; y <= player.y + reach; y += spacing) {
      const seed = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      if (seed < 0.6) continue;
      const twinkle = 0.5 + 0.5 * Math.sin(elapsed * 1.6 + seed * 30);
      ctx.fillStyle = `rgba(255,255,255,${(0.08 + twinkle * 0.22).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawWake(ship) {
  for (const w of ship.wake) {
    const a = Math.max(0, w.life / 1.4) * 0.35;
    ctx.fillStyle = `rgba(223, 241, 234, ${a})`;
    ctx.beginPath();
    ctx.arc(w.x, w.y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function shipHullPath() {
  ctx.beginPath();
  ctx.moveTo(0, -HULL_BOW);
  ctx.quadraticCurveTo(HULL_HALF_W * 0.35, -HULL_BOW * 0.85, HULL_HALF_W, -HULL_BOW * 0.35);
  ctx.lineTo(HULL_HALF_W, HULL_STERN * 0.55);
  ctx.quadraticCurveTo(HULL_HALF_W * 0.9, HULL_STERN * 0.92, 0, HULL_STERN);
  ctx.quadraticCurveTo(-HULL_HALF_W * 0.9, HULL_STERN * 0.92, -HULL_HALF_W, HULL_STERN * 0.55);
  ctx.lineTo(-HULL_HALF_W, -HULL_BOW * 0.35);
  ctx.quadraticCurveTo(-HULL_HALF_W * 0.35, -HULL_BOW * 0.85, 0, -HULL_BOW);
  ctx.closePath();
}

function drawSail(x, yardLen, trim, palette) {
  const w = yardLen * clamp(trim, 0.15, 1);
  ctx.save();
  ctx.translate(0, x);
  ctx.strokeStyle = 'rgba(40,30,20,0.6)';
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  ctx.moveTo(-yardLen / 2, 0);
  ctx.lineTo(yardLen / 2, 0);
  ctx.stroke();

  const grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  grad.addColorStop(0, palette.sailShade);
  grad.addColorStop(0.5, palette.sail);
  grad.addColorStop(1, palette.sailShade);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0.9, w / 2, 1.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // subtle top sheen / underside shadow for a billowed, sunlit look
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0.9, w / 2, 1.1, 0, 0, Math.PI * 2);
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, -0.2, 0, 2);
  sheen.addColorStop(0, 'rgba(255,255,255,0.28)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = sheen;
  ctx.fillRect(-w / 2, -0.2, w, 2.2);
  ctx.restore();

  ctx.strokeStyle = 'rgba(40,30,20,0.25)';
  ctx.lineWidth = 0.15;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo((w / 2) * i * 0.6, 0.2);
    ctx.lineTo((w / 2) * i * 0.6, 1.6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShip(ship, elapsed) {
  const scale = ship.state === 'sinking' ? (ship.sinkScale ?? 1) : 1;
  ctx.save();
  ctx.translate(ship.x, ship.y);

  // Nameplate/stat banner stays screen-aligned regardless of the ship's own
  // facing or the camera's rotation, so cancel the camera's -player.heading.
  if (ship !== player && ship.state === 'active') {
    ctx.save();
    ctx.rotate(player.heading);
    ctx.font = '5px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(236,223,196,0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 1.5;
    ctx.fillText(ship.label, 0, -HULL_BOW - 10);
    ctx.shadowBlur = 0;

    const barW = 17, barH = 1.5, gap = 0.5;
    const stats = [
      { v: ship.health / ship.maxHealth, color: '#e0b060' },
      { v: ship.sailHealth / ship.maxSailHealth, color: '#3a5a53' },
      { v: ship.crew / ship.maxCrew, color: '#ecdfc4' },
    ];
    stats.forEach((s, i) => {
      const yy = -HULL_BOW - 7.5 + i * (barH + gap);
      ctx.fillStyle = 'rgba(13,27,42,0.75)';
      ctx.fillRect(-barW / 2, yy, barW, barH);
      ctx.fillStyle = s.color;
      ctx.fillRect(-barW / 2, yy, barW * clamp(s.v, 0, 1), barH);
    });
    ctx.restore();
  }

  ctx.rotate(ship.heading + (ship.state === 'sinking' ? ship.sinkTimer * 0.6 : 0));
  ctx.scale(scale, scale);
  ctx.globalAlpha = scale;
  const p = ship.palette;

  // hull: darker waterline hull underneath, then the upper hull with a
  // left-lit/right-shadowed gradient and a soft drop shadow for volume
  ctx.save();
  ctx.scale(0.94, 0.94);
  ctx.fillStyle = p.hullLow;
  shipHullPath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 2.2;
  ctx.shadowOffsetX = 1.1;
  ctx.shadowOffsetY = 1.6;
  const hullGrad = ctx.createLinearGradient(-HULL_HALF_W, 0, HULL_HALF_W, 0);
  hullGrad.addColorStop(0, shade(p.hull, 26));
  hullGrad.addColorStop(0.55, p.hull);
  hullGrad.addColorStop(1, shade(p.hull, -24));
  ctx.fillStyle = hullGrad;
  shipHullPath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 0.6;
  shipHullPath();
  ctx.stroke();

  // deck
  ctx.fillStyle = p.deck;
  ctx.fillRect(-HULL_HALF_W * 0.75, -HULL_BOW * 0.8, HULL_HALF_W * 1.5, (HULL_BOW + HULL_STERN) * 0.78);

  // forecastle / aftcastle
  ctx.fillStyle = p.deck;
  ctx.fillRect(-2.4, -HULL_BOW * 0.85, 4.8, 2.6);
  ctx.fillRect(-2.7, HULL_STERN * 0.35, 5.4, 3.2);

  // gun ports
  ctx.fillStyle = 'rgba(20,18,16,0.85)';
  [-3.2, -0.4, 2.4].forEach((zz) => {
    ctx.fillRect(-HULL_HALF_W - 0.6, zz - 0.5, 1.1, 1);
    ctx.fillRect(HULL_HALF_W - 0.5, zz - 0.5, 1.1, 1);
  });

  // bowsprit
  ctx.strokeStyle = '#4a3524';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, -HULL_BOW);
  ctx.lineTo(0, -HULL_BOW - 3.2);
  ctx.stroke();

  // sails (foremast near bow, mainmast center-aft)
  drawSail(-3.4, 6.2, ship.sailTrim ?? 0, p);
  drawSail(1.4, 8, ship.sailTrim ?? 0, p);

  // masts
  ctx.fillStyle = '#3a2a1c';
  [-3.4, 1.4].forEach((mz) => {
    ctx.beginPath();
    ctx.arc(0, mz, 0.55, 0, Math.PI * 2);
    ctx.fill();
  });

  // flag
  const wave = Math.sin(elapsed * 3 + ship.flagPhase) * 0.3;
  ctx.save();
  ctx.translate(0, HULL_STERN * 0.35 - 0.4);
  ctx.rotate(wave);
  ctx.fillStyle = p.flag;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(1.6, -0.5);
  ctx.lineTo(0, -1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

function drawCannonball(ball) {
  const angle = Math.atan2(ball.vy, ball.vx);
  ctx.fillStyle = '#1c1c1c';
  if (ball.ammo === 'chain') {
    // two linked balls, historically fired to shred rigging and sails
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(angle);
    ctx.strokeStyle = '#1c1c1c';
    ctx.lineWidth = 0.25;
    ctx.beginPath();
    ctx.moveTo(-0.7, 0);
    ctx.lineTo(0.7, 0);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(-0.7, 0, 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0.7, 0, 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else if (ball.ammo === 'grape') {
    // a scattering cluster of small shot
    [[-0.5, -0.4], [0.5, -0.3], [0, 0.5], [-0.3, 0.3], [0.4, 0.4]].forEach(([ox, oy]) => {
      ctx.beginPath();
      ctx.arc(ball.x + ox, ball.y + oy, 0.28, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticle(p) {
  const t = p.life / p.maxLife;
  const r = p.r + (p.maxLife - p.life) * p.growth;
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  if (p.kind === 'splash') {
    grad.addColorStop(0, `rgba(255,255,255,${0.85 * t})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    grad.addColorStop(0, `rgba(255,214,140,${0.9 * t})`);
    grad.addColorStop(1, 'rgba(120,40,20,0)');
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------
let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  const elapsed = now / 1000;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);

  if (gameState === 'playing') {
    let turnInput = 0, throttleInput = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) turnInput -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) turnInput += 1;
    if (keys['ArrowUp'] || keys['KeyW']) throttleInput += 1;
    if (keys['ArrowDown'] || keys['KeyS']) throttleInput -= 1;
    if (joystick.active) { turnInput += joystick.dx; throttleInput -= joystick.dy; }
    turnInput = clamp(turnInput, -1, 1);
    throttleInput = clamp(throttleInput, -1, 1);
    player.heading += turnInput * dt * TURN_RATE;
    player.throttle = clamp(player.throttle + throttleInput * dt * 0.6, 0, 1);

    updateShipPhysics(player, dt, elapsed);
    for (const en of enemies) {
      if (en.state === 'active') { updateEnemyAI(en, dt); updateShipPhysics(en, dt, elapsed); }
      else if (en.state === 'sinking') sinkShip(en, dt);
    }

    for (let i = cannonballs.length - 1; i >= 0; i--) {
      const ball = cannonballs[i];
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.life -= dt;
      if (checkCannonballHits(ball)) { cannonballs.splice(i, 1); continue; }
      if (ball.life <= 0) { spawnSplash(ball.x, ball.y); cannonballs.splice(i, 1); }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].life -= dt;
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      messages[i].life -= dt;
      if (messages[i].life <= 0) messages.splice(i, 1);
    }
    renderLog();

    // ---- render world ----
    ctx.save();
    ctx.translate(innerWidth / 2, innerHeight / 2);
    ctx.rotate(-player.heading);
    ctx.scale(viewScale, viewScale);
    ctx.translate(-player.x, -player.y);

    drawChartSea();
    drawSparkles(elapsed);
    drawWake(player);
    for (const en of enemies) drawWake(en);
    for (const en of enemies) drawShip(en, elapsed);
    drawShip(player, elapsed);
    for (const ball of cannonballs) drawCannonball(ball);
    for (const p of particles) drawParticle(p);

    ctx.restore();

    // ---- HUD ----
    const pct = Math.max(0, player.health / player.maxHealth) * 100;
    healthFill.style.width = pct + '%';
    healthFill.style.background = pct > 40 ? 'var(--brass-bright)' : 'var(--danger)';
    sailFill.style.width = Math.max(0, (player.sailHealth / player.maxSailHealth) * 100) + '%';
    crewFill.style.width = Math.max(0, (player.crew / player.maxCrew) * 100) + '%';
    speedValue.textContent = Math.round(player.speed * 1.9) + ' kn';
    scoreValue.textContent = score;
    windArrow.style.transform = `rotate(${((wind.angle - player.heading) * 180) / Math.PI}deg)`;
    headingArrow.style.transform = `rotate(${(-player.heading * 180) / Math.PI}deg)`;
    reloadLeftBar.style.width = (1 - player.reload.left / RELOAD_TIME) * 100 + '%';
    reloadRightBar.style.width = (1 - player.reload.right / RELOAD_TIME) * 100 + '%';

    damageFlash = Math.max(0, damageFlash - dt * 2);
    damageVignette.style.opacity = damageFlash * 0.55;
  }
}
requestAnimationFrame(animate);
