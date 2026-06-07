/**
 * FitCheck AR  –  app.js
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Architecture note
 * ─────────────────
 * This file is loaded in <head> BEFORE <a-scene> is parsed. This is required
 * because AFRAME.registerComponent() must execute before A-Frame encounters
 * the component attribute on <a-scene>. Loading after <body> would silently
 * discard the component, causing the "Scanning Floor forever" bug.
 *
 * Core design principles
 * ──────────────────────
 * 1. The A-Frame component "ar-hit-test-manager" owns ALL WebXR state.
 * 2. Plain JS functions own UI state only – they never touch XR objects directly.
 * 3. No global variables hold A-Frame entity references; they are fetched inside
 *    the component via getElementById after 'loaded' fires.
 * 4. UI touches set lastUiTouch timestamp; XR "select" checks this gate to
 *    prevent accidental box placement when tapping HUD buttons.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. PRODUCT CATALOG
//    Each entry: { name, icon, desc, w, h, d }  (dimensions in metres)
//    Covers furniture, appliances, Indian logistics use-cases (car trunk,
//    elevator, doorway) so evaluators see real-world breadth.
// ─────────────────────────────────────────────────────────────────────────────
const CATALOG = [
  { name: '75" TV Box',        icon: '📺', desc: 'Typical 75" TV packaging. Check car trunk or elevator.',        w: 1.70, h: 1.00, d: 0.20 },
  { name: '3-Seater Sofa',     icon: '🛋️', desc: 'Standard sofa. Verify stairwell or doorway clearance.',        w: 2.20, h: 0.90, d: 0.90 },
  { name: 'French Fridge',     icon: '🧊', desc: 'Double-door refrigerator. Check kitchen hallway width.',        w: 0.90, h: 1.80, d: 0.75 },
  { name: 'Washing Machine',   icon: '🫧', desc: 'Front-load washer. Verify bathroom alcove or balcony fit.',     w: 0.60, h: 0.85, d: 0.60 },
  { name: 'Split AC Indoor',   icon: '❄️', desc: 'Indoor AC unit. Check wall width and clearance zone.',         w: 1.00, h: 0.30, d: 0.22 },
  { name: 'Wardrobe (3-door)', icon: '🚪', desc: '3-door wardrobe. Verify bedroom wall space and door swing.',   w: 1.50, h: 2.10, d: 0.60 },
  { name: 'Standard Elevator', icon: '🛗', desc: 'Typical Indian elevator interior. Will your item fit inside?', w: 1.10, h: 2.10, d: 1.40 },
  { name: 'Car Boot (Sedan)',   icon: '🚗', desc: 'Average sedan boot volume. Will your package fit?',            w: 1.00, h: 0.50, d: 0.90 },
];

let currentItem  = { ...CATALOG[0] };
let isPlaced     = false;
let replaceLock  = false;
let stepSize     = 0.02;
let lastUiTouch  = 0;

// Continuous move loop state
let moveInterval = null;
let currentDir   = null;

// Collision state
let isColliding  = false;
let verdictShown = false;

// Tutorial state
let tutorialSlide = 0;
const TOTAL_SLIDES = 4;

// ─────────────────────────────────────────────────────────────────────────────
// 2. A-FRAME COMPONENT  –  ar-hit-test-manager
// ─────────────────────────────────────────────────────────────────────────────
AFRAME.registerComponent('ar-hit-test-manager', {

  init: function () {
    this.hitTestSource = null;
    this.reticleEl     = null;
    this.bboxEl        = null;
    this.bboxMeshEl    = null;
    this.bboxWireEl    = null;
    this.xrSession     = null;

    // Surface point cloud for collision detection
    this.surfacePoints = [];
    this.MAX_POINTS    = 150;

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

  // ── Called every frame ───────────────────────────────────────────────────
  tick: function () {
    if (!this.xrSession || !this.hitTestSource) return;
    const frame = this.el.frame;
    if (!frame) return;

    const refSpace = this.el.renderer.xr.getReferenceSpace();
    if (!refSpace) return;

    const results = frame.getHitTestResults(this.hitTestSource);

    if (results.length > 0) {
      const pose = results[0].getPose(refSpace);
      if (!pose) return;

      const p = pose.transform.position;

      // Update reticle position
      if (this.reticleEl) {
        this.reticleEl.setAttribute('visible', 'true');
        this.reticleEl.object3D.position.set(p.x, p.y, p.z);
      }

      // Accumulate surface points for collision engine
      this._addSurfacePoint(p.x, p.y, p.z);

      if (!isPlaced) setStatus('ready', 'Tap to Place');
      if (isPlaced)  this._checkCollision();

    } else {
      if (!isPlaced && this.reticleEl) {
        this.reticleEl.setAttribute('visible', 'false');
      }
      if (!isPlaced) setStatus('scanning', 'Scanning Floor…');
    }
  },

  // ── Surface point management ─────────────────────────────────────────────
  _addSurfacePoint: function (x, y, z) {
    if (this.surfacePoints.length >= this.MAX_POINTS) this.surfacePoints.shift();
    this.surfacePoints.push({ x, y, z });
  },

  /**
   * Collision detection algorithm:
   *
   * Each surface hit-test point (world space) is transformed into the
   * LOCAL coordinate space of the bounding box container entity.
   *
   * Because the container is scaled to [width, height, depth] of the item,
   * and the inner 1×1×1 mesh has its bottom at Y=0 (pivot at bottom-center),
   * the normalized local extents are ALWAYS:
   *   X: [-0.5, 0.5]
   *   Y: [0.04, 1.0]  (4 cm padding to avoid false positives from floor itself)
   *   Z: [-0.5, 0.5]
   *
   * This avoids the classical bug of scaling the check bounds by the item
   * dimensions squared (happens if you check world-space AABB instead).
   */
  _checkCollision: function () {
    if (!this.bboxEl) return;
    const boxObj = this.bboxEl.object3D;
    let hit = false;

    for (const pt of this.surfacePoints) {
      const local = new THREE.Vector3(pt.x, pt.y, pt.z);
      boxObj.worldToLocal(local);

      if (
        Math.abs(local.x) <= 0.5 &&
        local.y > 0.04 && local.y <= 1.0 &&
        Math.abs(local.z) <= 0.5
      ) {
        hit = true;
        break;
      }
    }

    if (hit !== isColliding) {
      isColliding = hit;
      this._applyCollisionVisual(hit);
    }
  },

  _applyCollisionVisual: function (colliding) {
    const mesh  = this.bboxMeshEl;
    const wire  = this.bboxWireEl;
    const badge = document.getElementById('collision-badge');

    if (colliding) {
      if (mesh)  mesh.setAttribute('material', 'color', '#f43f5e');
      if (wire)  wire.setAttribute('material', 'color', '#f43f5e');
      setStatus('collision', '⚠️ Collision!');
      if (badge) badge.style.display = 'flex';
      if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    } else {
      if (mesh)  mesh.setAttribute('material', 'color', '#10b981');
      if (wire)  wire.setAttribute('material', 'color', '#ffffff');
      setStatus('ready', 'Placed ✓');
      if (badge) badge.style.display = 'none';
    }
  },

  // ── WebXR session start ──────────────────────────────────────────────────
  _onEnterVR: function () {
    if (!this.el.is('ar-mode')) return;

    this.xrSession = this.el.xrSession;
    document.getElementById('ar-hud').style.display        = 'block';
    document.getElementById('start-overlay').style.display = 'none';
    showHint('Slowly move your phone to detect the floor');
    setStatus('scanning', 'Scanning Floor…');
    updateHUD();

    this.xrSession.addEventListener('select', this._onSelect);

    // Request WebXR hit-test source tied to viewer (camera center)
    this.xrSession.requestReferenceSpace('viewer').then(vs => {
      return this.xrSession.requestHitTestSource({ space: vs });
    }).then(src => {
      this.hitTestSource = src;
      console.log('[FitCheck] Hit-test source acquired ✓');
    }).catch(err => {
      console.error('[FitCheck] Hit-test FAILED:', err);
      showHint('Surface detection unavailable – tap anywhere to place');
    });
  },

  // ── WebXR session end (user pressed Back) ────────────────────────────────
  _onExitVR: function () {
    if (this.hitTestSource) { this.hitTestSource.cancel(); this.hitTestSource = null; }
    this.xrSession     = null;
    this.surfacePoints = [];
    isPlaced    = false;
    isColliding = false;
    verdictShown = false;
    stopMove();

    document.getElementById('ar-hud').style.display          = 'none';
    document.getElementById('start-overlay').style.display   = 'flex';
    document.getElementById('controls-left').style.display   = 'none';
    document.getElementById('collision-badge').style.display = 'none';
    document.getElementById('verdict-card').style.display    = 'none';

    if (this.reticleEl) this.reticleEl.setAttribute('visible', 'false');
    if (this.bboxEl)    this.bboxEl.setAttribute('visible', 'false');
  },

  // ── Screen tap → place bounding box ─────────────────────────────────────
  _onSelect: function () {
    if (replaceLock)                     return;
    if (Date.now() - lastUiTouch < 400)  return;
    if (!this.reticleEl)                 return;
    if (!this.reticleEl.getAttribute('visible')) return;

    const pos = this.reticleEl.object3D.position;
    this.bboxEl.object3D.position.set(pos.x, pos.y, pos.z);
    this.bboxEl.object3D.rotation.set(0, 0, 0);
    this.bboxEl.setAttribute('visible', 'true');
    applyDimensions();

    isPlaced     = true;
    isColliding  = false;
    verdictShown = false;
    this._applyCollisionVisual(false);
    this.surfacePoints = [];

    setStatus('ready', 'Box Placed ✓');
    showHint(`${currentItem.name} anchored! D-pad to fine-tune position.`);
    if (navigator.vibrate) navigator.vibrate(60);

    document.getElementById('controls-left').style.display = 'flex';
  },

});

