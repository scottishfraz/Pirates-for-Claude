// Broadside — a small open-sea sailing & cannon-combat prototype.
// Built with Three.js. No external art assets: ships, waves and effects
// are all generated from primitive geometry, shaders and canvas textures.

// ---------------------------------------------------------------------
// Wave function (shared shape between the GPU ocean shader and the CPU
// ship-bobbing code, so boats visually sit "in" the water they float on)
// ---------------------------------------------------------------------
const WAVES = [
  { dx: 0.857, dz: 0.514, amp: 0.9, k: 0.05, speed: 1.3 },
  { dx: -0.574, dz: 0.819, amp: 0.5, k: 0.09, speed: 0.9 },
  { dx: 0.316, dz: -0.949, amp: 0.3, k: 0.15, speed: 1.8 },
];

function waveHeight(x, z, t) {
  let h = 0;
  for (const w of WAVES) {
    h += w.amp * Math.sin((x * w.dx + z * w.dz) * w.k + t * w.speed);
  }
  return h;
}

const GLSL_WAVE_FUNC = `
  float waveHeight(vec2 p, float t) {
    float h = 0.0;
    h += 0.9 * sin(dot(p, vec2(0.857, 0.514)) * 0.05 + t * 1.3);
    h += 0.5 * sin(dot(p, vec2(-0.574, 0.819)) * 0.09 + t * 0.9);
    h += 0.3 * sin(dot(p, vec2(0.316, -0.949)) * 0.15 + t * 1.8);
    return h;
  }
`;

// ---------------------------------------------------------------------
// Scene / renderer / camera
// ---------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 3000);

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#6fa3c7');
  g.addColorStop(0.45, '#bcd6dd');
  g.addColorStop(0.6, '#e7dfc4');
  g.addColorStop(1, '#3a5a53');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = skyTexture();
scene.fog = new THREE.Fog(0xbcd6dd, 260, 1350);

const hemi = new THREE.HemisphereLight(0xdfeef5, 0x2c4a3f, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d6, 1.15);
sun.position.set(-220, 260, 140);
scene.add(sun);

// ---------------------------------------------------------------------
// Ocean
// ---------------------------------------------------------------------
const oceanGeo = new THREE.PlaneGeometry(4000, 4000, 120, 120);
const oceanMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x0e3446) },
    uShallow: { value: new THREE.Color(0x2f7a82) },
    uFoam: { value: new THREE.Color(0xdff1ea) },
    uSunDir: { value: new THREE.Vector3(-0.6, 0.7, 0.38).normalize() },
  },
  vertexShader: `
    uniform float uTime;
    varying float vHeight;
    varying vec3 vNormalFake;
    ${GLSL_WAVE_FUNC}
    void main() {
      vec2 p = position.xy;
      float h = waveHeight(p, uTime);
      float e = 2.0;
      float hx = waveHeight(p + vec2(e, 0.0), uTime);
      float hz = waveHeight(p + vec2(0.0, e), uTime);
      vec3 tangentX = normalize(vec3(e, hx - h, 0.0));
      vec3 tangentZ = normalize(vec3(0.0, hz - h, e));
      vNormalFake = normalize(cross(tangentZ, tangentX));
      vHeight = h;
      vec3 pos = vec3(position.x, position.y, h);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uDeep;
    uniform vec3 uShallow;
    uniform vec3 uFoam;
    uniform vec3 uSunDir;
    varying float vHeight;
    varying vec3 vNormalFake;
    void main() {
      float t = smoothstep(-0.4, 1.2, vHeight);
      vec3 base = mix(uDeep, uShallow, t);
      float diff = clamp(dot(vNormalFake, uSunDir), 0.0, 1.0);
      base += diff * 0.25;
      float foam = smoothstep(1.05, 1.55, vHeight);
      base = mix(base, uFoam, foam * 0.6);
      gl_FragColor = vec4(base, 1.0);
    }
  `,
});
const ocean = new THREE.Mesh(oceanGeo, oceanMat);
ocean.rotation.x = -Math.PI / 2;
scene.add(ocean);

