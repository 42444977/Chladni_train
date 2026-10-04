// main.js — 科普列車展場專用：不鏽鋼 25×25 cm、0.8 mm 板，第2～8模態播放
//
// 模態編號依「雙調和模擬.png」慣例：自由方板可激發本徵模態依 λ 由小到大排序，
// 從 1 開始編號（見專案記憶 mode-numbering-convention）。以下頻率為現場實測校準值，
// 非理論計算值，故直接寫死，不經 physics.js 縮放換算。

import { AudioEngine, VOLUME_DEFAULT, clampVolume, clampFreq } from "./audio.js";

const MODES = [
  { n: 2, freq: 235 },
  { n: 3, freq: 390 },
  { n: 4, freq: 511 },
  { n: 5, freq: 830 },
  { n: 6, freq: 912 },
  { n: 7, freq: 1021 },
  { n: 8, freq: 1355 },
];

// 現場微調：以寫死值為基準，調整後的頻率存在 localStorage，「恢復預設」即回到上表
const STORAGE_KEY = "chladni-freq-overrides";
const ADJUST_STEPS = [-10, -1, 1, 10];

for (const mode of MODES) mode.base = mode.freq;
loadOverrides();

function loadOverrides() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { /* 無法讀取就用預設 */ }
  for (const mode of MODES) {
    const f = Number(saved[mode.n]);
    if (Number.isFinite(f)) mode.freq = clampFreq(Math.round(f));
  }
}

function saveOverrides() {
  const data = {};
  for (const mode of MODES) {
    if (mode.freq !== mode.base) data[mode.n] = mode.freq;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* 忽略 */ }
}

const engine = new AudioEngine();
let activeN = null;

const grid = document.getElementById("mode-grid");
const outFreq = document.getElementById("out-freq");
const nowPlaying = document.getElementById("now-playing");
const btnStop = document.getElementById("btn-stop");
const rngVolume = document.getElementById("rng-volume");
const outVolume = document.getElementById("out-volume");

const btnAdjust = document.getElementById("btn-adjust");
const adjustPanel = document.getElementById("adjust-panel");
const adjustList = document.getElementById("adjust-list");
const btnAdjustReset = document.getElementById("btn-adjust-reset");

const modeButtons = new Map();
const adjustRows = new Map();

for (const mode of MODES) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mode-btn";
  btn.innerHTML = `<span class="mode-n">第 ${mode.n} 模態</span><span class="mode-freq"></span>`;
  btn.addEventListener("click", () => playMode(mode));
  grid.appendChild(btn);
  modeButtons.set(mode.n, btn);

  const row = document.createElement("div");
  row.className = "adjust-row";
  const label = document.createElement("span");
  label.className = "adjust-label";
  label.textContent = `第 ${mode.n} 模態`;
  const value = document.createElement("span");
  value.className = "adjust-value";
  const base = document.createElement("span");
  base.className = "adjust-base";
  row.append(label);
  for (const step of ADJUST_STEPS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "adjust-step";
    b.textContent = step > 0 ? `+${step}` : `−${-step}`;
    b.addEventListener("click", () => adjustMode(mode, step));
    if (step === 1) row.append(value);
    row.append(b);
  }
  row.append(base);
  adjustList.appendChild(row);
  adjustRows.set(mode.n, { value, base });
}

function adjustMode(mode, delta) {
  mode.freq = clampFreq(mode.freq + delta);
  saveOverrides();
  if (activeN === mode.n && engine.isPlaying()) engine.setFrequency(mode.freq);
  updateUI();
}

btnAdjust.addEventListener("click", () => {
  const open = adjustPanel.hidden;
  adjustPanel.hidden = !open;
  btnAdjust.classList.toggle("active", open);
  btnAdjust.setAttribute("aria-expanded", String(open));
});

btnAdjustReset.addEventListener("click", () => {
  for (const mode of MODES) mode.freq = mode.base;
  saveOverrides();
  const active = MODES.find((m) => m.n === activeN);
  if (active && engine.isPlaying()) engine.setFrequency(active.freq);
  updateUI();
});

async function playMode(mode) {
  await engine.play(mode.freq);
  activeN = mode.n;
  updateUI();
}

function stopAll() {
  engine.stop();
  activeN = null;
  updateUI();
}

function updateUI() {
  for (const mode of MODES) {
    const btn = modeButtons.get(mode.n);
    btn.classList.toggle("active", mode.n === activeN);
    btn.classList.toggle("adjusted", mode.freq !== mode.base);
    btn.querySelector(".mode-freq").textContent = `${mode.freq} Hz`;
    const row = adjustRows.get(mode.n);
    row.value.textContent = `${mode.freq} Hz`;
    const d = mode.freq - mode.base;
    row.base.textContent = d === 0 ? "預設" : `${d > 0 ? "+" : "−"}${Math.abs(d)}（預設 ${mode.base}）`;
    row.base.classList.toggle("changed", d !== 0);
  }
  if (activeN != null) {
    const mode = MODES.find((m) => m.n === activeN);
    outFreq.textContent = `${mode.freq} Hz`;
    nowPlaying.classList.add("playing");
  } else {
    outFreq.textContent = "— Hz";
    nowPlaying.classList.remove("playing");
  }
  btnStop.disabled = activeN == null;
}

btnStop.addEventListener("click", stopAll);

rngVolume.value = String(VOLUME_DEFAULT);
outVolume.textContent = `${Math.round(VOLUME_DEFAULT * 100)}%`;
rngVolume.addEventListener("input", () => {
  const v = clampVolume(parseFloat(rngVolume.value));
  engine.setVolume(v);
  outVolume.textContent = `${Math.round(v * 100)}%`;
});

// 空白鍵急停（安全紅線：即使急停也要淡出，不可直接切斷）
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    if (engine.isPlaying()) {
      engine.emergencyStop();
      activeN = null;
      updateUI();
    }
  }
});

// 連續播放 5 分鐘自動淡出停止（保護震盪器過熱）
engine.onAutoStop(() => {
  activeN = null;
  updateUI();
});

updateUI();
