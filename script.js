const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const BASE_W = 400;
const BASE_H = 600;
const ROAD_L = 55;
const ROAD_R = 345;
const ROAD_W = ROAD_R - ROAD_L;
const LANE_W = ROAD_W / 3;
const LANES = [ROAD_L + LANE_W * 0.5, ROAD_L + LANE_W * 1.5, ROAD_L + LANE_W * 2.5];
const TOTAL_LAPS = 3;
const LAP_DIST = 2400;
const BASE_SPEED = 4.5;
const S = { TITLE: 0, READY: 1, RACE: 2, LAP_FLASH: 3, FINISH_ANIM: 4, RESULT: 5 };
const P = { x: 0, y: BASE_H - 90, w: 28, h: 46, lane: 1, targetX: 0, alive: true };
const BGM_SEQ = [
  220, 0, 262, 0, 330, 0, 392, 0,
  349, 0, 330, 0, 294, 0, 262, 0,
  220, 0, 262, 0, 330, 0, 440, 0,
  392, 0, 0, 0, 0, 0, 0, 0
];

let scale = 1;
let state = S.TITLE;
let audioCtx = null;
let engineOsc = null;
let engineGain = null;
let bgmInterval = null;
let bgmIdx = 0;
let scrollY = 0;
let dashOff = 0;
let totalDist = 0;
let curLap = 0;
let lapStartT = 0;
let lapTimes = [];
let gameSpeed = BASE_SPEED;
let cars = [];
let particles = [];
let stars = [];
let spawnTimer = 0;
let overlayTimer = 0;
let readyCount = 3;
let readyPulse = 0;
let flashMsg = '';
let crashShake = 0;
let penaltyTimer = 0;
let lastTS = 0;
let touchSX = 0;
let lastTouchEnd = 0;
let bestTime = null;

const art = {
  starmap: loadImage('puzzle_starmap.png'),
  blackboard: loadImage('puzzle_blackboard.png'),
  shadow: loadImage('fx_shadow.png'),
  button: loadImage('ui_choice_btn_active.png')
};

try {
  bestTime = parseFloat(localStorage.getItem('nr85_best')) || null;
} catch (e) {}

for (let i = 0; i < 80; i++) {
  stars.push({ x: Math.random() * BASE_W, y: Math.random() * BASE_H, s: Math.random() * 2 + 0.5, b: Math.random() });
}

function resizeCanvas() {
  const maxW = Math.min(window.innerWidth, 480);
  const maxH = window.innerHeight;
  scale = Math.min(maxW / BASE_W, maxH / BASE_H, 1.5);
  canvas.width = BASE_W;
  canvas.height = BASE_H;
  canvas.style.width = `${BASE_W * scale}px`;
  canvas.style.height = `${BASE_H * scale}px`;
}

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}

function hasImage(img) {
  return !!(img && img.complete && img.naturalWidth);
}

function drawImage(img, x, y, w, h, alpha = 1) {
  if (!hasImage(img)) return false;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
  return true;
}

function drawStarfield(alphaMin = 0.3, alphaAmp = 0.7) {
  stars.forEach((s) => {
    ctx.globalAlpha = alphaMin + alphaAmp * (Math.sin(s.b * Math.PI * 2) * 0.5 + 0.5);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(s.x, s.y, s.s, s.s);
  });
  ctx.globalAlpha = 1;
}

function drawLorePanel(x, y, w, h, title, lines) {
  ctx.save();
  if (hasImage(art.blackboard)) {
    drawImage(art.blackboard, x, y, w, h, 0.32);
    ctx.fillStyle = 'rgba(2, 12, 16, 0.68)';
  } else {
    ctx.fillStyle = 'rgba(0, 18, 22, 0.84)';
  }
  ctx.strokeStyle = 'rgba(122, 200, 210, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9EEAFF';
  ctx.font = 'bold 11px "Courier New"';
  ctx.fillText(title, x + 14, y + 20);
  ctx.fillStyle = '#D8F7FF';
  ctx.font = '10px "Courier New"';
  lines.forEach((line, i) => ctx.fillText(line, x + 14, y + 40 + i * 18));
  ctx.restore();
}

