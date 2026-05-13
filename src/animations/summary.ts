type Season = "sakura" | "leaf" | "momiji" | "snow";

const SEASON_SVGS: Record<Season, string[]> = {
  sakura: [
    `<svg viewBox="0 0 12 16"><path fill="#f4a7b9" d="M6,0 C3,0 0,4 0,8 C0,12 2.5,16 6,16 C9.5,16 12,12 12,8 C12,4 9,0 6,0Z"/></svg>`,
    `<svg viewBox="0 0 14 16"><path fill="#f8c8d4" d="M7,0 C4,1 1,5 0,9 C-0.5,12 2,16 7,16 C12,16 14.5,12 14,9 C13,5 10,1 7,0Z"/></svg>`,
    `<svg viewBox="0 0 10 14"><path fill="#f2b5c7" d="M5,0 C2,2 0,6 1,10 C1.5,12 3,14 5,14 C7,14 8.5,12 9,10 C10,6 8,2 5,0Z"/></svg>`,
  ],
  leaf: [
    `<svg viewBox="0 0 24 24"><path fill="#6aaa3a" d="M17.75,3.2C14.1,1.1 9.5,1.5 6.2,4.5C2.9,7.5 2,12.4 3.8,16.2L2.3,20.3C2.1,20.8 2.5,21.3 3,21.3L7.8,20.2C11.3,22.1 15.7,21.5 18.6,18.5C21.9,15.1 21.9,9.7 18.7,6.4"/><path fill="none" stroke="#4d8c2a" stroke-width="0.7" d="M8,18 Q12,14 14,8"/></svg>`,
    `<svg viewBox="0 0 16 24"><path fill="#7ab648" d="M8,0 C3,4 0,10 0,16 C0,20 3,24 8,24 C13,24 16,20 16,16 C16,10 13,4 8,0Z"/><line x1="8" y1="4" x2="8" y2="22" stroke="#5a8e30" stroke-width="0.6"/></svg>`,
  ],
  momiji: [
    `<svg viewBox="0 0 24 24"><path fill="#c0392b" d="M12,1 L10,5 L6,3 L8,7 L3,7 L7,10 L4,13 L8,12 L7,16 L10,13 L12,18 L14,13 L17,16 L16,12 L20,13 L17,10 L21,7 L16,7 L18,3 L14,5Z"/><line x1="12" y1="18" x2="12" y2="24" stroke="#8b2500" stroke-width="0.8"/></svg>`,
    `<svg viewBox="0 0 24 24"><path fill="#d35400" d="M12,1 L10.5,4.5 L7,2.5 L8.5,6.5 L4,6 L7.5,9.5 L4.5,12.5 L8.5,11.5 L7.5,15.5 L10.5,12.5 L12,17 L13.5,12.5 L16.5,15.5 L15.5,11.5 L19.5,12.5 L16.5,9.5 L20,6 L15.5,6.5 L17,2.5 L13.5,4.5Z"/><line x1="12" y1="17" x2="12" y2="24" stroke="#a04000" stroke-width="0.8"/></svg>`,
    `<svg viewBox="0 0 24 24"><path fill="#e67e22" d="M12,2 L10,5 L6.5,3.5 L8,7.5 L3.5,7 L7,10 L4,13 L8,12 L7.5,16 L10,13 L12,17.5 L14,13 L16.5,16 L16,12 L20,13 L17,10 L20.5,7 L16,7.5 L17.5,3.5 L14,5Z"/></svg>`,
  ],
  snow: [
    `<svg viewBox="0 0 16 16"><path fill="#b8d8ea" fill-opacity="0.9" d="M8 16a.5.5 0 0 1-.5-.5v-1.293l-.646.647a.5.5 0 0 1-.707-.708L7.5 12.793V8.866l-3.4 1.963-.496 1.85a.5.5 0 1 1-.966-.26l.237-.882-1.12.646a.5.5 0 0 1-.5-.866l1.12-.646-.884-.237a.5.5 0 1 1 .26-.966l1.848.495L7 8 3.6 6.037l-1.85.495a.5.5 0 0 1-.258-.966l.883-.237-1.12-.646a.5.5 0 1 1 .5-.866l1.12.646-.237-.883a.5.5 0 1 1 .966-.258l.495 1.849L7.5 7.134V3.207L6.147 1.854a.5.5 0 1 1 .707-.708l.646.647V.5a.5.5 0 1 1 1 0v1.293l.647-.647a.5.5 0 1 1 .707.708L8.5 3.207v3.927l3.4-1.963.496-1.85a.5.5 0 1 1 .966.26l-.236.882 1.12-.646a.5.5 0 0 1 .5.866l-1.12.646.883.237a.5.5 0 1 1-.26.966l-1.848-.495L9 8l3.4 1.963 1.849-.495a.5.5 0 0 1 .259.966l-.883.237 1.12.646a.5.5 0 0 1-.5.866l-1.12-.646.236.883a.5.5 0 1 1-.966.258l-.495-1.849-3.4-1.963v3.927l1.353 1.353a.5.5 0 0 1-.707.708l-.647-.647V15.5a.5.5 0 0 1-.5.5z"/></svg>`,
    `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="2" fill="#d0e8f2" fill-opacity="0.8"/><g stroke="#c4dce8" stroke-width="1" stroke-linecap="round"><line x1="10" y1="1" x2="10" y2="19"/><line x1="1" y1="10" x2="19" y2="10"/><line x1="3.4" y1="3.4" x2="16.6" y2="16.6"/><line x1="16.6" y1="3.4" x2="3.4" y2="16.6"/></g></svg>`,
  ],
};