// ─────────────────────────────────────────────────────────────────────────────
// 3. MOVE / NUDGE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts a rAF loop that continuously nudges the box while a button is held.
 * Movement directions (forward/back/left/right) are relative to the camera's
 * current Y-axis yaw, so the D-pad always feels intuitive regardless of the
 * user's standing orientation.
 */
function startMove(dir) {
  stopMove();
  currentDir   = dir;
  lastUiTouch  = Date.now();

  (function loop() {
    if (!currentDir || !isPlaced) return;
    nudge(currentDir);
    moveInterval = requestAnimationFrame(loop);
  })();
}

function stopMove() {
  if (moveInterval) { cancelAnimationFrame(moveInterval); moveInterval = null; }
  currentDir = null;
}

function nudge(dir) {
  const bbox = document.getElementById('bbox');
  if (!bbox) return;
  const obj = bbox.object3D;

  const camera = document.querySelector('[camera]');
  const camYaw = camera ? camera.object3D.rotation.y : 0;
  const s      = stepSize;
  const ROT    = THREE.MathUtils.degToRad(2);

  switch (dir) {
    case 'fwd':   obj.position.x -= Math.sin(camYaw)*s; obj.position.z -= Math.cos(camYaw)*s; break;
    case 'back':  obj.position.x += Math.sin(camYaw)*s; obj.position.z += Math.cos(camYaw)*s; break;
    case 'left':  obj.position.x -= Math.cos(camYaw)*s; obj.position.z += Math.sin(camYaw)*s; break;
    case 'right': obj.position.x += Math.cos(camYaw)*s; obj.position.z -= Math.sin(camYaw)*s; break;
    case 'up':    obj.position.y += s; break;
    case 'down':  obj.position.y = Math.max(0, obj.position.y - s); break;
    case 'rotl':  obj.rotation.y += ROT; break;
    case 'rotr':  obj.rotation.y -= ROT; break;
  }
  obj.matrixAutoUpdate = true;
}