function drawPromptButton(y, text) {
  const x = 82;
  const w = 236;
  const h = 84;
  if (hasImage(art.button)) {
    drawImage(art.button, x, y, w, h, 0.95);
  } else {
    ctx.save();
    ctx.fillStyle = 'rgba(12, 20, 32, 0.88)';
    ctx.strokeStyle = 'rgba(130, 164, 188, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#101722';
  ctx.font = 'bold 11px "Courier New"';
  ctx.fillText('TAP OR PRESS A KEY', BASE_W / 2, y + 28);
  if (Math.floor(Date.now() / 550) % 2 === 0) {
    ctx.fillStyle = '#DDF7FF';
    ctx.shadowColor = '#FFFFFF';
    ctx.shadowBlur = 8;
    ctx.font = 'bold 16px "Courier New"';
    ctx.fillText(text, BASE_W / 2, y + 54);
  }
  ctx.restore();
}

function drawStarmapBackdrop(alpha = 0.16, rotate = 0) {
  if (!hasImage(art.starmap)) return;
  ctx.save();
  ctx.translate(BASE_W / 2, BASE_H / 2);
  ctx.rotate(rotate);
  ctx.globalAlpha = alpha;
  ctx.drawImage(art.starmap, -230, -230, 460, 460);
  ctx.restore();
}

function getTraceProgress() {
  return Math.min(totalDist / (LAP_DIST * TOTAL_LAPS), 1);
}

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playBeep(freq, dur, type = 'square', vol = 0.15) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(vol, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}

function startEngine() {
  if (!audioCtx || engineOsc) return;
  engineOsc = audioCtx.createOscillator();
  engineGain = audioCtx.createGain();
  const dist = audioCtx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = (Math.PI + 200) * x / (Math.PI + 200 * Math.abs(x));
  }
  dist.curve = curve;
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 80;
  engineGain.gain.value = 0.04;
  engineOsc.connect(dist);
  dist.connect(engineGain);
  engineGain.connect(audioCtx.destination);
  engineOsc.start();
}

function stopEngine() {
  if (!engineOsc) return;
  try {
    engineOsc.stop();
  } catch (e) {}
  engineOsc = null;
  engineGain = null;
}

function updateEngineSound(speed) {
  if (engineOsc) engineOsc.frequency.value = 55 + speed * 12;
}

function playCrash() {
  if (!audioCtx) return;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.25, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) * 0.8;
  const src = audioCtx.createBufferSource();
  const g = audioCtx.createGain();
  g.gain.value = 0.4;
  src.buffer = buf;
  src.connect(g);
  g.connect(audioCtx.destination);
  src.start();
}

function playLapComplete() {
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playBeep(f, 0.2, 'square', 0.25), i * 80));
}

function playFinish() {
  [523, 659, 784, 880, 1047, 1319].forEach((f, i) => setTimeout(() => playBeep(f, 0.25, 'square', 0.2), i * 100));
}

function playCountBeep(n) {
  playBeep(n > 0 ? 440 : 880, 0.15, 'square', 0.3);
}

function startBGM() {
  if (bgmInterval || !audioCtx) return;
  bgmIdx = 0;
  bgmInterval = setInterval(() => {
    if (BGM_SEQ[bgmIdx] > 0) playBeep(BGM_SEQ[bgmIdx], 0.12, 'triangle', 0.06);
    bgmIdx = (bgmIdx + 1) % BGM_SEQ.length;
  }, 130);
}

function stopBGM() {
  if (bgmInterval) {
    clearInterval(bgmInterval);
    bgmInterval = null;
  }
}

function handleKey(code) {
  if (state === S.TITLE || state === S.RESULT) {
    initAudio();
    startGame();
    return;
  }
  if ((state === S.RACE || state === S.READY) && (code === 'ArrowLeft' || code === 'KeyA') && P.lane > 0) moveLane(-1);
  if ((state === S.RACE || state === S.READY) && (code === 'ArrowRight' || code === 'KeyD') && P.lane < 2) moveLane(1);
}

