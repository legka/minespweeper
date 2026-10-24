import { applyThemeToDOM } from './themes.js';
import { SoundEngine } from './audio.js';
import { MinesweeperGame } from './game.js';

// Standard presets from AntonBergaker/miniSweeper (orient automatically to portrait/landscape)
const BASE_PRESETS = [
  { w: 7, h: 10, m: 10 },
  { w: 12, h: 22, m: 40 },
  { w: 18, h: 32, m: 100 },
];

function formatTime(seconds, showTenths = false) {
  const totalSecs = Math.max(0, seconds);
  const mins = Math.floor(totalSecs / 60);
  const secs = Math.floor(totalSecs % 60);
  const tenths = Math.floor((totalSecs % 1) * 10);
  const secStr = secs < 10 ? `0${secs}` : `${secs}`;
  if (showTenths) {
    return `${mins}:${secStr}.${tenths}`;
  }
  return `${mins}:${secStr}`;
}

function getUnorderedGridKey(w, h, m) {
  const minSide = Math.min(w, h);
  const maxSide = Math.max(w, h);
  return `${minSide}x${maxSide}_${m}`;
}

class AppController {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.sound = new SoundEngine();

    this.selectedPresetIndex = 1; // Default 12x22 40*
    this.isCustomMode = false;
    this.customW = 12;
    this.customH = 22;
    this.customM = 40;

    this.highScores = this.loadHighScores();
    this.savedSettings = this.loadSettings();

    this.game = new MinesweeperGame(this.canvas, this.sound);
    this.game.callbacks = {
      onStatsUpdate: (minesLeft, time, bounce) => this.updateHUD(minesLeft, time, bounce),
      onTimerUpdate: (time) => this.updateTimerDisplay(time),
      onGameEnd: (won, time) => this.showGameEndCard(won, time),
    };

    this.applySavedSettings();
    this.bindUIEvents();
    this.updatePresetOrientation();
    this.setupDraggableEndCard();

    // If an active game was saved in localStorage, resume it immediately (just like miniSweeper)
    if (this.game.loadSavedState()) {
      this.startActiveSession(false);
    }