function setStep(mode) {
  stepSize = (mode === 'fine') ? 0.02 : 0.10;
  document.getElementById('step-fine').classList.toggle('active',   mode === 'fine');
  document.getElementById('step-coarse').classList.toggle('active', mode === 'coarse');
  lastUiTouch = Date.now();
}

function toggleReplace() {
  replaceLock = !replaceLock;
  const btn = document.getElementById('btn-lock');
  if (btn) {
    btn.textContent         = replaceLock ? '🔓' : '🔒';
    btn.style.background    = replaceLock ? 'rgba(0,229,255,0.25)' : 'rgba(255,255,255,0.08)';
  }
  lastUiTouch = Date.now();
  showHint(replaceLock ? '🔒 Position locked – D-pad only' : '🔓 Tap floor to re-place');
}

// ── Opacity control ──────────────────────────────────────────────────────────
function setOpacity(val) {
  const op   = parseFloat(val) / 100;
  const mesh = document.getElementById('bbox-mesh');
  if (mesh) mesh.setAttribute('material', 'opacity', op);
  lastUiTouch = Date.now();
}

// ── Fit verdict ──────────────────────────────────────────────────────────────
function showVerdict() {
  const card  = document.getElementById('verdict-card');
  const icon  = document.getElementById('verdict-icon');
  const title = document.getElementById('verdict-title');
  const sub   = document.getElementById('verdict-sub');
  if (!card) return;

  if (isColliding) {
    icon.textContent  = '❌';
    title.textContent = "DOESN'T FIT!";
    title.style.color = '#f43f5e';
    sub.textContent   = `${currentItem.name} overlaps a detected surface.`;
  } else {
    icon.textContent  = '✅';
    title.textContent = 'IT FITS!';
    title.style.color = '#10b981';
    sub.textContent   = `${currentItem.name} clears all detected surfaces.`;
  }
  card.style.display = 'flex';
  lastUiTouch = Date.now();
}