// ---------------------------------------------------------------------
// Reusable canvas-generated textures (splash / spark / flag cloth)
// ---------------------------------------------------------------------
function radialTexture(inner, outer) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const splashTex = radialTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
const sparkTex = radialTexture('rgba(255,214,140,0.95)', 'rgba(120,40,20,0)');

// ---------------------------------------------------------------------
// Ship construction
// ---------------------------------------------------------------------
function hullGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 7.5);
  shape.quadraticCurveTo(2.6, 6.4, 3.0, 2.5);
  shape.lineTo(2.7, -5.5);
  shape.quadraticCurveTo(2.5, -7, 0, -7.2);
  shape.quadraticCurveTo(-2.5, -7, -2.7, -5.5);
  shape.lineTo(-3.0, 2.5);
  shape.quadraticCurveTo(-2.6, 6.4, 0, 7.5);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.6, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 2 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -1.3, 0);
  return geo;
}
const sharedHullGeo = hullGeometry();
const sharedDeckGeo = new THREE.BoxGeometry(4.6, 0.4, 12.5);

function createShip(faction) {
  const palette = faction === 'player'
    ? { hull: 0x5b3a24, deck: 0x8a6a45, sail: 0xece2c8, trim: 0x2f5a86, flag: 0x2f5a86 }
    : { hull: 0x3a2a26, deck: 0x4d3a30, sail: 0xcbb9a3, trim: 0x6a1f1a, flag: 0x6a1f1a };

  const group = new THREE.Group();

  const hull = new THREE.Mesh(sharedHullGeo, new THREE.MeshStandardMaterial({ color: palette.hull, roughness: 0.85 }));
  hull.scale.set(1.35, 1, 1.35);
  group.add(hull);

  const deck = new THREE.Mesh(sharedDeckGeo, new THREE.MeshStandardMaterial({ color: palette.deck, roughness: 0.9 }));
  deck.position.y = 0.9;
  group.add(deck);

  const trimGeo = new THREE.BoxGeometry(0.3, 1.0, 13.5);
  [-2.15, 2.15].forEach((xSide) => {
    const trim = new THREE.Mesh(trimGeo, new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.7 }));
    trim.position.set(xSide, 0.55, 0);
    group.add(trim);
  });

  function mast(z, height, sailWidth) {
    const m = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.2, height, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 })
    );
    pole.position.y = height / 2;
    m.add(pole);

    const sail = new THREE.Mesh(
      new THREE.PlaneGeometry(sailWidth, height * 0.72, 6, 1),
      new THREE.MeshStandardMaterial({ color: palette.sail, roughness: 0.6, side: THREE.DoubleSide })
    );
    sail.position.set(0, height * 0.58, 0);
    sail.userData.baseWidth = sailWidth;
    m.add(sail);
    m.userData.sail = sail;

    const yard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, sailWidth * 1.05, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a2a1c })
    );
    yard.rotation.z = Math.PI / 2;
    yard.position.set(0, height * 0.9, 0);
    m.add(yard);

    m.position.z = z;
    return m;
  }

  const mainMast = mast(-0.5, 9.5, 4.8);
  const foreMast = mast(4.6, 7, 3.4);
  group.add(mainMast, foreMast);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.8, 4, 1),
    new THREE.MeshStandardMaterial({ color: palette.flag, side: THREE.DoubleSide })
  );
  flag.position.set(0, 9.9, -0.5);
  group.add(flag);

  const bowsprit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.16, 4.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a3524 })
  );
  bowsprit.rotation.x = Math.PI / 2.6;
  bowsprit.position.set(0, 1.3, 8.6);
  group.add(bowsprit);

  const leftCannon = new THREE.Object3D();
  leftCannon.position.set(-2.9, 0.9, 0);
  const rightCannon = new THREE.Object3D();
  rightCannon.position.set(2.9, 0.9, 0);
  group.add(leftCannon, rightCannon);

  group.userData = {
    faction,
    health: 100,
    maxHealth: 100,
    speed: 0,
    throttle: faction === 'player' ? 0 : 0.55,
    heading: 0,
    leftCannon, rightCannon,
    reload: { left: 0, right: 0 },
    sails: [mainMast.userData.sail, foreMast.userData.sail],
    state: 'active',
    sinkTimer: 0,
    aiState: 'patrol',
    aiTimer: Math.random() * 3,
  };
  return group;
}

