import { settings, Subscriptions } from "../../state/store";
import { setSetting, getSettings } from "../../api/commands";
import { playVoiceFile } from "../../services/reminder";

// 設定画面のページコンポーネントを生成する
export function SettingsPage(_subs: Subscriptions): HTMLElement {
  const container = document.createElement("div");
  container.className = "settings-page";

  const pageHead = document.createElement("div");
  pageHead.className = "page-head";
  pageHead.innerHTML = `<h1>Settings</h1><span class="sub">Mira の設定</span>`;
  container.appendChild(pageHead);

  const s = settings.get();

  // Font section
  const fontSection = createSection("メモ書体");
  fontSection.appendChild(createSelectRow("書体", "font-select", [
    { value: "Yomogi", label: "Yomogi" },
    { value: "Yusei Magic", label: "Yusei Magic" },
    { value: "Kiwi Maru", label: "Kiwi Maru" },
    { value: "Hachi Maru Pop", label: "Hachi Maru Pop" },
  ], s.font_family));
  container.appendChild(fontSection);

  // Reminder section
  const reminderSection = createSection("リマインダー");
  reminderSection.appendChild(createBoolToggleRowKeyed("通知音", "reminder_sound_enabled", s.reminder_sound_enabled));
  reminderSection.appendChild(createBoolToggleRowKeyed("VOICEVOX 読み上げ", "voicevox_enabled", s.voicevox_enabled));

  const VOICE_CHARACTERS = [
    { value: "metan", label: "四国めたん" },
    { value: "zundamon", label: "ずんだもん" },
    { value: "tsumugi", label: "春日部つむぎ" },
    { value: "zunko", label: "東北ずん子" },
    { value: "miko", label: "櫻歌ミコ" },
    { value: "whitecul", label: "WhiteCUL" },
    { value: "voidoll", label: "Voidoll" },
    { value: "kotaro", label: "白上虎太郎" },
    { value: "rito", label: "離途" },
  ];

  const charRow = document.createElement("div");
  charRow.className = "setting-row";
  charRow.innerHTML = `<span class="label">話者</span>`;
  const charWrap = document.createElement("div");
  charWrap.className = "vv-speaker-wrap";
  const charSelect = document.createElement("select");
  charSelect.className = "vv-speaker-select";
  for (const vc of VOICE_CHARACTERS) {
    const opt = document.createElement("option");
    opt.value = vc.value;
    opt.textContent = vc.label;
    if (vc.value === s.voice_character) opt.selected = true;
    charSelect.appendChild(opt);
  }
  const testBtn = document.createElement("button");
  testBtn.className = "toggle-btn vv-test-btn";
  testBtn.textContent = "テスト再生";
  charWrap.appendChild(charSelect);
  charWrap.appendChild(testBtn);
  charRow.appendChild(charWrap);
  reminderSection.appendChild(charRow);

  charSelect.addEventListener("change", async () => {
    try {
      await setSetting("voice_character", charSelect.value);
      await refreshSettings();
    } catch { /* */ }
  });

  testBtn.addEventListener("click", () => {
    playVoiceFile(charSelect.value, 5);
  });

  container.appendChild(reminderSection);

  // Creator + Credits side by side
  const bottomRow = document.createElement("div");
  bottomRow.className = "settings-bottom-row";

  // Creator profile
  const profileSection = createSection("制作者");
  const profileCard = document.createElement("div");
  profileCard.className = "creator-profile";
  profileCard.innerHTML = `
    <div class="creator-top">
      <img class="creator-avatar" src="${new URL('../../assets/avatar.jpg', import.meta.url).href}" alt="ぷらねっと" />
      <div class="creator-name">ぷらねっと</div>
    </div>
    <div class="creator-links">
      <div class="creator-link-row"><span class="link-label">lit.link</span><span class="link-url">- https://lit.link/planet_vrc</span></div>
      <div class="creator-link-row"><span class="link-label">Twitter</span><span class="link-url">- https://x.com/planet_vrc</span></div>
      <div class="creator-link-row"><span class="link-label">お問い合わせ</span><span class="link-url">- https://cosmo-arts-store.booth.pm/</span></div>
    </div>
  `;
  profileSection.appendChild(profileCard);
  bottomRow.appendChild(profileSection);

  // Credits section
  const creditsSection = createSection("使用素材");
  const creditsTable = document.createElement("div");
  creditsTable.className = "credits-table";
  creditsTable.innerHTML = `
    <div class="credits-category">テクスチャ</div>
    <div class="credits-row">
      <span class="credits-label">Wood026 / Cork001</span>
      <span class="credits-author">ambientCG 様</span>
      <span class="credits-url">- https://ambientcg.com/</span>
    </div>
    <div class="credits-category">サウンド</div>
    <div class="credits-row">
      <span class="credits-label">フレーズ032 (通知音)</span>
      <span class="credits-author">くらげ工匠 様</span>
      <span class="credits-url">- http://www.kurage-kosho.info/</span>
    </div>
    <div class="credits-category">音声合成</div>
    <div class="credits-row">
      <span class="credits-label">VOICEVOX</span>
      <span class="credits-author">ヒホ 様</span>
      <span class="credits-url">- https://voicevox.hiroshiba.jp/</span>
    </div>
    <div class="credits-row">
      <span class="credits-label"><span class="credits-label-group">VOICEVOX : <span class="credits-vv-names">四国めたん<br>ずんだもん<br>東北ずん子</span></span></span>
      <span class="credits-author">SSS合同会社 様</span>
      <span class="credits-url">- https://zunko.jp/</span>
    </div>
    <div class="credits-row">
      <span class="credits-label">VOICEVOX : 春日部つむぎ</span>
      <span class="credits-author"></span>
      <span class="credits-url">- https://tsumugi-official.studio.site/</span>
    </div>
    <div class="credits-row">
      <span class="credits-label">VOICEVOX : 櫻歌ミコ</span>
      <span class="credits-author"></span>
      <span class="credits-url">- https://miko35.info/</span>
    </div>
    <div class="credits-row">
      <span class="credits-label">VOICEVOX : WhiteCUL</span>
      <span class="credits-author"></span>
      <span class="credits-url">- https://www.whitecul.com/</span>
    </div>
    <div class="credits-row">
      <span class="credits-label">VOICEVOX : Voidoll</span>
      <span class="credits-author">NHN PlayArt 様</span>
      <span class="credits-url">- https://app.nhn-playart.com/compass/</span>
    </div>
    <div class="credits-row">
      <span class="credits-label">VOICEVOX : 白上虎太郎(CV : ガロ)</span>
      <span class="credits-author">VirVox Project 様</span>
      <span class="credits-url">- https://www.virvoxproject.com/</span>
    </div>
    <div class="credits-row">
      <span class="credits-label">VOICEVOX : 離途</span>
      <span class="credits-author">LitMUS9 様</span>
      <span class="credits-url">- https://litmus9.com/</span>
    </div>
  `;
  creditsSection.appendChild(creditsTable);
  bottomRow.appendChild(creditsSection);

  container.appendChild(bottomRow);

  // Event handlers
  const fontSelect = container.querySelector("#font-select") as HTMLSelectElement;
  fontSelect.addEventListener("change", async () => {
    try {
      await setSetting("font_family", fontSelect.value);
      await refreshSettings();
    } catch { /* */ }
  });

  container.querySelectorAll("[data-toggle-group]").forEach((group) => {
    const buttons = group.querySelectorAll(".toggle-btn");
    buttons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = group.getAttribute("data-toggle-group")!;
        const value = (btn as HTMLElement).dataset.value!;
        buttons.forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        try {
          await setSetting(key, value);
          await refreshSettings();
        } catch { /* */ }
      });
    });
  });

  container.querySelectorAll("[data-bool-toggle]").forEach((group) => {
    const buttons = group.querySelectorAll(".toggle-btn");
    buttons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = group.getAttribute("data-bool-toggle")!;
        const value = (btn as HTMLElement).dataset.value!;
        buttons.forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        try {
          await setSetting(key, value);
          await refreshSettings();
        } catch { /* */ }
      });
    });
  });

  return container;
}