function moveLane(d) {
  P.lane += d;
  P.targetX = LANES[P.lane];
}

function startGame() {
  state = S.READY;
  overlayTimer = 180;
  readyCount = 3;
  readyPulse = 0;
  curLap = 0;
  lapTimes = [];
  totalDist = 0;
  scrollY = 0;
  dashOff = 0;
  gameSpeed = BASE_SPEED;
  cars = [];
  particles = [];
  spawnTimer = 0;
  penaltyTimer = 0;
  P.lane = 1;
  P.x = LANES[1];
  P.targetX = LANES[1];
  P.alive = true;
  crashShake = 0;
  startEngine();
  startBGM();
  playCountBeep(3);
}

function spawnCar() {
  const lane = Math.floor(Math.random() * 3);
  const oncoming = Math.random() < 0.38;
  const palette = oncoming ? ['#FF3333', '#FF6600', '#FF2266', '#FFAA00'] : ['#FFEE00', '#AAFF00', '#00FFEE', '#FF88FF'];
  cars.push({
    x: LANES[lane],
    y: -60,
    w: 26,
    h: 44,
    lane,
    spd: oncoming ? gameSpeed * 1.7 + 1 : gameSpeed * 0.45,
    oncoming,
    color: palette[Math.floor(Math.random() * palette.length)],
    shadow: '#FFFFFF'
  });
}

function spawnParticles(x, y, count = 18) {
  const cols = ['#FF4444', '#FF8800', '#FFFF00', '#FFFFFF', '#FF00AA'];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 2 + Math.random() * 5;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      life: 1,
      maxLife: 0.6 + Math.random() * 0.4,
      size: 3 + Math.random() * 4,
      color: cols[Math.floor(Math.random() * cols.length)]
    });
  }
}

function update(ts) {
  const raw = (ts - lastTS) / 16.67;
  const dt = Math.min(raw || 1, 3);
  lastTS = ts;
  const scrollSpd = state === S.RACE ? gameSpeed : (state === S.LAP_FLASH || state === S.FINISH_ANIM ? gameSpeed * 0.25 : gameSpeed * 0.15);
  scrollY += scrollSpd * dt;
  dashOff = (dashOff + scrollSpd * dt) % 60;
  if (crashShake > 0) crashShake = Math.max(0, crashShake - 0.5 * dt);

  particles.forEach((p) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 0.15 * dt;
    p.life -= dt / (p.maxLife * 60);
  });
  particles = particles.filter((p) => p.life > 0);
  stars.forEach((s) => { s.b = (s.b + 0.005) % 1; });

  if (state === S.TITLE || state === S.RESULT) return;
  if (state === S.READY) {
    overlayTimer -= dt;
    readyPulse += dt;
    const sec = Math.ceil(overlayTimer / 60);
    if (sec !== readyCount && sec > 0) {
      readyCount = sec;
      playCountBeep(sec);
    }
    if (overlayTimer <= 0) {
      state = S.RACE;
      lapStartT = performance.now();
      playCountBeep(0);
    }
    return;
  }
  if (state === S.LAP_FLASH) {
    overlayTimer -= dt;
    if (overlayTimer <= 0) {
      state = S.RACE;
      lapStartT = performance.now();
    }
    return;
  }
  if (state === S.FINISH_ANIM) {
    overlayTimer -= dt;
    if (overlayTimer <= 0) {
      state = S.RESULT;
      stopEngine();
      stopBGM();
    }
    return;
  }
  if (penaltyTimer > 0) {
    penaltyTimer -= dt;
    gameSpeed = Math.min(gameSpeed + 0.08 * dt, BASE_SPEED + curLap * 0.6 + Math.min(totalDist / LAP_DIST, 1) * 1.5);
  } else {
    gameSpeed = Math.min(BASE_SPEED + curLap * 0.6 + (totalDist % LAP_DIST) / LAP_DIST * 1.5, 14);
  }
  updateEngineSound(gameSpeed);
  totalDist += gameSpeed * dt;

  if (totalDist / LAP_DIST >= curLap + 1) {
    const lt = (performance.now() - lapStartT) / 1000;
    lapTimes.push(lt);
    curLap++;
    if (curLap >= TOTAL_LAPS) {
      const tot = lapTimes.reduce((a, b) => a + b, 0);
      try {
        if (!bestTime || tot < bestTime) {
          bestTime = tot;
          localStorage.setItem('nr85_best', tot);
        }
      } catch (e) {}
      playFinish();
      state = S.FINISH_ANIM;
      overlayTimer = 150;
    } else {
      playLapComplete();
      state = S.LAP_FLASH;
      overlayTimer = 100;
      flashMsg = `SECTOR ${curLap} LOCKED`;
    }
  }

  P.x += (P.targetX - P.x) * 0.25 * dt;
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnCar();
    spawnTimer = Math.max(20, 50 - gameSpeed * 2) + Math.random() * 25;
  }

  cars.forEach((car) => {
    car.y += (car.oncoming ? car.spd + gameSpeed : gameSpeed - car.spd) * dt;
  });
  cars = cars.filter((c) => c.y < BASE_H + 80);

  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i];
    if (Math.abs(P.x - c.x) < (P.w + c.w) / 2 - 3 && Math.abs(P.y - c.y) < (P.h + c.h) / 2 - 3) {
      playCrash();
      spawnParticles(P.x, P.y);
      crashShake = 12;
      gameSpeed = Math.max(gameSpeed * 0.2, 1);
      penaltyTimer = 60;
      cars.splice(i, 1);
      break;
    }
  }
}

