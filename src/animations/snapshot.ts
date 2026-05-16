type Season = "spring" | "summer" | "autumn" | "winter";

interface SnapshotData {
  season: Season;
  greeting: string;
  stats: { label: string; value: string }[];
}

const SEASON_LEAVES: Record<Season, string> = {
  spring:
    '<path d="M 30 8 C 22 14 18 24 22 32 C 26 40 30 50 30 50 C 30 50 34 40 38 32 C 42 24 38 14 30 8 Z" fill="#f4b8c8" stroke="#d28aa6" stroke-width="0.8"/><path d="M 30 18 L 30 46" stroke="#c8758a" stroke-width="0.5" opacity="0.5"/>',
  summer:
    '<path d="M 30 8 C 16 12 10 24 14 36 C 18 44 26 50 30 52 C 34 50 42 44 46 36 C 50 24 44 12 30 8 Z" fill="#9bc97a" stroke="#5e8c3e" stroke-width="0.8"/><path d="M 30 12 L 30 50" stroke="#3e6a26" stroke-width="0.6" opacity="0.6"/>',
  autumn:
    '<path d="M 30 8 L 35 14 L 42 14 L 38 22 L 48 22 L 42 30 L 50 36 L 40 38 L 42 48 L 32 42 L 30 52 L 28 42 L 18 48 L 20 38 L 10 36 L 18 30 L 12 22 L 22 22 L 18 14 L 25 14 Z" fill="#d4753a" stroke="#a0461e" stroke-width="0.8"/>',
  winter:
    '<g transform="translate(30 30)"><path d="M 0 -22 L 0 22 M -22 0 L 22 0 M -16 -16 L 16 16 M -16 16 L 16 -16" stroke="#a8c8e8" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="0" cy="0" r="3" fill="#e0eef8"/></g>',
};

const SEASON_BG: Record<Season, string> = {
  spring:
    "linear-gradient(180deg, rgba(255, 220, 235, 0.18), rgba(255, 230, 240, 0.05)), var(--paper)",
  summer:
    "linear-gradient(180deg, rgba(180, 230, 200, 0.18), rgba(220, 240, 220, 0.05)), var(--paper)",
  autumn:
    "linear-gradient(180deg, rgba(255, 200, 150, 0.20), rgba(255, 220, 180, 0.06)), var(--paper)",
  winter:
    "radial-gradient(ellipse at top, rgba(212, 154, 74, 0.15), transparent 50%), radial-gradient(ellipse at bottom, rgba(139, 107, 155, 0.1), transparent 50%), var(--paper)",
};