// ---------------------------------------------------------------------
// Player + enemies
// ---------------------------------------------------------------------
const player = createShip('player');
player.position.set(0, 0, 0);
scene.add(player);

const enemies = [];
const MAX_ENEMIES = 3;

function spawnEnemy() {
  const ship = createShip('enemy');
  const angle = Math.random() * Math.PI * 2;
  const dist = 160 + Math.random() * 90;
  ship.position.set(
    player.position.x + Math.cos(angle) * dist,
    0,
    player.position.z + Math.sin(angle) * dist
  );
  ship.userData.heading = Math.random() * Math.PI * 2;
  scene.add(ship);
  enemies.push(ship);
}
for (let i = 0; i < MAX_ENEMIES; i++) spawnEnemy();

// ---------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------
const wind = { angle: Math.random() * Math.PI * 2 };
function windDir() {
  return new THREE.Vector2(Math.sin(wind.angle), Math.cos(wind.angle));
}

// ---------------------------------------------------------------------
// Cannonballs & particles
// ---------------------------------------------------------------------
const ballGeo = new THREE.SphereGeometry(0.35, 8, 8);
const ballMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c });
const cannonballs = [];
const particles = [];

function fireCannon(ship, side) {
  const data = ship.userData;
  if (data.reload[side] > 0) return;
  data.reload[side] = 1.6;

  const mount = side === 'left' ? data.leftCannon : data.rightCannon;
  const worldPos = new THREE.Vector3();
  mount.getWorldPosition(worldPos);

  const forward = new THREE.Vector3(Math.sin(data.heading), 0, Math.cos(data.heading));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const outward = side === 'left' ? right.clone().negate() : right.clone();

  const ball = new THREE.Mesh(ballGeo, ballMat);
  ball.position.copy(worldPos);
  const speed = 46;
  const velocity = outward.multiplyScalar(speed)
    .addScaledVector(forward, data.speed * 0.6)
    .add(new THREE.Vector3(0, 11, 0));
  ball.userData = { velocity, owner: ship, life: 3.2 };
  scene.add(ball);
  cannonballs.push(ball);

  spawnMuzzleSpark(worldPos);
  if (ship === player) log('You fire the ' + side + ' broadside.');
}

function spawnSplash(pos) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: splashTex, transparent: true, depthWrite: false }));
  sprite.position.copy(pos);
  sprite.scale.set(1, 1, 1);
  sprite.userData = { life: 0.6, grow: 6 };
  scene.add(sprite);
  particles.push(sprite);
}
function spawnMuzzleSpark(pos) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, transparent: true, depthWrite: false }));
  sprite.position.copy(pos);
  sprite.scale.set(2, 2, 2);
  sprite.userData = { life: 0.35, grow: 3 };
  scene.add(sprite);
  particles.push(sprite);
}

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
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

// ---------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const healthFill = el('healthFill');
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

if (isTouch) {
  el('touchControls').classList.remove('hidden');
  el('portKeyHint').textContent = 'Tap — Port';
  el('starboardKeyHint').textContent = 'Tap — Starboard';
  el('controlsHint').innerHTML =
    '<div><b>Left stick</b> — trim sails &amp; steer</div>' +
    '<div><b>Port / Stbd</b> buttons — fire cannons</div>';
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
  player.userData.health = player.userData.maxHealth;
  player.userData.throttle = 0;
  player.userData.speed = 0;
  player.position.set(0, 0, 0);
  player.userData.heading = 0;
  messages.length = 0;
  log('Anchors aweigh. Q/E fire cannons, arrows to sail.');
  for (const en of enemies) scene.remove(en);
  enemies.length = 0;
  for (let i = 0; i < MAX_ENEMIES; i++) spawnEnemy();
}

function gameOver() {
  gameState = 'gameover';
  finalScoreValue.textContent = score;
  gameOverScreen.classList.remove('hidden');
}

