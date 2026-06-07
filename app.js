/**
 * FitCheck AR – app.js
 *
 * Features:
 *  - WebXR hit-test floor detection & tap-to-place
 *  - D-pad (forward/back/left/right) for manual position nudging
 *  - Rotate left/right (Y-axis rotation)
 *  - Height (Y-axis) up/down control
 *  - Fine (2 cm) / Coarse (10 cm) step sizes
 *  - Lock mode: center button toggles whether tap re-places the box
 *  - Collision detection: box turns red when it would overlap a surface
 *  - All AFRAME components registered in <head> before <a-scene> parses
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. ITEM CATALOG
// ─────────────────────────────────────────────────────────────────────────────
const CATALOG = [
  { name: '75" TV Box',    desc: 'Typical 75" TV packaging.',   w: 1.70, h: 1.00, d: 0.20 },
  { name: '3-Seater Sofa', desc: 'Standard living room sofa.',  w: 2.20, h: 0.90, d: 0.90 },
  { name: 'French Fridge', desc: 'Double-door refrigerator.',   w: 0.90, h: 1.80, d: 0.90 },
];

let currentItem = { ...CATALOG[0] };
let isPlaced    = false;
let replaceLock = false;   // when true, screen taps won't re-place the box
let stepSize    = 0.02;    // metres per nudge (fine = 0.02, coarse = 0.10)
let lastUiTouch = 0;

// Move loop state
let moveInterval = null;
let currentDir   = null;

// Collision state
let isColliding  = false;

// ─────────────────────────────────────────────────────────────────────────────
// 2. A-FRAME COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
AFRAME.registerComponent('ar-hit-test-manager', {

  init: function () {
    this.hitTestSource = null;
    this.reticleEl     = null;
    this.bboxEl        = null;
    this.bboxMeshEl    = null;
    this.xrSession     = null;

    // Point-cloud for surface detection (collision)
    this.surfacePoints = [];   // Array of {x,y,z} world positions from hit-test
    this.MAX_POINTS    = 120;

    this._onEnterVR = this._onEnterVR.bind(this);
    this._onExitVR  = this._onExitVR.bind(this);
    this._onSelect  = this._onSelect.bind(this);

    this.el.addEventListener('enter-vr', this._onEnterVR);
    this.el.addEventListener('exit-vr',  this._onExitVR);

    this.el.addEventListener('loaded', () => {
      this.reticleEl  = document.getElementById('reticle');
      this.bboxEl     = document.getElementById('bbox');
      this.bboxMeshEl = document.getElementById('bbox-mesh');
      this.bboxWireEl = document.getElementById('bbox-wire');
    });
  },

  tick: function () {
    if (!this.xrSession || !this.hitTestSource) return;
    const frame = this.el.frame;
    if (!frame) return;

    const refSpace = this.el.renderer.xr.getReferenceSpace();
    if (!refSpace)  return;

    const results = frame.getHitTestResults(this.hitTestSource);

    if (results.length > 0) {
      const pose = results[0].getPose(refSpace);
      if (!pose) return;

      const p = pose.transform.position;

      // Move reticle
      if (this.reticleEl) {
        this.reticleEl.setAttribute('visible', 'true');
        this.reticleEl.object3D.position.set(p.x, p.y, p.z);
      }

      // Accumulate surface points for collision engine
      this._addSurfacePoint(p.x, p.y, p.z);

      if (!isPlaced) setStatus('ready', 'Tap to Place');

      // Run collision check every frame when placed
      if (isPlaced) this._checkCollision();

    } else {
      if (!isPlaced && this.reticleEl) {
        this.reticleEl.setAttribute('visible', 'false');
      }
      if (!isPlaced) setStatus('scanning', 'Scanning Floor…');
    }
  },

  _addSurfacePoint: function (x, y, z) {
    if (this.surfacePoints.length >= this.MAX_POINTS) {
      this.surfacePoints.shift();
    }
    this.surfacePoints.push({ x, y, z });
  },

  /**
   * Collision detection: converts each accumulated surface point into the
   * local coordinate space of the bounding box container.  Because the
   * container is scaled to [w, h, d], the normalized local extents are
   * always [-0.5, 0.5] on X/Z and [0, 1] on Y.
   */
  _checkCollision: function () {
    if (!this.bboxEl) return;
    const boxObj = this.bboxEl.object3D;
    let hit = false;

    for (const pt of this.surfacePoints) {
      const local = new THREE.Vector3(pt.x, pt.y, pt.z);
      boxObj.worldToLocal(local);

      const inX = Math.abs(local.x) <= 0.5;
      const inY = local.y > 0.04 && local.y <= 1.0;   // 4 cm floor padding
      const inZ = Math.abs(local.z) <= 0.5;

      if (inX && inY && inZ) { hit = true; break; }
    }

    if (hit !== isColliding) {
      isColliding = hit;
      this._applyCollisionVisual(hit);
    }
  },

  _applyCollisionVisual: function (colliding) {
    const mesh = this.bboxMeshEl;
    const wire = this.bboxWireEl;
    const badge = document.getElementById('collision-badge');

    if (colliding) {
      if (mesh) mesh.setAttribute('material', 'color', '#f43f5e');
      if (wire) wire.setAttribute('material', 'color', '#f43f5e');
      setStatus('collision', '⚠️ Collision!');
      if (badge) badge.style.display = 'flex';
      if (navigator.vibrate) navigator.vibrate(80);
    } else {
      if (mesh) mesh.setAttribute('material', 'color', '#10b981');
      if (wire) wire.setAttribute('material', 'color', '#ffffff');
      setStatus('ready', 'Placed ✓');
      if (badge) badge.style.display = 'none';
    }
  },

  _onEnterVR: function () {
    if (!this.el.is('ar-mode')) return;

    this.xrSession = this.el.xrSession;
    document.getElementById('ar-hud').style.display   = 'block';
    document.getElementById('start-overlay').style.display = 'none';
    showHint('Slowly move your phone to detect the floor');
    setStatus('scanning', 'Scanning Floor…');
    updateHUD();

    this.xrSession.addEventListener('select', this._onSelect);

    // Request hit-test source
    this.xrSession.requestReferenceSpace('viewer').then(vs => {
      return this.xrSession.requestHitTestSource({ space: vs });
    }).then(src => {
      this.hitTestSource = src;
      console.log('[FitCheck] Hit-test source acquired ✓');
    }).catch(err => {
      console.error('[FitCheck] Hit-test FAILED:', err);
      showHint('Floor detection unavailable – tap anywhere to place');
    });
  },

  _onExitVR: function () {
    if (this.hitTestSource) { this.hitTestSource.cancel(); this.hitTestSource = null; }
    this.xrSession = null;
    this.surfacePoints = [];
    isPlaced   = false;
    isColliding = false;
    stopMove();

    document.getElementById('ar-hud').style.display        = 'none';
    document.getElementById('start-overlay').style.display = 'flex';
    document.getElementById('controls-left').style.display = 'none';
    document.getElementById('collision-badge').style.display = 'none';

    if (this.reticleEl) this.reticleEl.setAttribute('visible', 'false');
    if (this.bboxEl)    this.bboxEl.setAttribute('visible', 'false');
  },

  _onSelect: function () {
    // If locked or just tapped UI, skip
    if (replaceLock)                      return;
    if (Date.now() - lastUiTouch < 400)   return;

    if (!this.reticleEl) return;
    if (!this.reticleEl.getAttribute('visible')) return;

    const pos = this.reticleEl.object3D.position;
    this.bboxEl.object3D.position.set(pos.x, pos.y, pos.z);
    this.bboxEl.object3D.rotation.set(0, 0, 0);   // reset rotation on new placement
    this.bboxEl.setAttribute('visible', 'true');
    applyDimensions();

    isPlaced = true;
    isColliding = false;
    this._applyCollisionVisual(false);
    this.surfacePoints = [];   // clear old surface data after placing

    setStatus('ready', 'Box Placed ✓');
    showHint(`${currentItem.name} placed! Use the D-pad to fine-tune position.`);
    if (navigator.vibrate) navigator.vibrate(60);

    // Show controls panel
    document.getElementById('controls-left').style.display = 'flex';
  },

});

