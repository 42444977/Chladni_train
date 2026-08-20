// main.js — 科普列車展場專用：不鏽鋼 25×25 cm、0.8 mm 板，第2～8模態播放
//
// 模態編號依「雙調和模擬.png」慣例：自由方板可激發本徵模態依 λ 由小到大排序，
// 從 1 開始編號（見專案記憶 mode-numbering-convention）。以下頻率為現場實測校準值，
// 非理論計算值，故直接寫死，不經 physics.js 縮放換算。

import { AudioEngine, VOLUME_DEFAULT, clampVolume } from "./audio.js";

const MODES = [
  { n: 2, freq: 235 },
  { n: 3, freq: 390 },
  { n: 4, freq: 511 },
  { n: 5, freq: 830 },
  { n: 6, freq: 912 },
  { n: 7, freq: 1021 },
  { n: 8, freq: 1355 },
];

const engine = new AudioEngine();
let activeN = null;

const grid = document.getElementById("mode-grid");
const outFreq = document.getElementById("out-freq");
const nowPlaying = document.getElementById("now-playing");
const btnStop = document.getElementById("btn-stop");
const rngVolume = document.getElementById("rng-volume");
const outVolume = document.getElementById("out-volume");

const modeButtons = new Map();

for (const mode of MODES) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mode-btn";
  btn.innerHTML = `<span class="mode-n">第 ${mode.n} 模態</span><span class="mode-freq">${mode.freq} Hz</span>`;
  btn.addEventListener("click", () => playMode(mode));
  grid.appendChild(btn);
  modeButtons.set(mode.n, btn);
}

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
  for (const [n, btn] of modeButtons) {
    btn.classList.toggle("active", n === activeN);
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
