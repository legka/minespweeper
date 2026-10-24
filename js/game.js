import {
  clamp,
  lerp,
  valueShift,
  easeQuadOut,
  easeQuadInOut,
  easeExpoIn,
  easeBackOut,
  easeBackInOut,
  easeQuadOutPeek,
} from './easing.js';

export const CELL_STEP = 160; // World units per grid cell (matches miniSweeper)
export const CELL_SIZE = 136; // Visual square size inside the 160x160 slot
export const CELL_RADIUS = 22; // Rounded corner radius in world units
export const BOARD_MARGIN = 100; // Margin around the grid

export class MinesweeperGame {
  constructor(canvas, sound, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sound = sound;
    this.callbacks = callbacks;

    // Settings
    this.settings = {
      theme: 'Default',
      showSwitchButton: true,
      tweenEnabled: true,
      clearAnimation: true,
      showTimer: true,
      showMines: 'always', // 'always' | 'five' | 'never'
      switchedControls: false, // false = tap clears / hold flags; true = tap flags / hold clears
    };

    this.themeColors = null;

    // Grid state
    this.gridWidth = 12;
    this.gridHeight = 22;
    this.gridMines = 40;

    this.mineGrid = [];
    this.clearedGrid = [];
    this.flagGrid = [];
    this.nearGrid = [];

    // Per-cell animation state (0..1)
    this.removeEaseGrid = [];
    this.flagEaseGrid = [];
    this.mineEaseGrid = [];
    this.previewEaseGrid = [];
    this.aboutToClearGrid = [];
    this.aboutToPopGrid = [];

    // Active animation queues
    this.toBeCleared = []; // [{ x, y, triggerTime }]
    this.mineWaveQueue = []; // [{ x, y, triggerTime }]
    this.previewTargets = new Set();

    // Game progress
    this.enabled = false;
    this.locked = false;
    this.firstPress = true;
    this.won = false;
    this.lost = false;
    this.gameplayTime = 0;
    this.gameTime = 0;
    this.minesLeft = 40;
    this.leftToClear = 0;
    this.cascadeCounter = 0;
    this.minePitchStep = 0;

    // Final win/loss board-wide wave animation
    this.finalActive = false;
    this.finalLost = false;
    this.finalPressX = 0;
    this.finalPressY = 0;
    this.finalPressTime = 0;

    // Camera state (world coordinates)
    this.camera = {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      panVx: 0,
      panVy: 0,
    };

    // Viewport dimensions (CSS pixels & DPR)
    this.viewportWidth = window.innerWidth;
    this.viewportHeight = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);

    // Multi-touch & pointer tracking
    this.pointers = new Map(); // pointerId -> { id, startX, startY, x, y, startTime, action, completed, button, history }
    this.pinchState = null;

    this.needsRedraw = true;
    this.lastFrameTime = performance.now();