function draw() {
  const sx = crashShake > 0 ? (Math.random() - 0.5) * crashShake : 0;
  const sy = crashShake > 0 ? (Math.random() - 0.5) * crashShake * 0.5 : 0;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = '#000514';
  ctx.fillRect(-10, -10, BASE_W + 20, BASE_H + 20);
  if (state === S.TITLE) {
    drawTitle();
    ctx.restore();
    return;
  }
  if (state === S.RESULT) {
    drawResult();
    ctx.restore();
    return;
  }
  drawRoad();
  drawCars();
  drawPlayerCar();
  drawParticles();
  drawHUD();
  if (state === S.READY) drawReadyOverlay();
  if (state === S.LAP_FLASH) drawLapFlash();
  if (state === S.FINISH_ANIM) drawFinishAnim();
  ctx.restore();
}

function drawRoad() {
  ctx.fillStyle = '#001A00';
  ctx.fillRect(0, 0, ROAD_L, BASE_H);
  ctx.fillRect(ROAD_R, 0, BASE_W - ROAD_R, BASE_H);
  ctx.fillStyle = '#002800';
  for (let y = -(scrollY % 80); y < BASE_H + 80; y += 80) {
    ctx.fillRect(0, y, ROAD_L, 40);
    ctx.fillRect(ROAD_R, y, BASE_W - ROAD_R, 40);
  }

  const roadGrad = ctx.createLinearGradient(ROAD_L, 0, ROAD_R, 0);
  roadGrad.addColorStop(0, '#161625');
  roadGrad.addColorStop(0.5, '#13253B');
  roadGrad.addColorStop(1, '#161625');
  ctx.fillStyle = roadGrad;
  ctx.fillRect(ROAD_L, 0, ROAD_W, BASE_H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ROAD_L, 0, ROAD_W, BASE_H);
  ctx.clip();
  drawStarmapBackdrop(0.07, 0);
  ctx.restore();

  ctx.fillStyle = 'rgba(130, 200, 255, 0.04)';
  for (let y = -(scrollY * 1.5 % 72); y < BASE_H + 72; y += 72) {
    ctx.fillRect(ROAD_L + 10, y, ROAD_W - 20, 1);
  }

  const sh = 36;
  for (let y = -(scrollY % (sh * 2)); y < BASE_H + sh * 2; y += sh * 2) {
    ctx.fillStyle = '#CC1111';
    ctx.fillRect(ROAD_L - 7, y, 7, sh);
    ctx.fillRect(ROAD_R, y, 7, sh);
    ctx.fillStyle = '#DDDDDD';
    ctx.fillRect(ROAD_L - 7, y + sh, 7, sh);
    ctx.fillRect(ROAD_R, y + sh, 7, sh);
  }

  ctx.save();
  ctx.strokeStyle = '#FFEE00';
  ctx.lineWidth = 2;
  ctx.setLineDash([28, 28]);
  ctx.lineDashOffset = -dashOff;
  ctx.beginPath();
  ctx.moveTo(ROAD_L + ROAD_W / 2, 0);
  ctx.lineTo(ROAD_L + ROAD_W / 2, BASE_H);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([20, 40]);
  ctx.lineDashOffset = -dashOff;
  [ROAD_L + LANE_W, ROAD_L + LANE_W * 2].forEach((lx) => {
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, BASE_H);
    ctx.stroke();
  });
  ctx.restore();
}