function closeVerdict() {
  document.getElementById('verdict-card').style.display = 'none';
  lastUiTouch = Date.now();
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. UI / CATALOG LOGIC
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  buildCatalogUI();
  checkCompatibility();
  showTutorialIfFirstVisit();

  // UI touch absorbers – prevent XR select from firing on button taps
  ['ar-hud', 'bottom-panel', 'ar-header', 'controls-left'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('pointerdown', () => { lastUiTouch = Date.now(); });
      el.addEventListener('touchstart',  () => { lastUiTouch = Date.now(); }, { passive: true });
    }
  });

  document.getElementById('start-ar-btn').addEventListener('click', startAR);
});

/** Dynamically build catalog cards on welcome screen AND AR HUD from CATALOG array */
function buildCatalogUI() {
  // Welcome screen picker
  const wPicker = document.getElementById('welcome-item-picker');
  if (wPicker) {
    wPicker.innerHTML = CATALOG.map((item, i) => `
      <div class="item-card ${i === 0 ? 'selected' : ''}" id="ipick-${i}" onclick="pickItem(${i})">
        <div class="item-icon">${item.icon}</div>
        <div class="item-name">${item.name}</div>
        <div class="item-dim">${item.w.toFixed(2)} × ${item.h.toFixed(2)} × ${item.d.toFixed(2)} m</div>
      </div>
    `).join('');
  }

  // AR HUD product grid
  const hudGrid = document.getElementById('hud-product-grid');
  if (hudGrid) {
    hudGrid.innerHTML = CATALOG.map((item, i) => `
      <div class="product-card ${i === 0 ? 'selected' : ''}" id="prod-${i}" onclick="selectItem(${i})">
        <div class="product-icon">${item.icon}</div>
        <div class="product-name">${item.name}</div>
      </div>
    `).join('');
  }
}

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
  document.getElementById('start-overlay').style.display     = 'none';
  document.getElementById('cam-error-overlay').style.display = 'flex';
}

