import { settings, stellaConnected, Subscriptions } from "@/state/store";
import {
  setSetting,
  setViewHourRange,
  getSettings,
  unregisterFromStellarecord,
} from "@/api/commands";
import { showToast } from "@/utils/toast";
import { errMessage } from "@/utils/html";
import { confirmDialog } from "@/utils/confirmDialog";
import { playVoiceFile } from "@/services/reminder";
import { MESSAGES } from "@/utils/messages";

// 設定画面。フォント・通知音・VOICEVOX 話者を変更すると DB + ストア双方を即時更新する。
// subs は voicevox_enabled の変化を追従するため store 購読を 1 つだけ登録する。
export function SettingsPage(subs: Subscriptions): HTMLElement {
  const container = document.createElement("div");
  container.className = "settings-page";

  const pageHead = document.createElement("div");
  pageHead.className = "page-head";
  pageHead.innerHTML = `<h1>Settings</h1><span class="sub">Mira の設定</span>`;
  container.appendChild(pageHead);

  const s = settings.get();

  // Font section
  const fontSection = createSection("メモ書体");
  fontSection.appendChild(
    createSelectRow(
      "書体",
      "font-select",
      [
        { value: "Yomogi", label: "Yomogi" },
        { value: "Yusei Magic", label: "Yusei Magic" },
        { value: "Kiwi Maru", label: "Kiwi Maru" },
        { value: "Hachi Maru Pop", label: "Hachi Maru Pop" },
      ],
      s.font_family,
    ),
  );
  // 書体適用範囲 (font_scope)
  fontSection.appendChild(
    createKeyedToggleRow(
      "書体適用範囲",
      "font_scope",
      [
        { value: "content_only", label: "メモのみ" },
        { value: "all", label: "アプリ全体" },
      ],
      s.font_scope || "content_only",
    ),
  );
  container.appendChild(fontSection);

  // Display section
  // detect_activity_range が 24 を超え 30 まで返し得るため UI 上限も 30 に拡張する
  const displaySection = createSection("表示");
  displaySection.appendChild(
    createBoolToggleRowKeyed(
      "ページ遷移アニメーション",
      "transition_enabled",
      s.transition_enabled,
    ),
  );
  displaySection.appendChild(
    createNumberRow("タイムライン開始時 (0-29)", "view-hour-start", s.view_hour_start, 0, 29),
  );
  displaySection.appendChild(
    createNumberRow("タイムライン終了時 (1-30)", "view-hour-end", s.view_hour_end, 1, 30),
  );
  container.appendChild(displaySection);

  // Memo section
  // M16: backend は 1..=100000 を許容するため UI も合わせる
  const memoSection = createSection("メモ");
  memoSection.appendChild(
    createNumberRow("メモ最大文字数", "memo-max-length", s.memo_max_length, 1, 100_000),
  );
  container.appendChild(memoSection);

  // Review section
  const reviewSection = createSection("レビュー");
  reviewSection.appendChild(
    createBoolToggleRowKeyed("スナップショット表示", "snapshot_enabled", s.snapshot_enabled),
  );
  container.appendChild(reviewSection);

  // Reminder section
  const reminderSection = createSection("リマインダー");
  reminderSection.appendChild(
    createBoolToggleRowKeyed("通知音", "reminder_sound_enabled", s.reminder_sound_enabled),
  );
  reminderSection.appendChild(
    createBoolToggleRowKeyed("VOICEVOX 読み上げ", "voicevox_enabled", s.voicevox_enabled),
  );

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

  // H8: voicevox_enabled OFF のとき話者 select とテストボタンを操作不能にする。
  // settings ストア購読でトグル変化に追従する。
  const updateVoiceControlsState = (enabled: boolean): void => {
    charSelect.disabled = !enabled;
    testBtn.disabled = !enabled;
    charRow.classList.toggle("setting-row-disabled", !enabled);
  };
  updateVoiceControlsState(s.voicevox_enabled);
  subs.add(
    settings.subscribe((next, prev) => {
      if (next.voicevox_enabled !== prev.voicevox_enabled) {
        updateVoiceControlsState(next.voicevox_enabled);
      }
    }),
  );

  charSelect.addEventListener("change", async () => {
    const prev = settings.get().voice_character || "metan";
    const next = charSelect.value;
    try {
      await setSetting("voice_character", next);
      await refreshSettings();
    } catch (err) {
      // 保存失敗時は select の表示を元に戻す
      charSelect.value = prev;
      showToast({
        title: MESSAGES.errors.voiceCharSaveFailed,
        body: errMessage(err),
        kind: "error",
      });
    }
  });

  testBtn.addEventListener("click", () => {
    // L3 R3-Perf-Voice: playVoiceFile は wav の動的 import を含むため Promise を返す。
    // テスト再生は fire-and-forget で十分 (失敗時は無音 fallback 内部処理)。
    void playVoiceFile(charSelect.value, 5);
  });

  // 通知デフォルト (Loop 9 R2-M-20): 新規予定追加時のデフォルト通知タイミング。
  // バックエンド `mira_settings.remind_minutes_before_default` を `get_settings` 経由で
  // MiraSettings.remind_minutes_before_default として受け取り、settings ストアに集約済。
  // 旧 `remindMinutesBefore` Store + localStorage キャッシュは Loop 9 で撤去。
  // CalendarPage 側も `settings.get().remind_minutes_before_default` を直接参照する。
  const remindOptions = [5, 10, 15, 20, 30, 60];
  const storedDefault = settings.get().remind_minutes_before_default;
  const remindRow = document.createElement("div");
  remindRow.className = "setting-row";
  remindRow.innerHTML = `<span class="label">予定追加時のデフォルト通知</span>`;
  const remindSelect = document.createElement("select");
  remindSelect.id = "remind-default-select";
  for (const m of remindOptions) {
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = m === 60 ? "1時間前" : `${m}分前`;
    if (m === storedDefault) opt.selected = true;
    remindSelect.appendChild(opt);
  }
  remindRow.appendChild(remindSelect);
  reminderSection.appendChild(remindRow);

  remindSelect.addEventListener("change", async () => {
    const prevVal = settings.get().remind_minutes_before_default;
    const nextVal = Number(remindSelect.value);
    try {
      // DB へ保存 → 成功したら settings ストアを batch 更新して subscriber に通知
      await setSetting("remind_minutes_before_default", String(nextVal));
      settings.batchSet({ remind_minutes_before_default: nextVal });
    } catch (err) {
      // DB 保存失敗時は select 表示を元に戻す (store は触っていないので巻き戻し不要)
      remindSelect.value = String(prevVal);
      showToast({
        title: MESSAGES.errors.remindDefaultSaveFailed,
        body: errMessage(err),
        kind: "error",
      });
    }
  });

  container.appendChild(reminderSection);

  // StellaRecord 連携
  const integrationSection = createSection("StellaRecord 連携");
  const integrationRow = document.createElement("div");
  integrationRow.className = "setting-row";
  integrationRow.innerHTML = `<span class="label">連携状態</span>`;
  const integrationStatus = document.createElement("span");
  integrationStatus.className = "integration-status";
  integrationStatus.textContent = stellaConnected.get()
    ? MESSAGES.ui.integrationConnected
    : MESSAGES.ui.integrationDisconnected;
  const unregisterBtn = document.createElement("button");
  unregisterBtn.className = "toggle-btn";
  unregisterBtn.textContent = MESSAGES.ui.integrationUnregister;
  unregisterBtn.addEventListener("click", async () => {
    const ok = await confirmDialog(MESSAGES.ui.integrationConfirmUnregister);
    if (!ok) return;
    try {
      await unregisterFromStellarecord();
      stellaConnected.set(false);
      integrationStatus.textContent = MESSAGES.ui.integrationDisconnected;
    } catch (err) {
      showToast({
        title: MESSAGES.errors.integrationUnregisterFailed,
        body: errMessage(err),
        kind: "error",
      });
    }
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
      <img class="creator-avatar" src="${new URL("../../assets/avatar.jpg", import.meta.url).href}" alt="作成者 ぷらねっと のプロフィール画像" />
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
  const fontSelect = container.querySelector<HTMLSelectElement>("#font-select")!;
  fontSelect.addEventListener("change", async () => {
    const prev = settings.get().font_family || "Yomogi";
    try {
      await setSetting("font_family", fontSelect.value);
      await refreshSettings();
    } catch (err) {
      fontSelect.value = prev;
      showToast({
        title: MESSAGES.errors.fontSaveFailed,
        body: errMessage(err),
        kind: "error",
      });
    }
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
          showToast({
            title: MESSAGES.errors.viewHourRangeInvalidTitle,
            body: MESSAGES.errors.viewHourRangeInvalidBody,
            kind: "error",
          });
          return;
        }
        input.value = String(v);
        try {
          await setViewHourRange(start, end);
          await refreshSettings();
        } catch (err) {
          // H2: 失敗時 toast 表示 + 直前値に戻す
          const cur2 = settings.get();
          if (key === "view_hour_start") input.value = String(cur2.view_hour_start);
          else input.value = String(cur2.view_hour_end);
          showToast({
            title: MESSAGES.errors.viewHourSaveFailed,
            body: errMessage(err),
            kind: "error",
          });
        }
        return;
      }

      input.value = String(v);
      try {
        await setSetting(key, String(v));
        await refreshSettings();
      } catch (err) {
        // H2: バックエンドが拒否した場合は toast 通知 + 直前値に戻す
        const cur = settings.get();
        if (key === "memo_max_length") input.value = String(cur.memo_max_length);
        showToast({
          title: MESSAGES.errors.settingSaveFailed,
          body: errMessage(err),
          kind: "error",
        });
      }
    });
  });

  // トグル系設定: 楽観的に UI を更新 → 保存失敗時に元の選択へロールバック + toast 通知
  const wireToggleGroup = (selector: string, attrName: string) => {
    container.querySelectorAll(selector).forEach((group) => {
      const buttons = Array.from(group.querySelectorAll<HTMLElement>(".toggle-btn"));
      buttons.forEach((btn) => {
        btn.addEventListener("click", async () => {
          const key = group.getAttribute(attrName)!;
          const value = btn.dataset.value!;
          // 直前の選択 (.on) を覚えておき、失敗時に戻す
          const prevOn = buttons.find((b) => b.classList.contains("on"));
          if (prevOn === btn) return; // 同値クリックは何もしない
          buttons.forEach((b) => b.classList.remove("on"));
          btn.classList.add("on");
          try {
            await setSetting(key, value);
            await refreshSettings();
          } catch (err) {
            // ロールバック: 元の .on を復元
            buttons.forEach((b) => b.classList.remove("on"));
            if (prevOn) prevOn.classList.add("on");
            showToast({
              title: MESSAGES.errors.settingSaveFailed,
              body: errMessage(err),
              kind: "error",
            });
          }
        });
      });
    });
  };

  wireToggleGroup("[data-toggle-group]", "data-toggle-group");
  wireToggleGroup("[data-bool-toggle]", "data-bool-toggle");

  return container;
}

