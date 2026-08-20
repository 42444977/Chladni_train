// audio.js — Web Audio 封裝
//
// 訊號鏈：OscillatorNode(sine) -> GainNode(envelope) -> GainNode(master)
//        -> ChannelMergerNode(強制雙聲道同相) -> AnalyserNode -> destination
//
// 安全紅線（不可違反）：
//   - 只用 sine，不提供方波/鋸齒波
//   - 起播/停止一律漸強漸弱，指數包絡絕不 ramp 到 0（改 ramp 到 0.0001 再 stop()）
//   - 音量預設 0.30，master gain 硬上限 0.85
//   - 空白鍵急停仍要淡出，不可直接切斷造成爆音

export const FREQ_MIN = 20;
export const FREQ_MAX = 8000;
export const FREQ_WARN = 4000;
export const VOLUME_DEFAULT = 0.30;
export const VOLUME_MAX = 0.85;
export const ATTACK_SEC = 0.25;
export const RELEASE_SEC = 0.40;
export const EMERGENCY_RELEASE_SEC = 0.08;
export const FREQ_GLIDE_SEC = 0.08;
export const AUTO_STOP_DEFAULT_SEC = 300;
export const AUTO_STOP_MIN_SEC = 60;
export const AUTO_STOP_MAX_SEC = 600;
const ENV_FLOOR = 0.0001; // 指數包絡不可以 ramp 到 0，改 ramp 到此值再 stop()

export function clampFreq(f) {
  return Math.min(FREQ_MAX, Math.max(FREQ_MIN, f));
}