function getSeason(month: number): Season {
  if (month >= 3 && month <= 5) return "sakura";
  if (month >= 6 && month <= 8) return "leaf";
  if (month >= 9 && month <= 11) return "momiji";
  return "snow";
}

export function playSummaryAnimation(overrideMonth?: number): void {
  const month = overrideMonth ?? new Date().getMonth() + 1;
  const season = getSeason(month);

  const overlay = document.createElement("div");
  overlay.className = "summary-overlay";

  const canvas = document.createElement("div");
  canvas.className = "summary-canvas";

  const content = document.createElement("div");
  content.className = "summary-content";
  content.innerHTML = `
    <div class="summary-header">
      <div class="summary-logo">Mira</div>
      <div class="summary-period">${seasonLabel(month)} — Quarterly Summary</div>
    </div>
    <div class="summary-stats">
      <div class="summary-stat">
        <div class="summary-stat-num">42</div>
        <div class="summary-stat-label">日間ログイン</div>
      </div>
      <div class="summary-stat">
        <div class="summary-stat-num">128h</div>
        <div class="summary-stat-label">総滞在時間</div>
      </div>
      <div class="summary-stat">
        <div class="summary-stat-num">67</div>
        <div class="summary-stat-label">出会った人</div>
      </div>
    </div>
    <div class="summary-message">素敵な思い出をありがとう</div>
    <button class="summary-close">閉じる</button>
  `;

  overlay.appendChild(canvas);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add("visible"));

  const isSnow = season === "snow";
  const spawnInterval = isSnow ? 300 : 600;
  const initialBurst = isSnow ? 25 : 14;

  for (let i = 0; i < initialBurst; i++) {
    setTimeout(() => {
      if (!overlay.parentNode) return;
      spawnPetal(canvas, season);
    }, i * (isSnow ? 150 : 300) + Math.random() * 150);
  }

  const interval = setInterval(() => {
    if (!overlay.parentNode) { clearInterval(interval); return; }
    spawnPetal(canvas, season);
  }, spawnInterval);

  const closeBtn = content.querySelector(".summary-close")!;
  closeBtn.addEventListener("click", () => {
    clearInterval(interval);
    overlay.classList.remove("visible");
    setTimeout(() => overlay.remove(), 600);
  });
}

function spawnPetal(canvas: HTMLElement, season: Season): void {
  const svgs = SEASON_SVGS[season];
  const svgStr = svgs[Math.floor(Math.random() * svgs.length)];

  const petal = document.createElement("div");
  petal.className = "summary-petal";
  petal.innerHTML = svgStr;

  const isSnow = season === "snow";
  const size = isSnow ? 12 + Math.random() * 14 : 18 + Math.random() * 20;
  const svg = petal.querySelector("svg")!;
  svg.style.width = `${size}px`;
  svg.style.height = `${size}px`;

  if (isSnow) {
    petal.classList.add("snow");
    petal.style.setProperty("--start-x", `${10 + Math.random() * 80}vw`);
    const dur = 5 + Math.random() * 5;
    petal.style.setProperty("--dur", `${dur}s`);
    const drift = -30 + Math.random() * 60;
    petal.style.setProperty("--drift", `${drift}px`);
    const spinDir = Math.random() > 0.5 ? 1 : -1;
    petal.style.setProperty("--spin", `${spinDir * (180 + Math.random() * 360)}deg`);
  } else {
    const startY = 5 + Math.random() * 35;
    petal.style.setProperty("--start-y", `${startY}vh`);
    petal.style.setProperty("--mid-y", `${30 + Math.random() * 25}vh`);
    const loopY = 20 + Math.random() * 35;
    petal.style.setProperty("--loop-y", `${loopY}vh`);
    petal.style.setProperty("--end-y", `${55 + Math.random() * 35}vh`);
    const loopCx = 30 + Math.random() * 30;
    petal.style.setProperty("--loop-cx", `${loopCx}vw`);
    const loopR = 4 + Math.random() * 8;
    petal.style.setProperty("--loop-r", `${loopR}vw`);
    const dur = 6 + Math.random() * 4;
    petal.style.setProperty("--dur", `${dur}s`);
    const spinDir = Math.random() > 0.5 ? 1 : -1;
    const spins = 2 + Math.floor(Math.random() * 3);
    petal.style.setProperty("--spin", `${spinDir * spins * 360}deg`);
    const wobble = 10 + Math.random() * 20;
    petal.style.setProperty("--wobble", `${wobble}px`);
  }

  petal.style.opacity = String(0.5 + Math.random() * 0.5);

  canvas.appendChild(petal);
  petal.addEventListener("animationend", () => petal.remove());
}

function seasonLabel(month: number): string {
  const year = new Date().getFullYear();
  if (month >= 3 && month <= 5) return `${year} 春`;
  if (month >= 6 && month <= 8) return `${year} 夏`;
  if (month >= 9 && month <= 11) return `${year} 秋`;
  return `${year} 冬`;
}