// ---------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------
const clock = new THREE.Clock();

function updateShipPhysics(ship, dt) {
  const data = ship.userData;
  const forward = new THREE.Vector2(Math.sin(data.heading), Math.cos(data.heading));
  const alignment = forward.dot(windDir());
  const windMultiplier = THREE.MathUtils.lerp(0.4, 1.35, (alignment + 1) / 2);
  const maxSpeed = 26;
  const targetSpeed = data.throttle * maxSpeed * windMultiplier;
  data.speed += (targetSpeed - data.speed) * Math.min(1, dt * 1.2);

  ship.position.x += forward.x * data.speed * dt;
  ship.position.z += forward.y * data.speed * dt;
  ship.rotation.y = data.heading;

  const h = waveHeight(ship.position.x, ship.position.z, clock.elapsedTime);
  ship.position.y = h * 0.5;
  ship.rotation.z = Math.sin(clock.elapsedTime * 1.1 + ship.position.x * 0.05) * 0.035;
  ship.rotation.x = Math.sin(clock.elapsedTime * 0.9 + ship.position.z * 0.05) * 0.02;

  for (const sail of data.sails) {
    const trim = THREE.MathUtils.clamp(data.throttle * windMultiplier, 0.15, 1);
    sail.scale.x = trim;
  }

  data.reload.left = Math.max(0, data.reload.left - dt);
  data.reload.right = Math.max(0, data.reload.right - dt);
}

function updateEnemyAI(ship, dt) {
  const data = ship.userData;
  const toPlayer = new THREE.Vector2(player.position.x - ship.position.x, player.position.z - ship.position.z);
  const dist = toPlayer.length();
  data.aiTimer -= dt;

  if (data.aiState === 'patrol') {
    data.throttle = 0.35;
    if (data.aiTimer <= 0) {
      data.heading += (Math.random() - 0.5) * 1.2;
      data.aiTimer = 2 + Math.random() * 3;
    }
    if (dist < 210) data.aiState = 'hunt';
  } else if (data.aiState === 'hunt') {
    data.throttle = 0.85;
    const desired = Math.atan2(toPlayer.x, toPlayer.y);
    data.heading = turnToward(data.heading, desired, dt * 1.1);
    if (dist < 130) data.aiState = 'engage';
    if (dist > 260) data.aiState = 'patrol';
  } else if (data.aiState === 'engage') {
    data.throttle = 0.55;
    const desired = Math.atan2(toPlayer.x, toPlayer.y) + Math.PI / 2;
    data.heading = turnToward(data.heading, desired, dt * 0.8);
    if (dist > 200) data.aiState = 'hunt';

    const forward = new THREE.Vector2(Math.sin(data.heading), Math.cos(data.heading));
    const right = new THREE.Vector2(forward.y, -forward.x);
    const side = right.dot(toPlayer) > 0 ? 'right' : 'left';
    if (dist < 150 && data.reload[side] <= 0 && Math.random() < 0.7) {
      fireCannon(ship, side);
    }
  }
}

function turnToward(current, target, maxDelta) {
  let diff = ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const clamped = THREE.MathUtils.clamp(diff, -maxDelta, maxDelta);
  return current + clamped;
}

function sinkShip(ship, dt) {
  const data = ship.userData;
  data.sinkTimer += dt;
  ship.position.y -= dt * 3;
  ship.rotation.z += dt * 0.6;
  ship.rotation.x += dt * 0.25;
  ship.scale.multiplyScalar(1 - dt * 0.15);
  if (data.sinkTimer > 3) {
    scene.remove(ship);
    const idx = enemies.indexOf(ship);
    if (idx >= 0) enemies.splice(idx, 1);
  }
}

let damageFlash = 0;