    // Start main loop
    this.lastTime = performance.now();
    const loop = (now) => {
      const dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      this.game.update(dt);
      this.game.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  loadSettings() {
    try {
      const raw = localStorage.getItem('minisweeper_settings');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      theme: 'Default',
      showSwitchButton: true,
      audio: true,
      vibrate: true,
      tween: true,
      ripple: true,
      showTimer: true,
      showMines: 'always',
      presetIndex: 1,
    };
  }

  saveSettings() {
    try {
      localStorage.setItem(
        'minisweeper_settings',
        JSON.stringify({
          theme: this.game.settings.theme,
          showSwitchButton: this.game.settings.showSwitchButton,
          audio: this.sound.enabled,
          vibrate: this.sound.vibrateEnabled,
          tween: this.game.settings.tweenEnabled,
          ripple: this.game.settings.clearAnimation,
          showTimer: this.game.settings.showTimer,
          showMines: this.game.settings.showMines,
          presetIndex: this.selectedPresetIndex,
        })
      );
    } catch (_) {}
  }

  loadHighScores() {
    try {
      const raw = localStorage.getItem('minisweeper_highscores');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {};
  }

  saveHighScores() {
    try {
      localStorage.setItem('minisweeper_highscores', JSON.stringify(this.highScores));
    } catch (_) {}
  }

  applySavedSettings() {
    const s = this.savedSettings;
    this.selectedPresetIndex = s.presetIndex ?? 1;
    this.setTheme(s.theme || 'Default');

    this.game.settings.showSwitchButton = s.showSwitchButton !== false;
    this.sound.enabled = s.audio !== false;
    this.sound.vibrateEnabled = s.vibrate !== false;
    this.game.settings.tweenEnabled = s.tween !== false;
    this.game.settings.clearAnimation = s.ripple !== false;
    this.game.settings.showTimer = s.showTimer !== false;
    this.game.settings.showMines = s.showMines || 'always';

    // Sync checkboxes
    document.getElementById('toggle-switch-btn').checked = this.game.settings.showSwitchButton;
    document.getElementById('toggle-audio').checked = this.sound.enabled;
    document.getElementById('toggle-vibrate').checked = this.sound.vibrateEnabled;
    document.getElementById('toggle-tween').checked = this.game.settings.tweenEnabled;
    document.getElementById('toggle-ripple').checked = this.game.settings.clearAnimation;
    document.getElementById('toggle-timer').checked = this.game.settings.showTimer;

    document.querySelectorAll('#mines-left-selector .theme-pill').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.showmines === this.game.settings.showMines);
    });
  }

  setTheme(themeName) {
    this.game.settings.theme = themeName;
    const themeObj = applyThemeToDOM(themeName);
    this.game.setThemeColors(themeObj);

    document.querySelectorAll('#theme-selector .theme-pill').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === themeName);
    });
    this.saveSettings();
  }

  getOrientedPreset(index) {
    const base = BASE_PRESETS[index] || BASE_PRESETS[1];
    const isWide = window.innerWidth > window.innerHeight;
    return {
      w: isWide ? base.h : base.w,
      h: isWide ? base.w : base.h,
      m: base.m,
    };
  }

  updatePresetOrientation() {
    BASE_PRESETS.forEach((_, idx) => {
      const p = this.getOrientedPreset(idx);
      const labelEl = document.getElementById(`preset-label-${idx}`);
      if (labelEl) {
        labelEl.textContent = `${p.w}x${p.h} ${p.m}`;
      }
    });

    document.querySelectorAll('#preset-selector .picker-Option').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.preset) === this.selectedPresetIndex);
    });

    this.updatePresetMetaDisplay();
  }

  getSelectedGridConfig() {
    if (this.isCustomMode) {
      return { w: this.customW, h: this.customH, m: this.customM };
    }
    return this.getOrientedPreset(this.selectedPresetIndex);
  }

  updatePresetMetaDisplay() {
    const cfg = this.getSelectedGridConfig();
    const density = Math.round((cfg.m / (cfg.w * cfg.h)) * 100);
    document.getElementById('preset-density').textContent = `${density}% mines`;

    const key = getUnorderedGridKey(cfg.w, cfg.h, cfg.m);
    const best = this.highScores[key];
    document.getElementById('preset-record').textContent =
      best !== undefined ? `Best: ${formatTime(best, true)}` : '';
  }

  bindUIEvents() {
    window.addEventListener('resize', () => {
      this.game.resizeViewport();
      this.updatePresetOrientation();
    });

    // Preset picker buttons
    document.querySelectorAll('#preset-selector .picker-Option').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedPresetIndex = Number(btn.dataset.preset);
        this.updatePresetOrientation();
        this.saveSettings();
      });
    });

    // Toggle Custom vs Presets
    const btnToggleCustom = document.getElementById('btn-toggle-custom');
    const presetSelector = document.getElementById('preset-selector');
    const customControls = document.getElementById('custom-controls');

    btnToggleCustom.addEventListener('click', () => {
      this.isCustomMode = !this.isCustomMode;
      btnToggleCustom.textContent = this.isCustomMode ? 'Presets' : 'Custom';
      presetSelector.classList.toggle('hidden', this.isCustomMode);
      customControls.classList.toggle('hidden', !this.isCustomMode);
      if (this.isCustomMode) {
        const p = this.getOrientedPreset(this.selectedPresetIndex);
        this.customW = p.w;
        this.customH = p.h;
        this.customM = p.m;
        this.syncCustomSliders();
      }
      this.updatePresetMetaDisplay();
    });

    // Custom Sliders
    const inW = document.getElementById('input-width');
    const inH = document.getElementById('input-height');
    const inM = document.getElementById('input-mines');

    const onCustomInput = () => {
      this.customW = Number(inW.value);
      this.customH = Number(inH.value);
      const maxMines = Math.max(1, Math.min(999, this.customW * this.customH - 9));
      inM.max = String(maxMines);
      this.customM = Math.min(Number(inM.value), maxMines);
      inM.value = String(this.customM);
      this.syncCustomSliders();
      this.updatePresetMetaDisplay();
    };

    inW.addEventListener('input', onCustomInput);
    inH.addEventListener('input', onCustomInput);
    inM.addEventListener('input', onCustomInput);

    // Play Button
    document.getElementById('btn-play').addEventListener('click', () => {
      this.sound.initContext();
      this.startActiveSession(true);
    });

    // Mode Switch Button (Bottom-Right Dig / Flag Toggle)
    const btnSwitch = document.getElementById('btn-mode-switch');
    const toggleControlMode = () => {
      this.game.settings.switchedControls = !this.game.settings.switchedControls;
      btnSwitch.classList.add('flipping');
      this.sound.vibrate(15);
      setTimeout(() => {
        btnSwitch.classList.toggle('flag-mode', this.game.settings.switchedControls);
        btnSwitch.classList.remove('flipping');
      }, 110);
    };

    btnSwitch.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleControlMode();
    });

    // Keyboard shortcut (Space or F toggles Dig/Flag mode, R restarts)
    window.addEventListener('keydown', (e) => {
      if (!this.game.enabled) return;
      if (e.code === 'Space' || e.code === 'KeyF') {
        e.preventDefault();
        toggleControlMode();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        this.startActiveSession(true);
      }
    });

    // Open Settings from Main Menu or HUD Gear
    document.getElementById('btn-open-settings').addEventListener('click', () => {
      this.openSettings(false);
    });

    document.getElementById('btn-hud-settings').addEventListener('click', () => {
      this.openSettings(true);
    });

    document.getElementById('btn-close-settings').addEventListener('click', () => {
      this.closeSettings();
    });

    // In-game settings actions
    document.getElementById('btn-settings-restart').addEventListener('click', () => {
      this.closeSettings();
      this.startActiveSession(true);
    });

    document.getElementById('btn-settings-menu').addEventListener('click', () => {
      this.game.clearSavedState();
      this.closeSettings();
      this.returnToMainMenu();
    });

    // Theme pills
    document.querySelectorAll('#theme-selector .theme-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setTheme(btn.dataset.theme);
      });
    });

    // Show Mines Left pills
    document.querySelectorAll('#mines-left-selector .theme-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.game.settings.showMines = btn.dataset.showmines;
        document.querySelectorAll('#mines-left-selector .theme-pill').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        this.updateHUD(this.game.minesLeft, this.game.gameplayTime, false);
        this.saveSettings();
      });
    });

    // Toggle switches
    document.getElementById('toggle-switch-btn').addEventListener('change', (e) => {
      this.game.settings.showSwitchButton = e.target.checked;
      document
        .getElementById('btn-mode-switch')
        .classList.toggle('hidden', !this.game.settings.showSwitchButton);
      this.game.clampCamera();
      this.game.needsRedraw = true;
      this.saveSettings();
    });

    document.getElementById('toggle-audio').addEventListener('change', (e) => {
      this.sound.enabled = e.target.checked;
      this.saveSettings();
    });

    document.getElementById('toggle-vibrate').addEventListener('change', (e) => {
      this.sound.vibrateEnabled = e.target.checked;
      if (this.sound.vibrateEnabled) this.sound.vibrate(25);
      this.saveSettings();
    });

    document.getElementById('toggle-tween').addEventListener('change', (e) => {
      this.game.settings.tweenEnabled = e.target.checked;
      this.saveSettings();
    });

    document.getElementById('toggle-ripple').addEventListener('change', (e) => {
      this.game.settings.clearAnimation = e.target.checked;
      this.saveSettings();
    });

    document.getElementById('toggle-timer').addEventListener('change', (e) => {
      this.game.settings.showTimer = e.target.checked;
      document
        .getElementById('hud-timer')
        .classList.toggle('hidden', !this.game.settings.showTimer);
      this.saveSettings();
    });

    // End card buttons
    document.getElementById('btn-end-again').addEventListener('click', () => {
      document.getElementById('game-end-card').classList.add('hidden');
      this.startActiveSession(true);
    });

    document.getElementById('btn-end-menu').addEventListener('click', () => {
      document.getElementById('game-end-card').classList.add('hidden');
      this.returnToMainMenu();
    });
  }

  syncCustomSliders() {
    document.getElementById('input-width').value = String(this.customW);
    document.getElementById('val-width').textContent = String(this.customW);
    document.getElementById('input-height').value = String(this.customH);
    document.getElementById('val-height').textContent = String(this.customH);
    document.getElementById('input-mines').value = String(this.customM);
    document.getElementById('val-mines').textContent = String(this.customM);
  }

  startActiveSession(initNewBoard = true) {
    if (initNewBoard) {
      const cfg = this.getSelectedGridConfig();
      this.game.clearSavedState();
      this.game.initGrid(cfg.w, cfg.h, cfg.m);
    }

    this.game.enabled = true;
    this.game.locked = false;

    document.getElementById('menu-main').classList.add('hidden');
    document.getElementById('menu-settings').classList.add('hidden');
    document.getElementById('game-end-card').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');

    document
      .getElementById('btn-mode-switch')
      .classList.toggle('hidden', !this.game.settings.showSwitchButton);
    document
      .getElementById('hud-timer')
      .classList.toggle('hidden', !this.game.settings.showTimer);

    this.updateHUD(this.game.minesLeft, this.game.gameplayTime, false);
    this.game.needsRedraw = true;
  }

  returnToMainMenu() {
    this.game.enabled = false;
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('game-end-card').classList.add('hidden');
    document.getElementById('menu-main').classList.remove('hidden');
    this.updatePresetOrientation();
  }

  openSettings(inGame) {
    const panel = document.getElementById('settings-ingame-panel');
    panel.classList.toggle('hidden', !inGame);

    if (inGame) {
      this.game.locked = true;
      const flagsUsed = this.game.gridMines - this.game.minesLeft;
      document.getElementById('stat-flags').textContent = `${flagsUsed}/${this.game.gridMines}`;

      const totalSafe = Math.max(1, this.game.gridWidth * this.game.gridHeight - this.game.gridMines);
      const pctRemaining = this.game.firstPress
        ? 100
        : Math.ceil((100 * this.game.leftToClear) / totalSafe);
      document.getElementById('stat-cleared').textContent = `${pctRemaining}%`;
      document.getElementById('stat-time').textContent = formatTime(this.game.gameplayTime, true);

      const key = getUnorderedGridKey(
        this.game.gridWidth,
        this.game.gridHeight,
        this.game.gridMines
      );
      const best = this.highScores[key];
      document.getElementById('stat-best').textContent =
        best !== undefined ? formatTime(best, true) : '--:--';
    }

    document.getElementById('menu-settings').classList.remove('hidden');
  }

  closeSettings() {
    document.getElementById('menu-settings').classList.add('hidden');
    if (this.game.enabled && !this.game.won && !this.game.lost) {
      this.game.locked = false;
    }
  }

  updateHUD(minesLeft, time, bounce = false) {
    const minesContainer = document.getElementById('hud-mines');
    const minesCountEl = document.getElementById('hud-mines-count');
    minesCountEl.textContent = String(minesLeft);

    const mode = this.game.settings.showMines;
    const shouldShow = mode === 'always' || (mode === 'five' && minesLeft <= 5);
    minesContainer.classList.toggle('hidden', !shouldShow);

    if (bounce && shouldShow) {
      minesContainer.classList.remove('bounce');
      void minesContainer.offsetWidth;
      minesContainer.classList.add('bounce');
      clearTimeout(this.bounceTimeout);
      this.bounceTimeout = setTimeout(() => {
        minesContainer.classList.remove('bounce');
      }, 160);
    }

    this.updateTimerDisplay(time);
  }

  updateTimerDisplay(time) {
    if (!this.game.settings.showTimer) return;
    const el = document.getElementById('hud-timer');
    const str = formatTime(time, false);
    if (el.textContent !== str) {
      el.textContent = str;
    }
  }

  showGameEndCard(won, time) {
    const card = document.getElementById('game-end-card');
    const title = document.getElementById('end-title');
    const subtitle = document.getElementById('end-subtitle');
    const recordBadge = document.getElementById('end-record-badge');
    const btnAgain = document.getElementById('btn-end-again');

    // Reset card position to center
    card.style.left = '50%';
    card.style.top = '50%';

    title.textContent = won ? 'You Won' : 'You Lost';
    btnAgain.textContent = won ? 'Again' : 'Retry';
    subtitle.textContent = `Time: ${formatTime(time, true)}`;

    let isNewRecord = false;
    if (won) {
      const key = getUnorderedGridKey(
        this.game.gridWidth,
        this.game.gridHeight,
        this.game.gridMines
      );
      const prevBest = this.highScores[key];
      if (prevBest === undefined || time < prevBest) {
        this.highScores[key] = time;
        this.saveHighScores();
        isNewRecord = true;
      }
    }

    recordBadge.classList.toggle('hidden', !isNewRecord);
    card.classList.remove('hidden');
  }

  /**
   * Makes the end-game card draggable around the screen so the player can inspect the board underneath,
   * matching miniSweeper's draggable oMenuGameEnd card.
   */
  setupDraggableEndCard() {
    const card = document.getElementById('game-end-card');
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    card.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      card.setPointerCapture(e.pointerId);
      const rect = card.getBoundingClientRect();
      origLeft = rect.left + rect.width / 2;
      origTop = rect.top + rect.height / 2;
      startX = e.clientX;
      startY = e.clientY;
    });

    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      card.style.left = `${origLeft + dx}px`;
      card.style.top = `${origTop + dy}px`;
    });

    const endDrag = () => {
      dragging = false;
    };
    card.addEventListener('pointerup', endDrag);
    card.addEventListener('pointercancel', endDrag);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new AppController();
});