// 現在月から季節を分類する（3-5=春, 6-8=夏, 9-11=秋, それ以外=冬）
function getCurrentSeason(): Season {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

// 演出のフェーズ区切り用の Promise sleep
function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 季節サマリーの封筒開封演出を1回再生する。引数省略時は現在月から季節を推定し、
// stats も "—" で初期化する（DebugPage 等のテスト再生にも使える）。
// 既に演出が走っている (stage が DOM に存在) 場合は二重再生しない。
export function playSnapshot(data?: SnapshotData): void {
  // 多重発火防止: 直前に開かれた stage がまだ残っているなら何もしない (連打対策)
  if (document.querySelector(".env-stage")) return;

  const season = data?.season ?? getCurrentSeason();
  const greeting = data?.greeting ?? "この四半期のあなたの記録が、ここに集まりました。";
  const stats = data?.stats ?? [
    { label: "Total Time", value: "—" },
    { label: "Active Days", value: "—" },
    { label: "People Met", value: "—" },
    { label: "Photos", value: "—" },
  ];

  const stage = document.createElement("div");
  stage.className = "env-stage show";
  stage.style.background = SEASON_BG[season];

  // Leaf
  const leaf = document.createElement("div");
  leaf.className = "env-leaf";
  leaf.innerHTML = `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">${SEASON_LEAVES[season]}</svg>`;
  stage.appendChild(leaf);

  // Letter notification
  const notify = document.createElement("div");
  notify.className = "env-letter-notify";
  notify.innerHTML = `
    <div class="env-letter-text">
      <span class="env-letter-text-inner">星のたよりが届きました</span>
    </div>
  `;
  stage.appendChild(notify);

  // Envelope wrap
  const envWrap = document.createElement("div");
  envWrap.className = "envelope-wrap";
  envWrap.innerHTML = `
    <div class="envelope">
      <div class="env-body"></div>
      <div class="folded-letter"></div>
      <div class="env-front"></div>
      <div class="env-fold-lines">
        <svg viewBox="0 0 100 65" preserveAspectRatio="none">
          <line x1="0" y1="33" x2="100" y2="33" stroke="rgba(74,61,46,0.18)" stroke-width="0.3"/>
          <line x1="0" y1="48" x2="100" y2="48" stroke="rgba(74,61,46,0.12)" stroke-width="0.3"/>
        </svg>
      </div>
      <div class="env-flap"></div>
      <div class="env-seal">
        <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
          <circle cx="40" cy="40" r="32" fill="#c8633a" stroke="#8e3528" stroke-width="1.5"/>
          <circle cx="40" cy="40" r="26" fill="none" stroke="#f4ede0" stroke-width="0.6" opacity="0.5"/>
          <path d="M 40 20 L 43.5 35 L 58 35 L 46 44 L 51 60 L 40 50 L 29 60 L 34 44 L 22 35 L 36.5 35 Z" fill="#f4ede0" opacity="0.95"/>
        </svg>
      </div>
    </div>
  `;
  stage.appendChild(envWrap);

  // Unfolded letter
  const letter = document.createElement("div");
  letter.className = "unfolded-letter";
  const statsHtml = stats
    .map(
      (s) =>
        `<div class="stat-row"><div class="label">${s.label}</div><div class="value">${s.value}</div></div>`,
    )
    .join("");
  letter.innerHTML = `
    <div class="letter-body">
      <div class="letter-greeting">こんにちは。<br>${greeting}</div>
      <div class="summary-grid-q">${statsHtml}</div>
      <div class="letter-footer">
        またお便りします。<br>
        <span class="signature">Mira</span>
      </div>
    </div>
  `;
  stage.appendChild(letter);

  // Close hint
  const closeHint = document.createElement("div");
  closeHint.className = "env-close-hint";
  closeHint.textContent = "click anywhere to close";
  stage.appendChild(closeHint);

  document.body.appendChild(stage);
  void runAnimation(stage, leaf, notify, envWrap, letter, closeHint);
}

// フェーズ駆動の演出本体。各フェーズ間の await wait(ms) で CSS class を1つずつ追加し、
// 対応する keyframe アニメーションを連鎖発火させる（タイミングは演出デザイン側のマジック数値）。
async function runAnimation(
  stage: HTMLElement,
  leaf: HTMLElement,
  notify: HTMLElement,
  envWrap: HTMLElement,
  letter: HTMLElement,
  closeHint: HTMLElement,
): Promise<void> {
  // Phase 1: Leaf flies
  await wait(200);
  leaf.classList.add("flying");

  // Phase 2: Letter notification appears
  await wait(800);
  notify.classList.add("show");

  // Phase 3: Notification text writing
  const textEl = notify.querySelector(".env-letter-text")!;
  textEl.classList.add("writing");

  // Phase 4: Notification fades, envelope appears
  await wait(2400);
  notify.classList.remove("show");
  notify.classList.add("fade-out");
  await wait(400);
  envWrap.classList.add("appear");

  // Phase 5: Seal breaks + flap opens
  await wait(1200);
  envWrap.classList.add("seal-broken");
  await wait(600);
  envWrap.classList.add("flap-open");

  // Phase 6: Letter rises from envelope
  await wait(900);
  envWrap.classList.add("letter-rising");

  // Phase 7: Envelope recedes, unfolded letter shows
  await wait(1400);
  envWrap.classList.add("recede");
  await wait(300);
  letter.classList.add("show");

  // Phase 8: Close hint
  await wait(2000);
  closeHint.classList.add("show");

  // Phase 9: Close on click
  let closed = false;
  const escHandler = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", escHandler);
    stage.removeEventListener("click", close);
    stage.style.opacity = "0";
    stage.style.transition = "opacity 0.5s";
    setTimeout(() => stage.remove(), 500);
  };
  stage.addEventListener("click", close);
  document.addEventListener("keydown", escHandler);
}
