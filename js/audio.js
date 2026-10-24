/**
 * Synthesized sound effects and haptic feedback inspired by miniSweeper's pitch-shifting audio.
 * Uses Web Audio API so zero external audio files are required.
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.vibrateEnabled = true;
    this.flagPitch = 0;
    this.flagResetTimer = null;
    this.clearPitch = 0;
    this.lastClearSoundTime = 0;
  }

  initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  vibrate(ms = 22) {
    if (!this.vibrateEnabled) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch (_) {}
    }
  }

  playClear(cascadeCount = 1) {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastClearSoundTime < 32) return; // throttle during massive flood-fill
    this.lastClearSoundTime = now;

    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Pitch rises gently during cascades like miniSweeper's clearPitch
    const baseFreq = 260 + Math.min(cascadeCount * 14, 340) + (Math.random() * 20 - 10);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, t + 0.065);

    const vol = Math.max(0.04, 0.16 - Math.min(cascadeCount * 0.004, 0.1));
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  playFlag(isPlacing = true) {
    if (!this.enabled) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Consecutive flags shift pitch up slightly like miniSweeper's flagPitch
    const pitchMult = 1 + Math.log10(Math.log2(this.flagPitch / 2 + 1) + 1) * 0.35;
    this.flagPitch = Math.min(this.flagPitch + 1, 16);
    clearTimeout(this.flagResetTimer);
    this.flagResetTimer = setTimeout(() => {
      this.flagPitch = 0;
    }, 1200);

    osc.type = 'triangle';
    if (isPlacing) {
      osc.frequency.setValueAtTime(340 * pitchMult, t);
      osc.frequency.exponentialRampToValueAtTime(520 * pitchMult, t + 0.07);
    } else {
      osc.frequency.setValueAtTime(480 * pitchMult, t);
      osc.frequency.exponentialRampToValueAtTime(300 * pitchMult, t + 0.07);
    }

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.085);
  }

  playMinePop(isFirst = false, pitchStep = 0) {
    if (!this.enabled) return;
    const now = performance.now();
    if (!isFirst && now - this.lastClearSoundTime < 45) return;
    this.lastClearSoundTime = now;

    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = isFirst ? 'sawtooth' : 'triangle';
    const startFreq = isFirst ? 150 : 190 + Math.min(pitchStep * 18, 280);
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + (isFirst ? 0.26 : 0.11));

    const vol = isFirst ? 0.24 : 0.1;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (isFirst ? 0.28 : 0.12));

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + (isFirst ? 0.29 : 0.125));
  }

  playWin() {
    if (!this.enabled) return;
    this.initContext();
    if (!this.ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const t = this.ctx.currentTime + idx * 0.075;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.27);
    });
  }
}