export function clampVolume(v) {
  return Math.min(VOLUME_MAX, Math.max(0, v));
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.osc = null;
    this.envGain = null;
    this.masterGain = null;
    this.merger = null;
    this.analyser = null;

    this.playing = false;
    this.smooth = true;
    this.volume = VOLUME_DEFAULT;

    this.autoStopSeconds = AUTO_STOP_DEFAULT_SEC;
    this._autoStopTimer = null;
    this._autoStopArmedAt = null;
    this._onAutoStop = null;

    this.sweepState = null; // {f0, f1, t0, dur}
    this.wakeLock = null;

    this._visibilityHandler = () => {
      if (this.ctx && document.visibilityState === "visible" && this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", this._visibilityHandler);
  }

  /** 建立 AudioContext 與節點圖（需在使用者手勢中呼叫）。 */
  async init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = clampVolume(this.volume);

    this.merger = this.ctx.createChannelMerger(2);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    // 強制單聲道送雙聲道同相：同一個 gain 輸出接到 L 與 R 兩個輸入
    this.masterGain.connect(this.merger, 0, 0);
    this.masterGain.connect(this.merger, 0, 1);
    this.merger.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  /** 供「啟動音訊」按鈕呼叫：建立/恢復 AudioContext，並嘗試取得 Wake Lock。 */
  async unlock() {
    await this.init();
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch { /* 忽略 */ }
    }
    await this.requestWakeLock();
    return this.ctx.state === "running";
  }

  isPlaying() {
    return this.playing;
  }

  setSmooth(smooth) {
    this.smooth = smooth;
  }

  setVolume(v) {
    this.volume = clampVolume(v);
    if (this.masterGain && this.ctx) {
      const t = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(t);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
      this.masterGain.gain.linearRampToValueAtTime(this.volume, t + 0.02);
    }
  }

  getVolume() {
    return this.volume;
  }

  setAutoStopSeconds(s) {
    this.autoStopSeconds = Math.min(AUTO_STOP_MAX_SEC, Math.max(AUTO_STOP_MIN_SEC, s));
  }

  /** 開始播放（或若已在播放中，平滑滑到新頻率，不重啟包絡）。 */
  async play(freqHz) {
    await this.init();
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch { /* 忽略，等使用者手勢再試 */ }
    }
    await this.requestWakeLock();

    const f = clampFreq(freqHz);
    const t = this.ctx.currentTime;

    if (this.playing && this.osc) {
      this.setFrequency(f);
      return;
    }

    this.osc = this.ctx.createOscillator();
    this.osc.type = "sine";
    this.osc.frequency.setValueAtTime(f, t);

    this.envGain = this.ctx.createGain();
    this.envGain.gain.setValueAtTime(ENV_FLOOR, t);
    this.envGain.gain.exponentialRampToValueAtTime(1.0, t + ATTACK_SEC);

    this.osc.connect(this.envGain);
    this.envGain.connect(this.masterGain);
    this.osc.start(t);

    this.playing = true;
    this.sweepState = null;
    this._armAutoStopTimer();
  }

  /** 平滑（或瞬跳，依 this.smooth）換頻，播放中呼叫，不 stop/start。 */
  setFrequency(freqHz) {
    if (!this.osc || !this.ctx) return;
    const f = clampFreq(freqHz);
    const t = this.ctx.currentTime;
    this.osc.frequency.cancelScheduledValues(t);
    if (this.smooth) {
      this.osc.frequency.setValueAtTime(this.osc.frequency.value, t);
      this.osc.frequency.exponentialRampToValueAtTime(f, t + FREQ_GLIDE_SEC);
    } else {
      this.osc.frequency.setValueAtTime(f, t);
    }
    this.sweepState = null;
  }

  _releaseEnvelope(releaseSec) {
    const t = this.ctx.currentTime;
    const g = this.envGain.gain;
    if (typeof g.cancelAndHoldAtTime === "function") {
      g.cancelAndHoldAtTime(t);
    } else {
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(g.value, ENV_FLOOR), t);
    }
    g.exponentialRampToValueAtTime(ENV_FLOOR, t + releaseSec);
    const oscToStop = this.osc;
    oscToStop.stop(t + releaseSec + 0.02);
    oscToStop.onended = () => { try { oscToStop.disconnect(); } catch { /* 已斷開 */ } };
  }

  /** 正常停止：漸弱 400ms 後停止。 */
  stop() {
    if (!this.playing || !this.osc || !this.ctx) return;
    this._releaseEnvelope(RELEASE_SEC);
    this.playing = false;
    this.osc = null;
    this.envGain = null;
    this.sweepState = null;
    this._clearAutoStopTimer();
  }

  /** 急停（空白鍵）：仍漸弱，但只用 80ms，避免爆音又能快速停止。 */
  emergencyStop() {
    if (!this.playing || !this.osc || !this.ctx) return;
    this._releaseEnvelope(EMERGENCY_RELEASE_SEC);
    this.playing = false;
    this.osc = null;
    this.envGain = null;
    this.sweepState = null;
    this._clearAutoStopTimer();
  }

  // ---------------- 掃頻模式 ----------------

  /** 開始掃頻：以指數曲線從 f0 滑到 f1，歷時 durationSec 秒。 */
  async startSweep(f0, f1, durationSec) {
    await this.play(f0);
    const t = this.ctx.currentTime;
    const start = clampFreq(f0);
    const end = clampFreq(f1);
    this.osc.frequency.cancelScheduledValues(t);
    this.osc.frequency.setValueAtTime(start, t);
    this.osc.frequency.exponentialRampToValueAtTime(end, t + durationSec);
    this.sweepState = { f0: start, f1: end, t0: t, dur: durationSec };
  }

  isSweeping() {
    return !!this.sweepState;
  }

  /** 讀取目前掃頻頻率（供 UI 即時顯示與「標記」使用）；非掃頻中回傳 null。 */
  currentSweepFrequency() {
    if (!this.sweepState || !this.ctx) return null;
    const { f0, f1, t0, dur } = this.sweepState;
    const t = this.ctx.currentTime;
    if (t >= t0 + dur) {
      this.sweepState = null;
      return f1;
    }
    const frac = Math.max(0, (t - t0) / dur);
    return f0 * Math.pow(f1 / f0, frac);
  }

  // ---------------- 位準表 ----------------

  /** 回傳 {rms, peak}，範圍約 0~1；peak 接近 1 時應顯示削波警示。 */
  getLevel() {
    if (!this.analyser) return { rms: 0, peak: 0 };
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      sumSq += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    return { rms: Math.sqrt(sumSq / buf.length), peak };
  }

  // ---------------- 自動停止計時器 ----------------

  _armAutoStopTimer() {
    this._clearAutoStopTimer();
    this._autoStopArmedAt = this.ctx.currentTime;
    this._autoStopTimer = setTimeout(() => {
      this.stop();
      if (this._onAutoStop) this._onAutoStop();
    }, this.autoStopSeconds * 1000);
  }

  _clearAutoStopTimer() {
    if (this._autoStopTimer) {
      clearTimeout(this._autoStopTimer);
      this._autoStopTimer = null;
    }
    this._autoStopArmedAt = null;
  }

  getAutoStopRemainingSec() {
    if (!this._autoStopArmedAt || !this.ctx) return null;
    const elapsed = this.ctx.currentTime - this._autoStopArmedAt;
    return Math.max(0, this.autoStopSeconds - elapsed);
  }

  onAutoStop(cb) {
    this._onAutoStop = cb;
  }

  // ---------------- Wake Lock ----------------

  async requestWakeLock() {
    if (this.wakeLock) return;
    try {
      if ("wakeLock" in navigator) {
        this.wakeLock = await navigator.wakeLock.request("screen");
        this.wakeLock.addEventListener("release", () => { this.wakeLock = null; });
      }
    } catch {
      this.wakeLock = null; // 靜默降級，不影響播放功能
    }
  }

  async releaseWakeLock() {
    try {
      if (this.wakeLock) await this.wakeLock.release();
    } catch { /* 忽略 */ }
    this.wakeLock = null;
  }
}