    this.setupInputHandlers();
    this.resizeViewport();
    this.initGrid(this.gridWidth, this.gridHeight, this.gridMines);
  }

  setThemeColors(themeObj) {
    this.themeColors = themeObj;
    this.needsRedraw = true;
  }

  getFieldWidth() {
    return (this.gridWidth - 1) * CELL_STEP + BOARD_MARGIN * 2;
  }

  getFieldHeight() {
    return (this.gridHeight - 1) * CELL_STEP + BOARD_MARGIN * 2;
  }

  initGrid(width, height, mines) {
    this.gridWidth = width;
    this.gridHeight = height;
    const maxMines = Math.max(1, width * height - 9);
    this.gridMines = clamp(mines, 1, maxMines);

    const size = width * height;
    this.mineGrid = new Uint8Array(size);
    this.clearedGrid = new Uint8Array(size);
    this.flagGrid = new Uint8Array(size);
    this.nearGrid = new Uint8Array(size);

    this.removeEaseGrid = new Float32Array(size);
    this.flagEaseGrid = new Float32Array(size);
    this.mineEaseGrid = new Float32Array(size);
    this.previewEaseGrid = new Float32Array(size);
    this.aboutToClearGrid = new Uint8Array(size);
    this.aboutToPopGrid = new Uint8Array(size);

    this.toBeCleared = [];
    this.mineWaveQueue = [];
    this.previewTargets.clear();

    this.firstPress = true;
    this.won = false;
    this.lost = false;
    this.locked = false;
    this.gameplayTime = 0;
    this.gameTime = 0;
    this.minesLeft = this.gridMines;
    this.leftToClear = size - this.gridMines;
    this.finalActive = false;
    this.finalPressTime = 0;
    this.cascadeCounter = 0;
    this.minePitchStep = 0;

    this.fitCameraToBoard();
    this.needsRedraw = true;
    if (this.callbacks.onStatsUpdate) {
      this.callbacks.onStatsUpdate(this.minesLeft, this.gameplayTime, false);
    }
  }

  idx(x, y) {
    return y * this.gridWidth + x;
  }

  insideGrid(x, y) {
    return x >= 0 && x < this.gridWidth && y >= 0 && y < this.gridHeight;
  }

  /**
   * Places mines guaranteeing a 5x5 mine-free zone around (pressX, pressY)
   * just like miniSweeper's scr_grid_mines_from_press.gml
   */
  generateMinesFromPress(pressX, pressY) {
    const w = this.gridWidth;
    const h = this.gridHeight;
    const totalCells = w * h;
    this.mineGrid.fill(0);

    // Determine safe zone radius: 2 (5x5) if enough space, else 1 (3x3), else single cell
    let safeRadius = 2;
    const countSafeCells = (r) => {
      const x1 = Math.max(0, pressX - r);
      const y1 = Math.max(0, pressY - r);
      const x2 = Math.min(w - 1, pressX + r);
      const y2 = Math.min(h - 1, pressY + r);
      return (x2 - x1 + 1) * (y2 - y1 + 1);
    };

    if (totalCells - countSafeCells(2) < this.gridMines) {
      safeRadius = 1;
    }
    if (totalCells - countSafeCells(1) < this.gridMines) {
      safeRadius = 0;
    }

    const candidates = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.abs(x - pressX) <= safeRadius && Math.abs(y - pressY) <= safeRadius) {
          continue;
        }
        candidates.push(this.idx(x, y));
      }
    }

    // Fisher-Yates shuffle
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    const actualMines = Math.min(this.gridMines, candidates.length);
    for (let i = 0; i < actualMines; i++) {
      this.mineGrid[candidates[i]] = 1;
    }

    this.gridMines = actualMines;
    this.calculateNearGrid();

    // Recalculate minesLeft accounting for any flags placed prior to first clear
    let currentFlags = 0;
    for (let i = 0; i < totalCells; i++) {
      if (this.flagGrid[i]) currentFlags++;
    }
    this.minesLeft = this.gridMines - currentFlags;
    this.leftToClear = totalCells - this.gridMines;
  }

  calculateNearGrid() {
    const w = this.gridWidth;
    const h = this.gridHeight;
    this.nearGrid.fill(0);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = this.idx(x, y);
        if (this.mineGrid[i]) {
          this.nearGrid[i] = 9;
          continue;
        }
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
            if (this.mineGrid[this.idx(nx, ny)]) count++;
          }
        }
        this.nearGrid[i] = count;
      }
    }
  }

  countNearbyFlags(x, y) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= this.gridHeight) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= this.gridWidth || (dx === 0 && dy === 0)) continue;
        if (this.flagGrid[this.idx(nx, ny)]) count++;
      }
    }
    return count;
  }

  // ================= CAMERA & COORDINATE TRANSFORMS =================

  resizeViewport() {
    const rect = this.canvas.getBoundingClientRect();
    this.viewportWidth = rect.width || window.innerWidth;
    this.viewportHeight = rect.height || window.innerHeight;
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.max(1, Math.round(this.viewportWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.viewportHeight * this.dpr));

    // Aspect ratio must match the actual backing canvas buffer (canvas.width / canvas.height)
    const aspect = this.canvas.width / this.canvas.height;
    this.camera.height = this.camera.width / aspect;
    this.clampCamera();
    this.needsRedraw = true;
  }

  getCanvasAspect() {
    return (this.canvas.width || this.viewportWidth) / Math.max(1, this.canvas.height || this.viewportHeight);
  }

  fitCameraToBoard() {
    const aspect = this.getCanvasAspect();
    const padY = 220;
    const fw = this.getFieldWidth() + 80;
    const fh = this.getFieldHeight() + padY;

    if (fw / fh > aspect) {
      this.camera.width = fw;
      this.camera.height = fw / aspect;
    } else {
      this.camera.height = fh;
      this.camera.width = fh * aspect;
    }

    this.camera.x = (this.getFieldWidth() - this.camera.width) / 2;
    this.camera.y = (this.getFieldHeight() - this.camera.height) / 2;
    this.camera.panVx = 0;
    this.camera.panVy = 0;
    this.clampCamera();
    this.needsRedraw = true;
  }

  clampCamera() {
    const aspect = this.getCanvasAspect();
    const fw = this.getFieldWidth();
    const fh = this.getFieldHeight();

    // Top/bottom HUD breathing room in world coordinates
    const hudMargin = (Math.min(fh, this.camera.height) / Math.max(1, this.viewportHeight)) * 85;
    const minY = -hudMargin - 30;
    const maxY = hudMargin * (this.settings.showSwitchButton ? 1.6 : 0.9) + 30;

    const totalFitW = fw + 60;
    const totalFitH = fh - minY + maxY;

    // Max zoom-out (fit entire board)
    const maxCamW = Math.max(totalFitW, totalFitH * aspect);
    // Min zoom-in (approx 3.5 tiles across screen)
    const minCamW = Math.min(maxCamW, CELL_STEP * 3.5);

    this.camera.width = clamp(this.camera.width, minCamW, maxCamW);
    this.camera.height = this.camera.width / aspect;

    if (this.camera.width < fw) {
      this.camera.x = clamp(this.camera.x, -30, fw - this.camera.width + 30);
    } else {
      this.camera.x = (fw - this.camera.width) / 2;
    }

    if (this.camera.height < totalFitH) {
      this.camera.y = clamp(this.camera.y, minY, fh - this.camera.height + maxY);
    } else {
      this.camera.y = (fh + minY + maxY - this.camera.height) / 2;
    }
  }

  getCanvasRelativeCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      sx: clientX - rect.left,
      sy: clientY - rect.top,
      width: rect.width || this.viewportWidth,
      height: rect.height || this.viewportHeight,
    };
  }

  screenToWorldX(clientX) {
    const { sx, width } = this.getCanvasRelativeCoords(clientX, 0);
    return this.camera.x + (sx / width) * this.camera.width;
  }

  screenToWorldY(clientY) {
    const { sy, height } = this.getCanvasRelativeCoords(0, clientY);
    return this.camera.y + (sy / height) * this.camera.height;
  }

  worldToGridX(wx) {
    return Math.floor((wx - (BOARD_MARGIN - CELL_STEP / 2)) / CELL_STEP);
  }

  worldToGridY(wy) {
    return Math.floor((wy - (BOARD_MARGIN - CELL_STEP / 2)) / CELL_STEP);
  }

  screenToGrid(sx, sy) {
    const wx = this.screenToWorldX(sx);
    const wy = this.screenToWorldY(sy);
    return {
      gx: this.worldToGridX(wx),
      gy: this.worldToGridY(wy),
      wx,
      wy,
    };
  }

  // ================= GAMEPLAY ACTIONS =================

  executeFlag(gx, gy, vibrate = true) {
    if (!this.insideGrid(gx, gy) || this.locked || this.won || this.lost) return;
    const i = this.idx(gx, gy);
    if (this.clearedGrid[i]) return;

    const placing = this.flagGrid[i] === 0;
    this.flagGrid[i] = placing ? 1 : 0;
    this.minesLeft += placing ? -1 : 1;

    if (!this.settings.tweenEnabled) {
      this.flagEaseGrid[i] = placing ? 1 : 0;
    }

    this.sound.playFlag(placing);
    if (vibrate) {
      this.sound.vibrate(25);
    }

    this.needsRedraw = true;
    if (this.callbacks.onStatsUpdate) {
      this.callbacks.onStatsUpdate(this.minesLeft, this.gameplayTime, true);
    }
    this.saveState();
  }

  executeClear(gx, gy, worldX, worldY, vibrate = false) {
    if (!this.insideGrid(gx, gy) || this.locked || this.won || this.lost) return;
    const i = this.idx(gx, gy);
    if (this.flagGrid[i] || this.clearedGrid[i]) return;

    if (this.firstPress) {
      this.generateMinesFromPress(gx, gy);
      this.firstPress = false;
    }

    this.finalPressX = worldX ?? BOARD_MARGIN + gx * CELL_STEP;
    this.finalPressY = worldY ?? BOARD_MARGIN + gy * CELL_STEP;
    this.cascadeCounter = 0;

    this.clearPlace(gx, gy);

    if (vibrate) {
      this.sound.vibrate(22);
    }

    this.needsRedraw = true;
    if (this.callbacks.onStatsUpdate) {
      this.callbacks.onStatsUpdate(this.minesLeft, this.gameplayTime, false);
    }
    this.saveState();
  }

  /**
   * Chord / Clear Around when tapping an already-cleared number tile whose adjacent flags match its count
   */
  executeChord(gx, gy, worldX, worldY) {
    if (!this.insideGrid(gx, gy) || this.locked || this.won || this.lost) return;
    const i = this.idx(gx, gy);
    if (!this.clearedGrid[i] || this.nearGrid[i] === 0) return;

    const nearFlags = this.countNearbyFlags(gx, gy);
    if (nearFlags !== this.nearGrid[i]) return;

    this.finalPressX = worldX ?? BOARD_MARGIN + gx * CELL_STEP;
    this.finalPressY = worldY ?? BOARD_MARGIN + gy * CELL_STEP;
    this.cascadeCounter = 0;

    for (let dy = -1; dy <= 1; dy++) {
      const ny = gy + dy;
      if (ny < 0 || ny >= this.gridHeight) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx;
        if (nx < 0 || nx >= this.gridWidth) continue;
        const ni = this.idx(nx, ny);
        if (!this.flagGrid[ni] && !this.clearedGrid[ni]) {
          this.clearPlace(nx, ny);
        }
      }
    }

    this.needsRedraw = true;
    this.saveState();
  }

  clearPlace(gx, gy) {
    const i = this.idx(gx, gy);

    if (this.flagGrid[i]) {
      this.flagGrid[i] = 0;
      this.minesLeft++;
    }

    if (!this.clearedGrid[i]) {
      this.clearedGrid[i] = 1;
      if (!this.settings.tweenEnabled) {
        this.removeEaseGrid[i] = 1;
      }
      if (!this.mineGrid[i]) {
        this.leftToClear--;
        this.cascadeCounter++;
        this.sound.playClear(this.cascadeCounter);
      }
    }

    if (this.mineGrid[i]) {
      // Trigger loss!
      if (!this.lost) {
        this.lost = true;
        this.locked = true;
        this.finalActive = true;
        this.finalLost = true;
        this.finalPressTime = 0;
        this.sound.playMinePop(true, 0);
        this.sound.vibrate([45, 40, 80]);
        this.clearSavedState();

        // Start recursive mine reveal wave from this mine
        this.aboutToPopGrid[i] = 1;
        this.mineEaseGrid[i] = 0.01;
        this.queueNeighborsForMinePop(gx, gy, this.gameTime + 0.12);

        if (this.callbacks.onGameEnd) {
          setTimeout(() => {
            if (this.lost) this.callbacks.onGameEnd(false, this.gameplayTime);
          }, 950);
        }
      }
    } else {
      if (this.nearGrid[i] === 0) {
        if (this.settings.clearAnimation) {
          this.queueRippleNeighbors(gx, gy);
        } else {
          this.clearAllAroundInstant(gx, gy);
        }
      }

      // Check win condition
      if (this.leftToClear <= 0 && !this.won && !this.lost) {
        this.triggerWin();
      }
    }
  }

  queueRippleNeighbors(gx, gy) {
    for (let dy = -1; dy <= 1; dy++) {
      const ny = gy + dy;
      if (ny < 0 || ny >= this.gridHeight) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx;
        if (nx < 0 || nx >= this.gridWidth || (dx === 0 && dy === 0)) continue;
        const ni = this.idx(nx, ny);
        if (!this.clearedGrid[ni] && !this.aboutToClearGrid[ni]) {
          this.aboutToClearGrid[ni] = 1;
          const jitter = (Math.random() - 0.5) * 0.03;
          this.toBeCleared.push({
            x: nx,
            y: ny,
            triggerTime: this.gameTime + 0.045 + jitter,
          });
        }
      }
    }
  }

  clearAllAroundInstant(startX, startY) {
    const stack = [[startX, startY]];
    while (stack.length > 0) {
      const [cx, cy] = stack.pop();
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= this.gridHeight) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          if (nx < 0 || nx >= this.gridWidth) continue;
          const ni = this.idx(nx, ny);
          if (!this.clearedGrid[ni] && !this.mineGrid[ni]) {
            if (this.flagGrid[ni]) {
              this.flagGrid[ni] = 0;
              this.minesLeft++;
            }
            this.clearedGrid[ni] = 1;
            this.removeEaseGrid[ni] = this.settings.tweenEnabled ? 0.01 : 1;
            this.leftToClear--;
            if (this.nearGrid[ni] === 0) {
              stack.push([nx, ny]);
            }
          }
        }
      }
    }
  }

  queueNeighborsForMinePop(gx, gy, baseTime) {
    for (let dy = -1; dy <= 1; dy++) {
      const ny = gy + dy;
      if (ny < 0 || ny >= this.gridHeight) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx;
        if (nx < 0 || nx >= this.gridWidth) continue;
        const ni = this.idx(nx, ny);
        if (!this.aboutToPopGrid[ni]) {
          this.aboutToPopGrid[ni] = 1;
          this.mineWaveQueue.push({
            x: nx,
            y: ny,
            triggerTime: baseTime + Math.random() * 0.05,
          });
        }
      }
    }
  }

  triggerWin() {
    this.won = true;
    this.locked = true;
    this.finalActive = true;
    this.finalLost = false;
    this.finalPressTime = 0;
    this.toBeCleared = [];
    this.clearSavedState();

    this.sound.playWin();
    this.sound.vibrate([25, 50, 35]);

    if (this.callbacks.onGameEnd) {
      setTimeout(() => {
        if (this.won) this.callbacks.onGameEnd(true, this.gameplayTime);
      }, 650);
    }
  }

  // ================= INPUT HANDLING (PAN, PINCH, TAP, HOLD, CHORD PREVIEW) =================

  setupInputHandlers() {
    const el = this.canvas;

    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      el.setPointerCapture(e.pointerId);
      this.sound.initContext();

      // Stop momentum panning on touch down
      this.camera.panVx = 0;
      this.camera.panVy = 0;

      const ptr = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        startTime: this.gameTime,
        action: 'none', // 'none' | 'pan' | 'pinch'
        completed: false,
        button: e.button,
        history: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
      };
      this.pointers.set(e.pointerId, ptr);

      // Right-click immediately flags on desktop
      if (e.button === 2 && !this.locked) {
        const { gx, gy } = this.screenToGrid(e.clientX, e.clientY);
        if (this.insideGrid(gx, gy) && !this.clearedGrid[this.idx(gx, gy)]) {
          this.executeFlag(gx, gy, false);
        }
        ptr.completed = true;
        return;
      }

      // If 2 pointers are active, enter pinch-to-zoom mode
      if (this.pointers.size === 2) {
        const [p1, p2] = Array.from(this.pointers.values());
        p1.action = 'pinch';
        p2.action = 'pinch';
        p1.completed = true;
        p2.completed = true;
        this.previewTargets.clear();

        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const midScreenX = (p1.x + p2.x) / 2;
        const midScreenY = (p1.y + p2.y) / 2;
        this.pinchState = {
          startDist: Math.max(10, dist),
          startCamWidth: this.camera.width,
          anchorWorldX: this.screenToWorldX(midScreenX),
          anchorWorldY: this.screenToWorldY(midScreenY),
        };
      }

      this.needsRedraw = true;
    });

    el.addEventListener('pointermove', (e) => {
      const ptr = this.pointers.get(e.pointerId);
      if (!ptr) return;

      const prevX = ptr.x;
      const prevY = ptr.y;
      ptr.x = e.clientX;
      ptr.y = e.clientY;

      const now = performance.now();
      ptr.history.push({ x: e.clientX, y: e.clientY, t: now });
      while (ptr.history.length > 6 || (ptr.history.length > 2 && now - ptr.history[0].t > 100)) {
        ptr.history.shift();
      }

      // Handle two-finger pinch zoom & simultaneous pan
      if (ptr.action === 'pinch' && this.pointers.size >= 2 && this.pinchState) {
        const [p1, p2] = Array.from(this.pointers.values());
        const dist = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
        const midScreenX = (p1.x + p2.x) / 2;
        const midScreenY = (p1.y + p2.y) / 2;

        const scaleRatio = this.pinchState.startDist / dist;
        this.camera.width = this.pinchState.startCamWidth * scaleRatio;
        const aspect = this.getCanvasAspect();
        this.camera.height = this.camera.width / aspect;

        // Keep anchor world point under the midpoint of the two fingers
        const { sx, sy, width, height } = this.getCanvasRelativeCoords(midScreenX, midScreenY);
        const normX = sx / width;
        const normY = sy / height;
        this.camera.x = this.pinchState.anchorWorldX - this.camera.width * normX;
        this.camera.y = this.pinchState.anchorWorldY - this.camera.height * normY;

        this.clampCamera();
        this.needsRedraw = true;
        return;
      }

      // Check if single finger moved past drag threshold -> switch to Pan
      if (ptr.action === 'none') {
        const moveDist = Math.hypot(ptr.x - ptr.startX, ptr.y - ptr.startY);
        if (moveDist > 12) {
          ptr.action = 'pan';
          ptr.completed = true;
          this.previewTargets.clear();
        }
      }

      if (ptr.action === 'pan') {
        const { width, height } = this.getCanvasRelativeCoords(0, 0);
        const dxWorld = ((prevX - ptr.x) / width) * this.camera.width;
        const dyWorld = ((prevY - ptr.y) / height) * this.camera.height;
        this.camera.x += dxWorld;
        this.camera.y += dyWorld;
        this.clampCamera();
        this.needsRedraw = true;
      }
    });

    const handlePointerUp = (e, isCancel = false) => {
      const ptr = this.pointers.get(e.pointerId);
      if (!ptr) return;
      this.pointers.delete(e.pointerId);
      this.previewTargets.clear();

      // If one finger lifted from a pinch, convert remaining finger smoothly to pan
      if (ptr.action === 'pinch') {
        this.pinchState = null;
        if (this.pointers.size === 1) {
          const remaining = Array.from(this.pointers.values())[0];
          remaining.action = 'pan';
          remaining.completed = true;
          remaining.history = [{ x: remaining.x, y: remaining.y, t: performance.now() }];
        }
        this.needsRedraw = true;
        return;
      }

      // Apply inertial velocity if ending a pan gesture
      if (ptr.action === 'pan' && !isCancel && ptr.history.length >= 2) {
        const first = ptr.history[0];
        const last = ptr.history[ptr.history.length - 1];
        const dt = Math.max(8, last.t - first.t) / 1000;
        if (performance.now() - last.t < 80) {
          const { width, height } = this.getCanvasRelativeCoords(0, 0);
          const vxScreen = (first.x - last.x) / dt;
          const vyScreen = (first.y - last.y) / dt;
          this.camera.panVx = (vxScreen / width) * this.camera.width;
          this.camera.panVy = (vyScreen / height) * this.camera.height;
        }
        this.needsRedraw = true;
        return;
      }

      // Short tap release on a tile
      if (!isCancel && !ptr.completed && ptr.action === 'none' && !this.locked) {
        const pressDuration = this.gameTime - ptr.startTime;
        const startCell = this.screenToGrid(ptr.startX, ptr.startY);
        const endCell = this.screenToGrid(ptr.x, ptr.y);

        if (
          this.insideGrid(endCell.gx, endCell.gy) &&
          startCell.gx === endCell.gx &&
          startCell.gy === endCell.gy
        ) {
          const i = this.idx(endCell.gx, endCell.gy);

          if (this.clearedGrid[i] && pressDuration < 0.4) {
            // Chord clear around number tile
            this.executeChord(endCell.gx, endCell.gy, endCell.wx, endCell.wy);
          } else if (!this.clearedGrid[i]) {
            if (this.settings.switchedControls) {
              // Switched mode: short tap flags!
              if (pressDuration < 0.35) {
                this.executeFlag(endCell.gx, endCell.gy, false);
              }
            } else {
              // Default mode: short tap clears!
              // Note: miniSweeper's anti-mistake window (0.3s, or 0.2s on mines) prevents accidental slow-taps from detonating a bomb when intending to long-press!
              const maxTapTime = this.mineGrid[i] && !this.firstPress ? 0.25 : 0.34;
              if (pressDuration < maxTapTime) {
                this.executeClear(endCell.gx, endCell.gy, endCell.wx, endCell.wy, false);
              }
            }
          }
        }
      }

      this.needsRedraw = true;
    };

    el.addEventListener('pointerup', (e) => handlePointerUp(e, false));
    el.addEventListener('pointercancel', (e) => handlePointerUp(e, true));

    // Mouse wheel zoom centered on cursor
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.resizeViewport());
      window.visualViewport.addEventListener('scroll', () => this.resizeViewport());
    }

    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();

        const { sx, sy, width, height } = this.getCanvasRelativeCoords(e.clientX, e.clientY);
        const normX = sx / width;
        const normY = sy / height;
        const worldX = this.screenToWorldX(e.clientX);
        const worldY = this.screenToWorldY(e.clientY);

        const zoomFactor = e.deltaY > 0 ? 1.14 : 0.88;
        this.camera.width *= zoomFactor;
        const aspect = this.getCanvasAspect();
        this.camera.height = this.camera.width / aspect;

        this.camera.x = worldX - this.camera.width * normX;
        this.camera.y = worldY - this.camera.height * normY;
        this.clampCamera();
        this.needsRedraw = true;
      },
      { passive: false }
    );
  }

  // ================= UPDATE LOOP (EASING, RIPPLES, HOLD DETECTION) =================

  update(dt) {
    if (!this.enabled) return;

    // Cap dt to avoid huge jumps on tab switch
    dt = Math.min(dt, 0.1);
    this.gameTime += dt;

    let activeAnimations = false;

    // Update gameplay timer
    if (!this.firstPress && !this.locked && !this.won && !this.lost) {
      this.gameplayTime += dt;
      if (this.callbacks.onTimerUpdate) {
        this.callbacks.onTimerUpdate(this.gameplayTime);
      }
    }

    // 1. Check active pointer holds (long-press action & chord neighbor shrink preview)
    this.previewTargets.clear();
    if (!this.locked && !this.won && !this.lost) {
      for (const ptr of this.pointers.values()) {
        if (ptr.action === 'none' && !ptr.completed) {
          const holdTime = this.gameTime - ptr.startTime;
          const startCell = this.screenToGrid(ptr.startX, ptr.startY);
          const curCell = this.screenToGrid(ptr.x, ptr.y);

          if (
            this.insideGrid(curCell.gx, curCell.gy) &&
            startCell.gx === curCell.gx &&
            startCell.gy === curCell.gy
          ) {
            const cellIdx = this.idx(curCell.gx, curCell.gy);

            // Chord preview when holding a cleared number tile with matching flags
            if (this.clearedGrid[cellIdx] && this.nearGrid[cellIdx] > 0 && holdTime < 0.35) {
              if (this.countNearbyFlags(curCell.gx, curCell.gy) === this.nearGrid[cellIdx]) {
                for (let dy = -1; dy <= 1; dy++) {
                  const ny = curCell.gy + dy;
                  if (ny < 0 || ny >= this.gridHeight) continue;
                  for (let dx = -1; dx <= 1; dx++) {
                    const nx = curCell.gx + dx;
                    if (nx < 0 || nx >= this.gridWidth) continue;
                    const ni = this.idx(nx, ny);
                    if (!this.flagGrid[ni] && !this.clearedGrid[ni]) {
                      this.previewTargets.add(ni);
                    }
                  }
                }
              }
            }

            // Long-press (> 0.34s) triggers secondary action (Flag in normal mode, Clear in switched mode)
            if (holdTime >= 0.34) {
              if (!this.clearedGrid[cellIdx]) {
                if (this.settings.switchedControls) {
                  this.executeClear(curCell.gx, curCell.gy, curCell.wx, curCell.wy, true);
                } else {
                  this.executeFlag(curCell.gx, curCell.gy, true);
                }
              }
              ptr.completed = true;
            } else {
              activeAnimations = true; // Keep ticking while finger is held down waiting for 0.34s threshold
            }
          }
        }
      }
    }

    // 2. Inertial camera panning
    if (Math.hypot(this.camera.panVx, this.camera.panVy) > 5) {
      this.camera.x += this.camera.panVx * dt;
      this.camera.y += this.camera.panVy * dt;
      const damping = Math.pow(0.04, dt);
      this.camera.panVx *= damping;
      this.camera.panVy *= damping;
      this.clampCamera();
      activeAnimations = true;
    } else {
      this.camera.panVx = 0;
      this.camera.panVy = 0;
    }

    // 3. Process delayed ripple flood-fill queue
    if (this.toBeCleared.length > 0) {
      activeAnimations = true;
      for (let i = this.toBeCleared.length - 1; i >= 0; i--) {
        const item = this.toBeCleared[i];
        if (this.gameTime >= item.triggerTime) {
          this.toBeCleared.splice(i, 1);
          const ci = this.idx(item.x, item.y);
          if (!this.clearedGrid[ci] && !this.lost) {
            this.clearPlace(item.x, item.y);
          }
        }
      }
    }

    // 4. Process loss mine reveal wave queue
    if (this.mineWaveQueue.length > 0) {
      activeAnimations = true;
      for (let i = this.mineWaveQueue.length - 1; i >= 0; i--) {
        const item = this.mineWaveQueue[i];
        if (this.gameTime >= item.triggerTime) {
          this.mineWaveQueue.splice(i, 1);
          const ci = this.idx(item.x, item.y);
          if (this.mineGrid[ci] && this.mineEaseGrid[ci] === 0) {
            this.mineEaseGrid[ci] = 0.01;
            this.minePitchStep++;
            if (Math.random() < 0.35) {
              this.sound.playMinePop(false, this.minePitchStep);
            }
          }
          this.queueNeighborsForMinePop(item.x, item.y, this.gameTime + 0.035);
        }
      }
    }

    // 5. Update per-cell easing arrays
    const totalCells = this.gridWidth * this.gridHeight;
    for (let i = 0; i < totalCells; i++) {
      // Remove (tile clear) ease: 0 -> 1
      if (this.clearedGrid[i] && this.removeEaseGrid[i] < 1) {
        this.removeEaseGrid[i] = Math.min(1, this.removeEaseGrid[i] + dt * 3.4);
        activeAnimations = true;
      }

      // Flag ease: 0 <-> 1
      const targetFlag = this.flagGrid[i] ? 1 : 0;
      if (this.flagEaseGrid[i] !== targetFlag) {
        this.flagEaseGrid[i] = valueShift(this.flagEaseGrid[i], targetFlag, dt * 3.6);
        activeAnimations = true;
      }

      // Mine pop ease on loss: 0 -> 1
      if (this.mineEaseGrid[i] > 0 && this.mineEaseGrid[i] < 1) {
        this.mineEaseGrid[i] = Math.min(1, this.mineEaseGrid[i] + dt * 3.0);
        activeAnimations = true;
      }

      // Preview shrink ease: 0 <-> 1
      const targetPreview = this.previewTargets.has(i) ? 1 : 0;
      if (this.previewEaseGrid[i] !== targetPreview) {
        const speed = targetPreview > this.previewEaseGrid[i] ? 10 : 7.5;
        this.previewEaseGrid[i] = valueShift(this.previewEaseGrid[i], targetPreview, dt * speed);
        activeAnimations = true;
      }
    }

    // 6. Final Win/Loss wave animation
    if (this.finalActive) {
      this.finalPressTime += dt;
      activeAnimations = true;
      if ((this.finalLost && this.finalPressTime > 3.0) || this.finalPressTime > 6.5) {
        this.finalActive = false;
      }
    }

    if (activeAnimations) {
      this.needsRedraw = true;
    }
  }

  // ================= CANVAS RENDERING (scr_draw_cell port) =================

  render() {
    if (!this.needsRedraw || !this.themeColors) return;

    // Ensure backing buffer always matches live CSS rect & DPR (handles DevTools zoom / mobile toolbar changes)
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const expectedW = Math.max(1, Math.round((rect.width || window.innerWidth) * dpr));
    const expectedH = Math.max(1, Math.round((rect.height || window.innerHeight) * dpr));
    if (this.canvas.width !== expectedW || this.canvas.height !== expectedH) {
      this.resizeViewport();
    }

    this.needsRedraw = false;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const colors = this.themeColors;

    // Clear background
    ctx.fillStyle = colors.backColor;
    ctx.fillRect(0, 0, w, h);

    // Scale from world coordinates to physical canvas pixels
    const scale = w / this.camera.width;

    // Calculate visible grid bounds (frustum culling)
    const startX = clamp(this.worldToGridX(this.camera.x) - 1, 0, this.gridWidth - 1);
    const startY = clamp(this.worldToGridY(this.camera.y) - 1, 0, this.gridHeight - 1);
    const endX = clamp(this.worldToGridX(this.camera.x + this.camera.width) + 2, 0, this.gridWidth);
    const endY = clamp(this.worldToGridY(this.camera.y + this.camera.height) + 2, 0, this.gridHeight);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let gy = startY; gy < endY; gy++) {
      for (let gx = startX; gx < endX; gx++) {
        this.drawCell(ctx, gx, gy, scale, colors);
      }
    }
  }

  drawCell(ctx, gx, gy, scale, colors) {
    const i = this.idx(gx, gy);
    const worldX = BOARD_MARGIN + gx * CELL_STEP;
    const worldY = BOARD_MARGIN + gy * CELL_STEP;

    let screenX = (worldX - this.camera.x) * scale;
    let screenY = (worldY - this.camera.y) * scale;
    let cellScale = scale;
    let winRotDeg = 0;
    let specialScale = 1;
    let specialRotDeg = 0;

    // Board-wide Win or Loss shockwave (ported from scr_draw_cell.gml)
    if (this.finalActive) {
      const dx = worldX - this.finalPressX;
      const dy = worldY - this.finalPressY;
      const dist = Math.hypot(dx, dy) / 2;

      if (this.finalLost) {
        const wavePos = this.finalPressTime * 680;
        const diff = Math.abs(dist - wavePos);
        if (diff < 120 && dist < 950) {
          const intense = (1 - diff / 120) * (1 - dist / 950);
          const angle = Math.atan2(dy, dx);
          cellScale *= 1 + intense / 3.5;
          screenX += Math.cos(angle) * intense * 18 * scale;
          screenY += Math.sin(angle) * intense * 18 * scale;
        }
      } else {
        const distPow = Math.pow(dist, 0.9);
        const shiftIn = clamp(
          ((Math.pow(this.finalPressTime / 3 + 0.4, 1.3) - 0.305) * 10 - distPow / 60) / 3,
          0,
          1
        );
        if (shiftIn > 0 && shiftIn < 1) {
          cellScale *= easeQuadOutPeek(1, 0.9, shiftIn, 0.6, 1);
          if (shiftIn > 0.4 && shiftIn < 0.8) {
            specialScale *= easeQuadOutPeek(1, 0, shiftIn - 0.4, 0.2, 0.4);
          }
          winRotDeg = easeBackInOut(0, 90, shiftIn, 1.1);
          specialRotDeg = shiftIn < 0.6 ? winRotDeg : winRotDeg - 90;
        }
      }
    }

    const degToRad = Math.PI / 180;
    const isCleared = this.clearedGrid[i] === 1;

    if (isCleared) {
      // 1. Cleared background square
      if (colors.clearedColor.toLowerCase() !== colors.backColor.toLowerCase()) {
        this.drawRoundedTile(
          ctx,
          screenX,
          screenY,
          CELL_SIZE * cellScale,
          CELL_RADIUS * cellScale,
          winRotDeg * degToRad,
          colors.clearedColor,
          1
        );
      }

      // 2. Adjacent mine number
      const count = this.nearGrid[i];
      if (count >= 1 && count <= 8) {
        const fontSize = Math.max(8, 76 * cellScale * specialScale);
        ctx.save();
        ctx.translate(screenX, screenY);
        if (specialRotDeg !== 0) {
          ctx.rotate(-specialRotDeg * 2 * degToRad);
        }
        ctx.font = `300 ${fontSize}px Roboto, sans-serif`;
        ctx.fillStyle = colors.textColor;
        ctx.fillText(String(count), 0, fontSize * 0.04);
        ctx.restore();
      }

      // 3. Falling/shrinking solid cover tile during reveal animation
      const remEase = this.removeEaseGrid[i];
      if (remEase < 1) {
        const farIn = easeQuadOut(0, 1, remEase);
        const rotRad = farIn * 10 * degToRad;
        const alpha = 1 - farIn;
        const sizeMult = 1 - farIn;

        if (alpha > 0.01 && sizeMult > 0.01) {
          this.drawRoundedTile(
            ctx,
            screenX,
            screenY + scale * farIn * 8,
            CELL_SIZE * cellScale * sizeMult,
            CELL_RADIUS * cellScale * sizeMult,
            -winRotDeg * degToRad + rotRad,
            colors.solidColor,
            alpha
          );
        }
      }

      // 4. Revealed mine (if this cleared tile had a mine)
      if (this.mineGrid[i]) {
        const mSize = easeBackOut(0, 1, this.mineEaseGrid[i], 3.5);
        if (mSize > 0.01) {
          this.drawMineIcon(
            ctx,
            screenX,
            screenY,
            38 * cellScale * mSize,
            -winRotDeg * degToRad,
            colors.mineColor
          );
        }
      }
    } else {
      // Uncleared solid tile
      const previewInc = this.previewEaseGrid[i];
      const tileScale = cellScale * (1 - previewInc * 0.2);
      const tileRot = -(previewInc * 5 + winRotDeg) * degToRad;

      this.drawRoundedTile(
        ctx,
        screenX,
        screenY,
        CELL_SIZE * tileScale,
        CELL_RADIUS * tileScale,
        tileRot,
        colors.solidColor,
        1
      );

      // Flag or unflagged mine on loss
      const fEase = this.flagEaseGrid[i];
      if (fEase > 0) {
        const ySize = easeBackOut(0, 1, fEase, 3.5);
        const xSize = lerp(ySize, easeExpoIn(0, 1, fEase), 0.5);

        if (this.lost && this.mineGrid[i] && this.mineEaseGrid[i] > 0) {
          // Flagged mine on loss: flag tilts aside and mine pops in!
          const mEase = this.mineEaseGrid[i];
          const shiftX = scale * -8 * mEase;
          const shiftY = lerp(28, 12, mEase) * scale;
          const tiltDeg = easeQuadInOut(0, 28, mEase);

          this.drawFlagIcon(
            ctx,
            screenX + shiftX,
            screenY + shiftY,
            cellScale * xSize * specialScale,
            cellScale * ySize * specialScale,
            -(tiltDeg + specialRotDeg * 2) * degToRad,
            colors.flagColor,
            1 - mEase * 0.5
          );

          const mSize = easeBackOut(0, 0.76, mEase, 3.5);
          const mShift = scale * 15 * mEase;
          this.drawMineIcon(
            ctx,
            screenX + mShift,
            screenY + mShift,
            38 * cellScale * mSize,
            -winRotDeg * degToRad,
            colors.mineColor
          );
        } else {
          // Standard flag
          const flagRot = -(specialRotDeg * 2 + (1 - ySize) * 10) * degToRad;
          this.drawFlagIcon(
            ctx,
            screenX,
            screenY + 28 * scale,
            cellScale * xSize * specialScale,
            cellScale * ySize * specialScale,
            flagRot,
            colors.flagColor,
            1
          );
        }
      } else if (this.lost && this.mineGrid[i] && this.mineEaseGrid[i] > 0) {
        const mSize = easeBackOut(0, 1, this.mineEaseGrid[i], 3.5);
        if (mSize > 0.01) {
          this.drawMineIcon(
            ctx,
            screenX,
            screenY,
            38 * cellScale * mSize,
            -winRotDeg * degToRad,
            colors.mineColor
          );
        }
      }
    }
  }

  drawRoundedTile(ctx, cx, cy, size, radius, rotationRad, color, alpha) {
    if (size <= 0.5 || alpha <= 0) return;
    const half = size / 2;
    const r = Math.min(radius, half);

    ctx.save();
    ctx.translate(cx, cy);
    if (rotationRad !== 0) ctx.rotate(rotationRad);
    if (alpha < 1) ctx.globalAlpha = alpha;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-half, -half, size, size, r);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draws the flag anchored at the bottom of its pole (matches miniSweeper's bottom-anchored sFlag)
   */
  drawFlagIcon(ctx, bottomX, bottomY, scaleX, scaleY, rotationRad, color, standScale = 1) {
    if (Math.abs(scaleX) < 0.01 || Math.abs(scaleY) < 0.01) return;

    ctx.save();
    ctx.translate(bottomX, bottomY);
    if (rotationRad !== 0) ctx.rotate(rotationRad);
    ctx.scale(scaleX, scaleY);

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Pole (from y=0 up to y=-58)
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-12, -56);
    ctx.stroke();

    // Flag banner triangle
    ctx.beginPath();
    ctx.moveTo(-12, -56);
    ctx.lineTo(26, -41);
    ctx.lineTo(-12, -25);
    ctx.closePath();
    ctx.fill();

    // Base stand
    if (standScale > 0.05) {
      ctx.beginPath();
      ctx.moveTo(-12 - 14 * standScale, 0);
      ctx.lineTo(-12 + 14 * standScale, 0);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawMineIcon(ctx, cx, cy, radius, rotationRad, color) {
    if (radius <= 0.5) return;

    ctx.save();
    ctx.translate(cx, cy);
    if (rotationRad !== 0) ctx.rotate(rotationRad);

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = radius * 0.22;

    // 8 spikes (4 lines through center)
    const spikeLen = radius * 0.95;
    for (let a = 0; a < 4; a++) {
      const angle = (a * Math.PI) / 4;
      const dx = Math.cos(angle) * spikeLen;
      const dy = Math.sin(angle) * spikeLen;
      ctx.beginPath();
      ctx.moveTo(-dx, -dy);
      ctx.lineTo(dx, dy);
      ctx.stroke();
    }

    // Core circle
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.58, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ================= LOCALSTORAGE SAVE / RESUME =================

  saveState() {
    if (this.firstPress || this.won || this.lost) return;
    try {
      const payload = {
        w: this.gridWidth,
        h: this.gridHeight,
        m: this.gridMines,
        time: this.gameplayTime,
        mines: Array.from(this.mineGrid),
        cleared: Array.from(this.clearedGrid),
        flags: Array.from(this.flagGrid),
      };
      localStorage.setItem('minisweeper_active_game', JSON.stringify(payload));
    } catch (_) {}
  }

  clearSavedState() {
    try {
      localStorage.removeItem('minisweeper_active_game');
    } catch (_) {}
  }

  loadSavedState() {
    try {
      const raw = localStorage.getItem('minisweeper_active_game');
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.w || !data.h || !data.mines) return false;

      this.initGrid(data.w, data.h, data.m);
      this.firstPress = false;
      this.gameplayTime = data.time || 0;

      const size = data.w * data.h;
      let flagsCount = 0;
      let clearedSafeCount = 0;

      for (let i = 0; i < size; i++) {
        this.mineGrid[i] = data.mines[i] ? 1 : 0;
        this.clearedGrid[i] = data.cleared[i] ? 1 : 0;
        this.flagGrid[i] = data.flags[i] ? 1 : 0;

        if (this.clearedGrid[i]) {
          this.removeEaseGrid[i] = 1;
          if (!this.mineGrid[i]) clearedSafeCount++;
        }
        if (this.flagGrid[i]) {
          this.flagEaseGrid[i] = 1;
          flagsCount++;
        }
      }

      this.calculateNearGrid();
      this.minesLeft = this.gridMines - flagsCount;
      this.leftToClear = size - this.gridMines - clearedSafeCount;
      this.needsRedraw = true;
      return true;
    } catch (_) {
      return false;
    }
  }
}