function drawCarSprite(x, y, w, h, color, oncoming) {
  ctx.save();
  ctx.translate(x, y);
  if (oncoming) ctx.scale(1, -1);
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 3);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(-w / 2 + 4, -h / 2 + 8, w - 8, h * 0.35);
  ctx.fillStyle = 'rgba(140,200,255,0.7)';
  ctx.fillRect(-w / 2 + 5, -h / 2 + 9, w - 10, h * 0.25);
  ctx.fillStyle = '#FFFFAA';
  ctx.shadowColor = '#FFFFAA';
  ctx.shadowBlur = 6;
  ctx.fillRect(-w / 2 + 2, -h / 2 + 2, 7, 4);
  ctx.fillRect(w / 2 - 9, -h / 2 + 2, 7, 4);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#FF1111';
  ctx.shadowColor = '#FF1111';
  ctx.shadowBlur = 5;
  ctx.fillRect(-w / 2 + 2, h / 2 - 6, 6, 4);
  ctx.fillRect(w / 2 - 8, h / 2 - 6, 6, 4);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#111';
  [[-w / 2 - 3, -h / 5], [w / 2 - 1, -h / 5], [-w / 2 - 3, h / 5 - 4], [w / 2 - 1, h / 5 - 4]].forEach(([wx, wy]) => {
    ctx.fillRect(wx, wy, 4, 9);
    ctx.fillStyle = '#333';
    ctx.fillRect(wx + 1, wy + 1, 2, 7);
    ctx.fillStyle = '#111';
  });
  ctx.restore();
}

function drawCars() {
  cars.forEach((c) => drawCarSprite(c.x, c.y, c.w, c.h, c.color, c.oncoming));
}

