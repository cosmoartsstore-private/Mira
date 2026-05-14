import { settings, stellaConnected, Subscriptions } from "../../state/store";
import { setSetting, setViewHourRange, getSettings, unregisterFromStellarecord } from "../../api/commands";
import { playVoiceFile } from "../../services/reminder";

// 設定画面。フォント・通知音・VOICEVOX 話者を変更すると DB + ストア双方を即時更新する。
// _subs は他ページとシグネチャを揃えるための引数だが、この画面は外部ストア購読を持たないため未使用。
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
  // 書体適用範囲 (font_scope)
  fontSection.appendChild(createKeyedToggleRow("書体適用範囲", "font_scope", [
    { value: "content_only", label: "メモのみ" },
    { value: "all", label: "アプリ全体" },
  ], s.font_scope || "content_only"));
  container.appendChild(fontSection);

  // Display section
  // detect_activity_range が 24 を超え 30 まで返し得るため UI 上限も 30 に拡張する
  const displaySection = createSection("表示");
  displaySection.appendChild(createBoolToggleRowKeyed("ページ遷移アニメーション", "transition_enabled", s.transition_enabled));
  displaySection.appendChild(createNumberRow("タイムライン開始時 (0-29)", "view-hour-start", s.view_hour_start, 0, 29));
  displaySection.appendChild(createNumberRow("タイムライン終了時 (1-30)", "view-hour-end", s.view_hour_end, 1, 30));
  container.appendChild(displaySection);

  // Memo section
  const memoSection = createSection("メモ");
  memoSection.appendChild(createNumberRow("メモ最大文字数", "memo-max-length", s.memo_max_length, 100, 10000));
  container.appendChild(memoSection);

  // Review section
  const reviewSection = createSection("レビュー");
  reviewSection.appendChild(createBoolToggleRowKeyed("スナップショット表示", "snapshot_enabled", s.snapshot_enabled));
  container.appendChild(reviewSection);

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

  // STELLARecord 連携
  const integrationSection = createSection("STELLARecord 連携");
  const integrationRow = document.createElement("div");
  integrationRow.className = "setting-row";
  integrationRow.innerHTML = `<span class="label">連携状態</span>`;
  const integrationStatus = document.createElement("span");
  integrationStatus.className = "integration-status";
  integrationStatus.textContent = stellaConnected.get() ? "接続済み" : "未接続";
  const unregisterBtn = document.createElement("button");
  unregisterBtn.className = "toggle-btn";
  unregisterBtn.textContent = "連携を解除";
  unregisterBtn.addEventListener("click", async () => {
    const ok = await confirmDialog("STELLARecord との連携を解除しますか？");
    if (!ok) return;
    try {
      await unregisterFromStellarecord();
      stellaConnected.set(false);
      integrationStatus.textContent = "未接続";
    } catch { /* */ }
  });
  const integrationWrap = document.createElement("div");
  integrationWrap.className = "integration-wrap";
  integrationWrap.appendChild(integrationStatus);
  integrationWrap.appendChild(unregisterBtn);
  integrationRow.appendChild(integrationWrap);
  integrationSection.appendChild(integrationRow);
  container.appendChild(integrationSection);

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
      <span class="credits-author">くらげ工匿 様</span>
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

  // number input rows
  container.querySelectorAll<HTMLInputElement>("[data-num-key]").forEach((input) => {
    input.addEventListener("change", async () => {
      const key = input.dataset.numKey!;
      let v = Number(input.value);
      const min = Number(input.min || "0");
      const max = Number(input.max || "99999");
      if (isNaN(v)) return;
      if (v < min) v = min;
      if (v > max) v = max;

      // view_hour_start / view_hour_end は原子コマンドで両値を一度に更新する
      // (set_setting を 1 つずつ呼ぶと中間状態で start>=end になり拒否されるため)
      if (key === "view_hour_start" || key === "view_hour_end") {
        const cur = settings.get();
        const start = key === "view_hour_start" ? v : cur.view_hour_start;
        const end = key === "view_hour_end" ? v : cur.view_hour_end;
        if (start >= end) {
          input.value = String(key === "view_hour_start" ? cur.view_hour_start : cur.view_hour_end);
          return;
        }
        input.value = String(v);
        try {
          await setViewHourRange(start, end);
          await refreshSettings();
        } catch {
          const cur2 = settings.get();
          if (key === "view_hour_start") input.value = String(cur2.view_hour_start);
          else input.value = String(cur2.view_hour_end);
        }
        return;
      }

      input.value = String(v);
      try {
        await setSetting(key, String(v));
        await refreshSettings();
      } catch {
        // バックエンドが拒否した場合も直前値に戻す
        const cur = settings.get();
        if (key === "memo_max_length") input.value = String(cur.memo_max_length);
      }
    });
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

// 設定セクションの外枠 (h3 タイトル付き) を作って返す
function createSection(title: string): HTMLElement {
  const section = document.createElement("div");
  section.className = "setting-section";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  section.appendChild(h3);
  return section;
}

// ラベル + <select> の 1 行を組み立てる。current と一致するオプションを selected にする
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

// 任意キーでの文字列トグル付きの設定行を生成する
function createKeyedToggleRow(label: string, key: string, options: { value: string; label: string }[], current: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "setting-row";
  row.innerHTML = `<span class="label">${label}</span>`;
  const toggleRow = document.createElement("div");
  toggleRow.className = "toggle-row";
  toggleRow.dataset.toggleGroup = key;
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

// 数値入力付きの設定行を生成する
function createNumberRow(label: string, id: string, current: number, min: number, max: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "setting-row";
  row.innerHTML = `<span class="label">${label}</span>`;
  const input = document.createElement("input");
  input.type = "number";
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.value = String(current);
  // id と setting key はケバブとスネークをやりとりするためマッピング
  const keyMap: Record<string, string> = {
    "memo-max-length": "memo_max_length",
    "view-hour-start": "view_hour_start",
    "view-hour-end": "view_hour_end",
  };
  input.dataset.numKey = keyMap[id] || id;
  row.appendChild(input);
  return row;
}

// バックエンドから設定を再取得してストアとフォントを更新する
async function refreshSettings(): Promise<void> {
  const s = await getSettings();
  settings.set(s);
  applyMemoFont(s.font_family);
  applyFontScope(s.font_scope || "content_only");
  applyTransitionEnabled(s.transition_enabled);
}

// :root の --memo-font CSS 変数を更新する。メモ・めもきっとなど CSS 側で var(--memo-font) を参照
function applyMemoFont(family: string): void {
  document.documentElement.style.setProperty("--memo-font", `"${family}", sans-serif`);
}

// フォント適用範囲 (メモのみ / アプリ全体) をクラスで切替える
function applyFontScope(scope: string): void {
  document.documentElement.classList.toggle("font-scope-all", scope === "all");
  document.documentElement.classList.toggle("font-scope-content", scope === "content_only");
}

// ページ遷移アニメーションのクラスを body に反映する
function applyTransitionEnabled(enabled: boolean): void {
  document.body.classList.toggle("transitions-disabled", !enabled);
}

// WebView 環境差を避けるための HTML 確認モーダル (R2-M-5)
//
// window.confirm はビルド先 WebView2 でブロッキング・無視されるケースがあるため
// 自前モーダルで OK/キャンセルを Promise<boolean> で返す。
function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "mira-confirm-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;";

    const card = document.createElement("div");
    card.className = "mira-confirm-card";
    card.style.cssText = "background:#fff;color:#222;padding:20px 24px;border-radius:8px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.25);font-family:inherit;";

    const msg = document.createElement("div");
    msg.className = "mira-confirm-msg";
    msg.style.cssText = "margin-bottom:16px;line-height:1.5;";
    msg.textContent = message;

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "toggle-btn";
    cancelBtn.textContent = "キャンセル";

    const okBtn = document.createElement("button");
    okBtn.className = "toggle-btn on";
    okBtn.textContent = "OK";

    const cleanup = (ans: boolean) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(ans);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cleanup(false);
      if (e.key === "Enter") cleanup(true);
    };

    cancelBtn.addEventListener("click", () => cleanup(false));
    okBtn.addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(false);
    });
    document.addEventListener("keydown", onKey);

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    card.appendChild(msg);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    okBtn.focus();
  });
}