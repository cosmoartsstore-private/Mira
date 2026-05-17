// 日本の祝日カレンダー描画用。
// 外部ライブラリを使わずに固定祝日 + ハッピーマンデー + 春分/秋分 + 振替/国民の休日 を計算する。

// 1日分の祝日情報（日付と名称）
export interface Holiday {
  day: number;
  name: string;
}

// 固定祝日マップを年に応じて返す
//
// R2-M-20: 天皇誕生日 (2019 改正で 12/23 -> 2/23) や即位日など年依存の祝日に対応。
// 簡略化のため細かい祝日 (即位礼正殿の儀 2019/10/22 など単年限定) は省略している。
function getFixedHolidays(year: number): Record<string, string> {
  const map: Record<string, string> = {
    "1-1": "元日",
    "2-11": "建国記念の日",
    "4-29": "昭和の日",
    "5-3": "憲法記念日",
    "5-4": "みどりの日",
    "5-5": "こどもの日",
    "11-3": "文化の日",
    "11-23": "勤労感謝の日",
  };

  // 山の日: 2016 年に新設
  if (year >= 2016) {
    map["8-11"] = "山の日";
  }

  // 天皇誕生日:
  // - 1989-2018: 12/23 (平成)
  // - 2019: なし (改元年)
  // - 2020-: 2/23 (令和)
  if (year >= 1989 && year <= 2018) {
    map["12-23"] = "天皇誕生日";
  } else if (year >= 2020) {
    map["2-23"] = "天皇誕生日";
  }

  return map;
}

// L4 D-I18N-5: 将来の locale 拡張に備えた汎用エントリポイント。
//
// 現状は ja-JP のみ実装し、それ以外の locale は空配列を返す (例外で起動を止めない設計)。
// 内部実装は従来の getJapaneseHolidays をそのまま呼ぶ。
// 将来 en-US (米国祝日) を追加する場合は、ここに locale 分岐を足し、
// 専用関数 (例: getUsHolidays) を別ファイルで実装する想定。
//
// API メモ:
//   - locale 引数は BCP 47 ロケール文字列 (例: "ja-JP", "en-US")。
//   - 未対応 locale は空配列 (= 祝日無し扱い) で fail-safe する。throw しないのは、
//     CalendarPage がカレンダー描画を継続できるようにするため。
//   - 拡張時はこの関数経由で getJapaneseHolidays を内部呼出する形を維持し、
//     呼出側 (CalendarPage 等) は getHolidays(year, month, locale) へ移行する。
export type SupportedHolidayLocale = "ja-JP";

export function getHolidays(
  year: number,
  month: number,
  // `string` ではなく BCP-47 リテラル | string の合成型は eslint
  // (no-redundant-type-constituents) で潰されるため、外部からは生 string を受け、
  // 内部で SupportedHolidayLocale 判定に絞り込む。
  // 型注釈を省くのは no-inferrable-types ルール準拠 (= デフォルト値から推論される)。
  locale = "ja-JP",
): Holiday[] {
  if (locale === "ja-JP") {
    return getJapaneseHolidays(year, month);
  }
  // 未対応 locale は空配列で返す (CalendarPage を blocking しない)
  return [];
}

export function getJapaneseHolidays(year: number, month: number): Holiday[] {
  const holidays: Holiday[] = [];

  const fixed = getFixedHolidays(year);

  const key = `${month}-`;
  for (const [k, name] of Object.entries(fixed)) {
    if (k.startsWith(key)) {
      const day = parseInt(k.split("-")[1]);
      holidays.push({ day, name });
    }
  }

  // ハッピーマンデー: 各月の第 n 月曜日が祝日になる制度（成人の日=1月第2月、海の日=7月第3月 ...）
  if (month === 1) holidays.push({ day: nthMonday(year, 1, 2), name: "成人の日" });
  if (month === 7) holidays.push({ day: nthMonday(year, 7, 3), name: "海の日" });
  if (month === 9) holidays.push({ day: nthMonday(year, 9, 3), name: "敬老の日" });
  if (month === 10) holidays.push({ day: nthMonday(year, 10, 2), name: "スポーツの日" });

  // Equinox days (approximate, year-range aware)
  if (month === 3) holidays.push({ day: vernalEquinox(year), name: "春分の日" });
  if (month === 9) holidays.push({ day: autumnalEquinox(year), name: "秋分の日" });

  // 振替休日: 祝日が日曜日と重なった場合、直後の平日（=次の月曜）を休日にする。
  // holidayDays は振替を計算する前のスナップショットで、複数連続祝日にも対応するため while で送る。
  const holidayDays = new Set(holidays.map((h) => h.day));
  const substitutes: Holiday[] = [];
  for (const h of holidays) {
    const dow = new Date(year, month - 1, h.day).getDay();
    if (dow === 0) {
      let sub = h.day + 1;
      while (holidayDays.has(sub)) sub++;
      substitutes.push({ day: sub, name: "振替休日" });
    }
  }
  holidays.push(...substitutes);

  // Sandwich rule: a weekday between two holidays becomes 国民の休日
  //
  // R2-M-21: 当該月内で完結する判定のみ実装。月末/月初の境界跨ぎ
  // (例: 30日と翌月1日が祝日のときの月末の平日) は計算対象外で、
  // 厳密対応には呼び出し側で前後月の祝日を渡す API 化が必要。
  const allDays = new Set(holidays.map((h) => h.day));
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 2; d < daysInMonth; d++) {
    if (!allDays.has(d) && allDays.has(d - 1) && allDays.has(d + 1)) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow !== 0 && dow !== 6) {
        holidays.push({ day: d, name: "国民の休日" });
      }
    }
  }

  holidays.sort((a, b) => a.day - b.day);
  return holidays;
}

// 指定月の第 n 月曜日の日付を返す。
// 1日の曜日 dow (0=日,1=月) から逆算: dow<=1 なら 1+(1-dow)、それ以外は 1+(8-dow) が初月曜。
// 例: dow=0(日) → 2日が初月曜、dow=2(火) → 7日が初月曜、dow=6(土) → 3日が初月曜。
function nthMonday(year: number, month: number, n: number): number {
  const first = new Date(year, month - 1, 1);
  const dow = first.getDay();
  const firstMonday = dow <= 1 ? 1 + (1 - dow) : 1 + (8 - dow);
  return firstMonday + (n - 1) * 7;
}

// 春分の日 (国立天文台の近似式を年範囲で切替)
//
// R2-M-19: 1980-2099 の係数のみだと 2100+ で 1 日ずれることがあるため、
// 海上保安庁/国立天文台の係数を年範囲ごとに切替えて精度を補正する。
function vernalEquinox(year: number): number {
  if (year >= 1900 && year <= 1979) {
    return Math.floor(20.8357 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  if (year >= 1980 && year <= 2099) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  if (year >= 2100 && year <= 2199) {
    return Math.floor(21.851 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  // 範囲外は安全側で 1980-2099 の式
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

// 秋分の日 (同上, 年範囲対応)
function autumnalEquinox(year: number): number {
  if (year >= 1900 && year <= 1979) {
    return Math.floor(23.2588 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  if (year >= 1980 && year <= 2099) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  if (year >= 2100 && year <= 2199) {
    return Math.floor(24.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