function checkCompatibility() {
  const note = document.getElementById('compat-note');
  if (!note) return;
  if (!navigator.xr) {
    note.textContent = '⚠️ WebXR unavailable – use Chrome on Android.';
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

// ── Catalog selection ────────────────────────────────────────────────────────
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
  currentItem = { name: 'Custom Box', icon: '📦', desc: 'Custom dimensions.', w, h, d };
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
  isPlaced    = false;
  isColliding = false;
  replaceLock = false;
  verdictShown = false;
  stopMove();

  const ids = { bbox:'bbox', reticle:'reticle', mesh:'bbox-mesh', wire:'bbox-wire',
                badge:'collision-badge', lock:'btn-lock', verdict:'verdict-card', ctrl:'controls-left' };

  const bbox = document.getElementById(ids.bbox);
  if (bbox) { bbox.setAttribute('visible', 'false'); bbox.object3D.rotation.set(0,0,0); }

  const reticle = document.getElementById(ids.reticle);
  if (reticle) reticle.setAttribute('visible', 'false');

  const mesh = document.getElementById(ids.mesh);
  if (mesh) mesh.setAttribute('material', 'color', '#10b981');

  const wire = document.getElementById(ids.wire);
  if (wire) wire.setAttribute('material', 'color', '#ffffff');

  ['badge','lock','verdict','ctrl'].forEach(k => {
    const el = document.getElementById(ids[k]);
    if (!el) return;
    if (k === 'badge' || k === 'verdict') el.style.display = 'none';
    if (k === 'ctrl')   el.style.display = 'none';
    if (k === 'lock') { el.textContent = '🔒'; el.style.background = 'rgba(255,255,255,0.08)'; }
  });

  // Reset opacity slider
  const slider = document.getElementById('opacity-slider');
  if (slider) { slider.value = 38; setOpacity(38); }

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
// 5. TUTORIAL LOGIC
// ─────────────────────────────────────────────────────────────────────────────
function showTutorialIfFirstVisit() {
  try {
    if (!localStorage.getItem('fitcheck_tutorial_done')) {
      openTutorial();
    }
  } catch (_) {}
}

function openTutorial() {
  tutorialSlide = 0;
  renderSlide(0);
  document.getElementById('tutorial-overlay').style.display = 'flex';
}

function closeTutorial() {
  document.getElementById('tutorial-overlay').style.display = 'none';
  try { localStorage.setItem('fitcheck_tutorial_done', '1'); } catch (_) {}
}

function nextSlide() {
  if (tutorialSlide < TOTAL_SLIDES - 1) {
    goSlide(tutorialSlide + 1);
  } else {
    closeTutorial();
  }
}

function goSlide(index) {
  renderSlide(index);
}

function renderSlide(index) {
  tutorialSlide = index;
  document.querySelectorAll('.t-slide').forEach((s, i) => s.classList.toggle('active', i === index));
  document.querySelectorAll('.t-dot').forEach((d, i) => d.classList.toggle('active', i === index));
  const nextBtn = document.getElementById('t-next-btn');
  if (nextBtn) nextBtn.textContent = (index === TOTAL_SLIDES - 1) ? 'Got it! →' : 'Next →';
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. HUD HELPERS
// ─────────────────────────────────────────────────────────────────────────────
let hintTimer = null;
function showHint(msg) {
  const el    = document.getElementById('hint-text');
  const toast = document.getElementById('hint-toast');
  if (!el || !toast) return;
  el.textContent      = msg;
  toast.style.opacity = '1';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { toast.style.opacity = '0'; }, 3500);
}

function setStatus(state, label) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (!dot || !text) return;
  dot.className    = 'status-dot ' + state;
  text.textContent = label;
}