// 設定セクションの外枠 (h2 タイトル付き) を作って返す。
// a11y (見出し階層): ページ全体の h1 直下に他の h2 が無いため、セクション見出しは h2 に揃える。
// 旧実装は h3 だったが、h1 → h3 のスキップは支援技術のアウトライン解析で警告対象になる。
function createSection(title: string): HTMLElement {
  const section = document.createElement("div");
  section.className = "setting-section";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  section.appendChild(h2);
  return section;
}

// ラベル + <select> の 1 行を組み立てる。current と一致するオプションを selected にする
function createSelectRow(
  label: string,
  id: string,
  options: { value: string; label: string }[],
  current: string,
): HTMLElement {
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
function createKeyedToggleRow(
  label: string,
  key: string,
  options: { value: string; label: string }[],
  current: string,
): HTMLElement {
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
function createNumberRow(
  label: string,
  id: string,
  current: number,
  min: number,
  max: number,
): HTMLElement {
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
  applyMemoFontLink(s.font_family);
  applyFontScope(s.font_scope || "content_only");
  applyTransitionEnabled(s.transition_enabled);
}

// :root の --memo-font CSS 変数を更新する。メモ・めもきっとなど CSS 側で var(--memo-font) を参照
function applyMemoFont(family: string): void {
  document.documentElement.style.setProperty("--memo-font", `"${family}", sans-serif`);
}

// L3 R3-Perf-Font: 選択中のメモ書体だけを Google Fonts から取得するよう
// link[data-mira-memo-font] の href を差し替える。
// - UI 系書体 (Allura / Cormorant / Noto Sans JP / Kiwi Maru / Hachi Maru Pop) は
//   index.html 側の別 link で常時ロード済のため、ここでは差し替え不要。
// - 既に同じ family が入っている場合は no-op (キャッシュヒットだが冪等性のため)。
function applyMemoFontLink(family: string): void {
  const link = document.querySelector<HTMLLinkElement>("link[data-mira-memo-font]");
  if (!link) return;
  // family は Google Fonts URL のクエリパラメータ向けに "+" 区切りへ変換
  const familyParam = family.replaceAll(" ", "+");
  const nextHref = `https://fonts.googleapis.com/css2?family=${familyParam}&display=swap`;
  if (link.href === nextHref) return;
  link.href = nextHref;
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

// 確認モーダル (R2-M-5 / Loop 4 UX-01/02 / Loop 6 task1) は utils/confirmDialog.ts に
// 集約済み。a11y (focusTrap + inertBackground) も統合された共通実装を使う。