// ─────────────────────────────────────────────────────────────────────────────
// 3. MOVE / NUDGE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start continuous movement in direction `dir`.
 * Uses requestAnimationFrame so movement speed is frame-rate independent.
 */
function startMove(dir) {
  stopMove();
  currentDir = dir;
  lastUiTouch = Date.now();

  function loop() {
    if (!currentDir || !isPlaced) return;
    nudge(currentDir);
    moveInterval = requestAnimationFrame(loop);
  }
  moveInterval = requestAnimationFrame(loop);
}

function stopMove() {
  if (moveInterval) { cancelAnimationFrame(moveInterval); moveInterval = null; }
  currentDir = null;
}

/**
 * Move the bounding box one step in the given direction.
 * Forward/back are relative to the camera's current Y-axis rotation so the
 * D-pad always feels intuitive regardless of where you are standing.
 */
function nudge(dir) {
  const bbox = document.getElementById('bbox');
  if (!bbox) return;
  const obj = bbox.object3D;

  // Get camera's yaw so fwd/back follow the user's viewpoint
  const camera = document.querySelector('[camera]');
  const camYaw = camera ? camera.object3D.rotation.y : 0;

  const step = stepSize;
  const ROT_STEP = THREE.MathUtils.degToRad(2);   // 2° per frame

  switch (dir) {
    case 'fwd':
      obj.position.x -= Math.sin(camYaw) * step;
      obj.position.z -= Math.cos(camYaw) * step;
      break;
    case 'back':
      obj.position.x += Math.sin(camYaw) * step;
      obj.position.z += Math.cos(camYaw) * step;
      break;
    case 'left':
      obj.position.x -= Math.cos(camYaw) * step;
      obj.position.z += Math.sin(camYaw) * step;
      break;
    case 'right':
      obj.position.x += Math.cos(camYaw) * step;
      obj.position.z -= Math.sin(camYaw) * step;
      break;
    case 'up':
      obj.position.y += step;
      break;
    case 'down':
      obj.position.y = Math.max(0, obj.position.y - step);
      break;
    case 'rotl':
      obj.rotation.y += ROT_STEP;
      break;
    case 'rotr':
      obj.rotation.y -= ROT_STEP;
      break;
  }
  obj.matrixAutoUpdate = true;
}