function checkCannonballHits(ball, dt) {
  const targets = ball.userData.owner === player ? enemies : [player];
  for (const target of targets) {
    if (target.userData.state !== 'active') continue;
    const dx = ball.position.x - target.position.x;
    const dz = ball.position.z - target.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < 6.5 * 6.5 && ball.position.y < 4.5) {
      target.userData.health -= 18;
      spawnMuzzleSpark(ball.position.clone());
      scene.remove(ball);
      cannonballs.splice(cannonballs.indexOf(ball), 1);
      if (target === player) {
        damageFlash = 1;
        log('Your hull shudders under fire!');
      } else {
        log('A direct hit on the enemy vessel!');
      }
      if (target.userData.health <= 0 && target.userData.state === 'active') {
        target.userData.state = 'sinking';
        if (target === player) {
          gameOver();
        } else {
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

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  oceanMat.uniforms.uTime.value = t;

  if (gameState === 'playing') {
    let turnInput = 0;
    let throttleInput = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) turnInput -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) turnInput += 1;
    if (keys['ArrowUp'] || keys['KeyW']) throttleInput += 1;
    if (keys['ArrowDown'] || keys['KeyS']) throttleInput -= 1;
    if (joystick.active) {
      turnInput += joystick.dx;
      throttleInput -= joystick.dy;
    }
    turnInput = THREE.MathUtils.clamp(turnInput, -1, 1);
    throttleInput = THREE.MathUtils.clamp(throttleInput, -1, 1);
    player.userData.heading += turnInput * dt * 0.9;
    player.userData.throttle = THREE.MathUtils.clamp(player.userData.throttle + throttleInput * dt * 0.6, 0, 1);

    updateShipPhysics(player, dt);
    for (const en of enemies) {
      if (en.userData.state === 'active') {
        updateEnemyAI(en, dt);
        updateShipPhysics(en, dt);
      } else if (en.userData.state === 'sinking') {
        sinkShip(en, dt);
      }
    }

    for (let i = cannonballs.length - 1; i >= 0; i--) {
      const ball = cannonballs[i];
      ball.userData.velocity.y -= 24 * dt;
      ball.position.addScaledVector(ball.userData.velocity, dt);
      ball.userData.life -= dt;
      const seaLevel = waveHeight(ball.position.x, ball.position.z, t) * 0.5;
      if (checkCannonballHits(ball, dt)) continue;
      if (ball.position.y <= seaLevel || ball.userData.life <= 0) {
        spawnSplash(ball.position.clone().setY(seaLevel));
        scene.remove(ball);
        cannonballs.splice(i, 1);
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.userData.life -= dt;
      p.scale.addScalar(p.userData.grow * dt);
      p.material.opacity = Math.max(0, p.userData.life * 2);
      if (p.userData.life <= 0) { scene.remove(p); particles.splice(i, 1); }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      messages[i].life -= dt;
      if (messages[i].life <= 0) messages.splice(i, 1);
    }
    renderLog();

    // camera follow
    const camOffset = new THREE.Vector3(
      -Math.sin(player.userData.heading) * 28,
      13,
      -Math.cos(player.userData.heading) * 28
    );
    const desiredCamPos = player.position.clone().add(camOffset);
    camera.position.lerp(desiredCamPos, 1 - Math.pow(0.001, dt));
    camera.lookAt(player.position.clone().add(new THREE.Vector3(0, 3, 0)));

    // HUD
    const pct = Math.max(0, player.userData.health / player.userData.maxHealth) * 100;
    healthFill.style.width = pct + '%';
    healthFill.style.background = pct > 40 ? 'var(--brass-bright)' : 'var(--danger)';
    speedValue.textContent = Math.round(player.userData.speed * 1.9) + ' kn';
    scoreValue.textContent = score;
    windArrow.style.transform = `rotate(${(wind.angle * 180) / Math.PI}deg)`;
    headingArrow.style.transform = `rotate(${(player.userData.heading * 180) / Math.PI}deg)`;
    reloadLeftBar.style.width = (1 - player.userData.reload.left / 1.6) * 100 + '%';
    reloadRightBar.style.width = (1 - player.userData.reload.right / 1.6) * 100 + '%';

    damageFlash = Math.max(0, damageFlash - dt * 2);
    damageVignette.style.opacity = damageFlash * 0.55;
  }

  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setSize(innerWidth, innerHeight);
camera.position.set(0, 13, -28);

animate();