// 見出し付きのセクション要素を生成する
function createSection(title: string): HTMLElement {
  const section = document.createElement("div");
  section.className = "setting-section";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  section.appendChild(h3);
  return section;
}

// セレクトボックス付きの設定行を生成する
function createSelectRow(label: string, id: string, options: { value: string; label: string }[], current: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "setting-row";
  row.innerHTML = `<span class="label">${label}</span>`;
  const select = document.createElement("select");
  select.id = id;
  for (const opt of options) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === current) option.selected = true;
    select.appendChild(option);
  }
  row.appendChild(select);
  return row;
}

// 文字列トグル付きの設定行を生成する
function createToggleRow(label: string, options: { value: string; label: string }[], current: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "setting-row";
  row.innerHTML = `<span class="label">${label}</span>`;
  const toggleRow = document.createElement("div");
  toggleRow.className = "toggle-row";
  toggleRow.dataset.toggleGroup = "font_scope";
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.className = "toggle-btn";
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    if (opt.value === current) btn.classList.add("on");
    toggleRow.appendChild(btn);
  }
  row.appendChild(toggleRow);
  return row;
}

// ON/OFFブール切替付きの設定行を生成する
function createBoolToggleRowKeyed(label: string, key: string, current: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = "setting-row";
  row.innerHTML = `<span class="label">${label}</span>`;
  const toggleRow = document.createElement("div");
  toggleRow.className = "toggle-row";
  toggleRow.dataset.boolToggle = key;
  const onBtn = document.createElement("button");
  onBtn.className = "toggle-btn";
  onBtn.dataset.value = "1";
  onBtn.textContent = "ON";
  if (current) onBtn.classList.add("on");
  const offBtn = document.createElement("button");
  offBtn.className = "toggle-btn";
  offBtn.dataset.value = "0";
  offBtn.textContent = "OFF";
  if (!current) offBtn.classList.add("on");
  toggleRow.appendChild(onBtn);
  toggleRow.appendChild(offBtn);
  row.appendChild(toggleRow);
  return row;
}

// バックエンドから設定を再取得してストアとフォントを更新する
async function refreshSettings(): Promise<void> {
  const s = await getSettings();
  settings.set(s);
  applyMemoFont(s.font_family);
}

// メモ入力エリアのフォントをCSS変数で適用する
function applyMemoFont(family: string): void {
  document.documentElement.style.setProperty("--memo-font", `"${family}", sans-serif`);
}