// ── Step size
function setStep(mode) {
  stepSize = (mode === 'fine') ? 0.02 : 0.10;
  document.getElementById('step-fine').classList.toggle('active',   mode === 'fine');
  document.getElementById('step-coarse').classList.toggle('active', mode === 'coarse');
  lastUiTouch = Date.now();
}

// ── Lock toggle (prevents taps from re-placing the box)
function toggleReplace() {
  replaceLock = !replaceLock;
  const btn = document.getElementById('btn-lock');
  if (btn) {
    btn.textContent  = replaceLock ? '🔓' : '🔒';
    btn.title        = replaceLock ? 'Unlock re-placement' : 'Lock position (no re-place on tap)';
    btn.style.background = replaceLock
      ? 'rgba(0,229,255,0.25)'
      : 'rgba(255,255,255,0.08)';
  }
  lastUiTouch = Date.now();
  showHint(replaceLock ? '🔒 Position locked – D-pad only' : '🔓 Tap floor to re-place');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. UI / ITEM LOGIC
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Absorb pointer events from HUD elements so XR select isn't triggered
  ['ar-hud', 'bottom-panel', 'ar-header', 'controls-left'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('pointerdown', () => { lastUiTouch = Date.now(); });
      el.addEventListener('touchstart',  () => { lastUiTouch = Date.now(); }, { passive: true });
    }
  });

  checkCompatibility();
  document.getElementById('start-ar-btn').addEventListener('click', startAR);
});

async function startAR() {
  const scene = document.getElementById('ar-scene');

  if (navigator.permissions) {
    try {
      const s = await navigator.permissions.query({ name: 'camera' });
      if (s.state === 'denied') { showCamError(); return; }
    } catch (_) {}
  }

  scene.style.display = 'block';
  await new Promise(r => setTimeout(r, 100));

  try {
    if (typeof scene.enterAR === 'function') {
      await scene.enterAR();
    } else {
      await scene.enterVR();
    }
  } catch (err) {
    console.error('[FitCheck] enterAR failed:', err);
    scene.style.display = 'none';
    if (err.name === 'NotAllowedError') { showCamError(); return; }
    alert('AR not supported on this device.\nUse Chrome on an ARCore-enabled Android phone.');
  }
}

function showCamError() {
  document.getElementById('start-overlay').style.display    = 'none';
  document.getElementById('cam-error-overlay').style.display = 'flex';
}