function drawPlayerCar() {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(P.x + 4, P.y + 2, P.w / 2 + 2, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  drawCarSprite(P.x, P.y, P.w, P.h, '#00FFCC', false);
  ctx.save();
  ctx.shadowColor = '#00FFCC';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = 'rgba(0,255,200,0.3)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(P.x - P.w / 2 - 3, P.y - P.h / 2 - 3, P.w + 6, P.h + 6, 5);
  ctx.stroke();
  ctx.restore();
}

function drawParticles() {
  particles.forEach((p) => {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.restore();
  });
}

function drawHUD() {
  const trace = getTraceProgress();
  const barGrad = ctx.createLinearGradient(0, 0, 0, 58);
  barGrad.addColorStop(0, 'rgba(0,5,20,0.96)');
  barGrad.addColorStop(1, 'rgba(0,5,20,0)');
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, 0, BASE_W, 58);

  ctx.font = 'bold 13px "Courier New"';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFEE00';
  ctx.shadowColor = '#FFEE00';
  ctx.shadowBlur = 6;
  ctx.fillText(`LAP ${Math.min(curLap + 1, TOTAL_LAPS)}/${TOTAL_LAPS}`, 12, 18);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#00FFCC';
  ctx.shadowColor = '#00FFCC';
  ctx.shadowBlur = 5;
  ctx.fillText(fmtTime(state === S.RACE ? (performance.now() - lapStartT) / 1000 : 0), BASE_W / 2, 18);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#FF8800';
  ctx.shadowColor = '#FF8800';
  ctx.shadowBlur = 5;
  ctx.fillText(`${Math.floor(gameSpeed * 28)} km/h`, BASE_W - 12, 18);
  ctx.shadowBlur = 0;

  ctx.font = '10px "Courier New"';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8EA6B8';
  ctx.fillText('STAR TRACE', 12, 34);
  if (bestTime) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FF88FF';
    ctx.fillText(`BEST ${fmtTime(bestTime)}`, BASE_W / 2, 34);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9EEAFF';
  ctx.fillText(`${Math.floor(trace * 100)}%`, BASE_W - 12, 34);

  ctx.fillStyle = '#111';
  ctx.fillRect(12, 42, BASE_W - 24, 6);
  const traceW = trace * (BASE_W - 24);
  const traceGrad = ctx.createLinearGradient(12, 0, 12 + Math.max(traceW, 1), 0);
  traceGrad.addColorStop(0, '#00FFCC');
  traceGrad.addColorStop(0.6, '#7FDBFF');
  traceGrad.addColorStop(1, '#FFEE88');
  ctx.fillStyle = traceGrad;
  ctx.shadowColor = '#9EEAFF';
  ctx.shadowBlur = 5;
  ctx.fillRect(12, 42, traceW, 6);
  ctx.shadowBlur = 0;

  [1, 2, 3].forEach((i) => {
    const x = 12 + (BASE_W - 24) * (i / 3);
    ctx.fillStyle = i <= curLap ? '#FFEE00' : '#334455';
    ctx.beginPath();
    ctx.arc(x, 45, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  if (hasImage(art.starmap)) drawImage(art.starmap, BASE_W - 62, 7, 46, 46, 0.16 + trace * 0.14);

  ctx.font = '10px "Courier New"';
  ctx.textAlign = 'right';
  lapTimes.forEach((t, i) => {
    ctx.fillStyle = i === lapTimes.length - 1 ? '#FFEE00' : '#555577';
    ctx.fillText(`L${i + 1}:${fmtTime(t)}`, BASE_W - 12, BASE_H - 12 - (lapTimes.length - 1 - i) * 14);
  });
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

function drawTitle() {
  ctx.fillStyle = '#000514';
  ctx.fillRect(0, 0, BASE_W, BASE_H);
  drawStarmapBackdrop(0.18, Math.sin(Date.now() * 0.00008) * 0.08);
  if (hasImage(art.shadow)) drawImage(art.shadow, -20, 20, 440, 440, 0.14);
  drawStarfield();

  ctx.fillStyle = '#121B30';
  ctx.fillRect(ROAD_L, 0, ROAD_W, BASE_H);
  const hor = ctx.createLinearGradient(0, 260, 0, 340);
  hor.addColorStop(0, 'rgba(255,100,0,0)');
  hor.addColorStop(0.5, 'rgba(255,80,0,0.2)');
  hor.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = hor;
  ctx.fillRect(0, 260, BASE_W, 80);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 52px "Courier New"';
  ctx.shadowColor = '#FF4400';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#FF6600';
  ctx.fillText('NIGHT', BASE_W / 2, 150);
  ctx.fillStyle = '#FF4400';
  ctx.fillText('RACER', BASE_W / 2, 208);
  ctx.shadowColor = '#FFEE00';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#FFEE00';
  ctx.font = 'bold 26px "Courier New"';
  ctx.fillText("'85", BASE_W / 2, 242);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#9EEAFF';
  ctx.font = '12px "Courier New"';
  ctx.fillText('ASTRAL CIRCUIT TIME ATTACK', BASE_W / 2, 274);
  ctx.fillStyle = '#62738D';
  ctx.font = '10px "Courier New"';
  ctx.fillText('TRACE THE CONSTELLATION BEFORE DAWN', BASE_W / 2, 294);
  ctx.restore();

  drawLorePanel(22, 324, 356, 112, 'STAR ROUTE BRIEFING', [
    'LEFT / RIGHT / A / D : CHANGE LANE',
    'COMPLETE 3 LAPS TO LOCK EACH SECTOR',
    'AVOID ONCOMING CARS AND KEEP THE SIGNAL'
  ]);

  if (bestTime) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FF88FF';
    ctx.shadowColor = '#FF88FF';
    ctx.shadowBlur = 6;
    ctx.font = 'bold 13px "Courier New"';
    ctx.fillText(`ARCHIVE BEST  ${fmtTime(bestTime)}`, BASE_W / 2, 460);
    ctx.shadowBlur = 0;
  }

  drawPromptButton(466, 'TRACE ROUTE');
  ctx.fillStyle = '#334455';
  ctx.font = '9px "Courier New"';
  ctx.textAlign = 'center';
  ctx.fillText('© 1985  TITAN ELECTRONICS  STAR MAP ARCHIVE', BASE_W / 2, 558);
}

function drawReadyOverlay() {
  ctx.fillStyle = 'rgba(0,5,20,0.74)';
  ctx.fillRect(0, BASE_H / 2 - 90, BASE_W, 180);
  drawStarmapBackdrop(0.14, 0);
  ctx.textAlign = 'center';
  ctx.font = 'bold 15px "Courier New"';
  ctx.fillStyle = '#AACCFF';
  ctx.fillText('ALIGNING THE NIGHT SKY', BASE_W / 2, BASE_H / 2 - 28);
  const sec = Math.ceil(overlayTimer / 60);
  const pulse = 1 + Math.sin(readyPulse * 0.3) * 0.15;
  ctx.save();
  ctx.translate(BASE_W / 2, BASE_H / 2 + 34);
  ctx.scale(pulse, pulse);
  ctx.font = 'bold 64px "Courier New"';
  ctx.fillStyle = sec === 1 ? '#FF4444' : '#FFEE00';
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 20;
  ctx.fillText(sec > 0 ? sec : 'GO!', 0, 0);
  ctx.restore();
}

function drawLapFlash() {
  ctx.fillStyle = 'rgba(0,5,20,0.78)';
  ctx.fillRect(0, BASE_H / 2 - 60, BASE_W, 120);
  if (hasImage(art.starmap)) drawImage(art.starmap, 28, BASE_H / 2 - 48, 92, 92, 0.18);
  if (Math.floor(overlayTimer / 6) % 2 !== 0) return;
  ctx.textAlign = 'center';
  ctx.shadowColor = '#FFEE00';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#FFEE00';
  ctx.font = 'bold 24px "Courier New"';
  ctx.fillText(flashMsg, BASE_W / 2 + 20, BASE_H / 2 - 8);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#00FFCC';
  ctx.shadowColor = '#00FFCC';
  ctx.shadowBlur = 6;
  ctx.font = '18px "Courier New"';
  ctx.fillText(fmtTime(lapTimes[curLap - 1]), BASE_W / 2 + 20, BASE_H / 2 + 28);
  ctx.shadowBlur = 0;
}

function drawFinishAnim() {
  ctx.fillStyle = 'rgba(0,5,20,0.82)';
  ctx.fillRect(0, BASE_H / 2 - 70, BASE_W, 140);
  drawStarmapBackdrop(0.2, Date.now() * 0.0004);
  const fl = Math.floor(Date.now() / 200) % 3;
  const cols = ['#FF8800', '#FFEE00', '#FF4400'];
  ctx.textAlign = 'center';
  ctx.font = 'bold 42px "Courier New"';
  ctx.fillStyle = cols[fl];
  ctx.shadowColor = cols[fl];
  ctx.shadowBlur = 25;
  ctx.fillText('CONSTELLATION', BASE_W / 2, BASE_H / 2 - 10);
  ctx.fillText('COMPLETE', BASE_W / 2, BASE_H / 2 + 32);
  ctx.shadowBlur = 0;
}

function drawResult() {
  const total = lapTimes.reduce((a, b) => a + b, 0);
  const rank = getRank(total);
  const isRecord = !!(bestTime && total <= bestTime + 0.011);
  ctx.fillStyle = '#000514';
  ctx.fillRect(0, 0, BASE_W, BASE_H);
  drawStarmapBackdrop(0.2, Date.now() * 0.00015);
  if (hasImage(art.shadow)) drawImage(art.shadow, -40, -10, 480, 480, 0.14);
  drawStarfield(0.2, 0.3);

  ctx.textAlign = 'center';
  ctx.font = 'bold 34px "Courier New"';
  ctx.fillStyle = '#FF8800';
  ctx.shadowColor = '#FF8800';
  ctx.shadowBlur = 18;
  ctx.fillText('RESULT', BASE_W / 2, 72);
  ctx.shadowBlur = 0;
  drawLorePanel(28, 94, 344, 156, 'CONSTELLATION LOG', [
    `LAP 1  ${fmtTime(lapTimes[0] || 0)}`,
    `LAP 2  ${fmtTime(lapTimes[1] || 0)}`,
    `LAP 3  ${fmtTime(lapTimes[2] || 0)}`
  ]);

  ctx.font = 'bold 20px "Courier New"';
  ctx.fillStyle = '#00FFCC';
  ctx.shadowColor = '#00FFCC';
  ctx.shadowBlur = 8;
  ctx.fillText(`TOTAL  ${fmtTime(total)}`, BASE_W / 2, 284);
  ctx.shadowBlur = 0;

  if (isRecord) {
    if (Math.floor(Date.now() / 380) % 2 === 0) {
      ctx.font = 'bold 16px "Courier New"';
      ctx.fillStyle = '#FF88FF';
      ctx.shadowColor = '#FF88FF';
      ctx.shadowBlur = 10;
      ctx.fillText('NEW ARCHIVE RECORD', BASE_W / 2, 322);
      ctx.shadowBlur = 0;
    }
  } else if (bestTime) {
    ctx.fillStyle = '#556677';
    ctx.font = '13px "Courier New"';
    ctx.fillText(`BEST: ${fmtTime(bestTime)}`, BASE_W / 2, 322);
  }

  ctx.font = 'bold 32px "Courier New"';
  ctx.fillStyle = rank.color;
  ctx.shadowColor = rank.color;
  ctx.shadowBlur = 15;
  ctx.fillText(`RANK ${rank.grade}`, BASE_W / 2, 386);
  ctx.shadowBlur = 0;
  ctx.font = '11px "Courier New"';
  ctx.fillStyle = '#9AB4C7';
  ctx.fillText(rank.comment, BASE_W / 2, 408);
  ctx.fillText(`TRACE COMPLETION ${Math.round(getTraceProgress() * 100)}%`, BASE_W / 2, 426);

  drawPromptButton(446, 'TRACE AGAIN');
  ctx.fillStyle = '#223344';
  ctx.font = '9px "Courier New"';
  ctx.fillText('© 1985  TITAN ELECTRONICS', BASE_W / 2, 558);
}

function getRank(t) {
  if (t < 60) return { grade: 'S', color: '#FFEE00', comment: 'PERFECT STAR READING' };
  if (t < 80) return { grade: 'A', color: '#00FFCC', comment: 'ASTRAL CIRCUIT MASTER' };
  if (t < 100) return { grade: 'B', color: '#88FFAA', comment: 'STABLE NIGHT DRIVE' };
  if (t < 130) return { grade: 'C', color: '#FF8800', comment: 'SIGNAL STILL FLICKERS' };
  return { grade: 'D', color: '#FF4444', comment: 'ROUTE LOST IN DARKNESS' };
}

document.addEventListener('keydown', (e) => {
  if (!e.repeat) handleKey(e.code);
  if (['ArrowLeft', 'ArrowRight', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
});

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  touchSX = e.touches[0].clientX;
  initAudio();
  if (state === S.TITLE || state === S.RESULT) startGame();
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  const now = Date.now();
  if (now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
  const dx = e.changedTouches[0].clientX - touchSX;
  if (state === S.RACE && Math.abs(dx) > 15) {
    if (dx < 0 && P.lane > 0) moveLane(-1);
    if (dx > 0 && P.lane < 2) moveLane(1);
  }
}, { passive: false });

canvas.addEventListener('click', () => {
  initAudio();
  if (state === S.TITLE || state === S.RESULT) startGame();
});

document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);

resizeCanvas();
P.x = LANES[1];
P.targetX = LANES[1];
requestAnimationFrame(function loop(ts) {
  update(ts);
  draw();
  requestAnimationFrame(loop);
});