function checkCompatibility() {
  const note = document.getElementById('compat-note');
  if (!note) return;
  if (!navigator.xr) {
    note.textContent = '⚠️ WebXR unavailable. Use Chrome on Android.';
    note.style.color = '#f59e0b';
    return;
  }
  navigator.xr.isSessionSupported('immersive-ar').then(ok => {
    note.textContent = ok
      ? '✓ AR supported on this device'
      : '⚠️ Immersive AR not supported. Try Chrome on Android.';
    note.style.color = ok ? '#10b981' : '#f59e0b';
  }).catch(() => {
    note.textContent = '⚠️ Could not detect AR support.';
    note.style.color = '#94a3b8';
  });
}

function pickItem(index) {
  document.querySelectorAll('.item-card').forEach(c => c.classList.remove('selected'));
  document.getElementById(`ipick-${index}`).classList.add('selected');
  currentItem = { ...CATALOG[index] };
  syncHUDSelection(index);
}

function selectItem(index) {
  document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
  document.getElementById(`prod-${index}`).classList.add('selected');
  currentItem = { ...CATALOG[index] };
  updateHUD();
  if (isPlaced) { applyDimensions(); showHint(`Switched to: ${currentItem.name}`); }
  lastUiTouch = Date.now();
}

function syncHUDSelection(index) {
  document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(`prod-${index}`);
  if (card) card.classList.add('selected');
  updateHUD();
}

function applyCustom() {
  const w = Math.max(0.05, parseFloat(document.getElementById('input-w').value) || 1.0);
  const h = Math.max(0.05, parseFloat(document.getElementById('input-h').value) || 1.0);
  const d = Math.max(0.05, parseFloat(document.getElementById('input-d').value) || 1.0);
  currentItem = { name: 'Custom Box', desc: 'Custom dimensions.', w, h, d };
  updateHUD();
  if (isPlaced) applyDimensions();
  showHint(`Custom: ${w.toFixed(2)} × ${h.toFixed(2)} × ${d.toFixed(2)} m`);
  lastUiTouch = Date.now();
}

function applyDimensions() {
  const bbox = document.getElementById('bbox');
  if (bbox) bbox.setAttribute('scale', `${currentItem.w} ${currentItem.h} ${currentItem.d}`);
}

function updateHUD() {
  const n = document.getElementById('hud-name');
  const d = document.getElementById('hud-dims');
  if (n) n.textContent = currentItem.name;
  if (d) d.textContent = `${currentItem.w.toFixed(2)} × ${currentItem.h.toFixed(2)} × ${currentItem.d.toFixed(2)} m`;
}

function resetSession() {
  isPlaced   = false;
  isColliding = false;
  replaceLock = false;
  stopMove();

  const bbox    = document.getElementById('bbox');
  const reticle = document.getElementById('reticle');
  const mesh    = document.getElementById('bbox-mesh');
  const wire    = document.getElementById('bbox-wire');
  const badge   = document.getElementById('collision-badge');
  const lock    = document.getElementById('btn-lock');

  if (bbox)   { bbox.setAttribute('visible', 'false'); bbox.object3D.rotation.set(0,0,0); }
  if (reticle) reticle.setAttribute('visible', 'false');
  if (mesh)    mesh.setAttribute('material', 'color', '#10b981');
  if (wire)    wire.setAttribute('material', 'color', '#ffffff');
  if (badge)   badge.style.display = 'none';
  if (lock)  { lock.textContent = '🔒'; lock.style.background = 'rgba(255,255,255,0.08)'; }

  document.getElementById('controls-left').style.display = 'none';
  setStatus('scanning', 'Scanning Floor…');
  showHint('Move phone to re-detect floor');
  lastUiTouch = Date.now();
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b  => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.getElementById(`pane-${tab}`).classList.add('active');
  lastUiTouch = Date.now();
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. HUD HELPERS
// ─────────────────────────────────────────────────────────────────────────────
let hintTimer = null;
function showHint(msg) {
  const el    = document.getElementById('hint-text');
  const toast = document.getElementById('hint-toast');
  if (!el || !toast) return;
  el.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { toast.style.opacity = '0'; }, 3200);
}

function setStatus(state, label) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (!dot || !text) return;
  dot.className   = 'status-dot ' + state;
  text.textContent = label;
}
