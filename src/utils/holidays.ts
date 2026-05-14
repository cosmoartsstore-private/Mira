// 日本の祝日カレンダー描画用。
// 外部ライブラリを使わずに固定祝日 + ハッピーマンデー + 春分/秋分 + 振替/国民の休日 を計算する。

// 1日分の祝日情報（日付と名称）
export interface Holiday {
  day: number;
  name: string;
}

// 指定年月の祝日一覧を「日にち昇順」で返す。
// 計算の順序が重要: 固定 → ハッピーマンデー → 春分/秋分 → 振替休日 → 国民の休日。
// 振替/国民の休日は他の祝日の存在を前提にするため後段で計算する。
export function getJapaneseHolidays(year: number, month: number): Holiday[] {
  const holidays: Holiday[] = [];

  // 毎年同じ日付の祝日。山の日(2016~)・建国記念の日 など現在の暦に合わせている。
  const fixed: Record<string, string> = {
    "1-1": "元日",
    "2-11": "建国記念の日",
    "2-23": "天皇誕生日",
    "4-29": "昭和の日",
    "5-3": "憲法記念日",
    "5-4": "みどりの日",
    "5-5": "こどもの日",
    "8-11": "山の日",
    "11-3": "文化の日",
    "11-23": "勤労感謝の日",
  };

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

  // 春分/秋分は天文計算による近似式（1980~2099 でほぼ正確）
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

  // 国民の休日: 前後を祝日に挟まれた平日は休みになる（例: 9月のシルバーウィーク）。
  // 月初/月末は端の祝日が見えないので除外、土日は元々休みなので対象外。
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

// 春分の日の近似式（国立天文台ベース、1980 基準）。整数日に丸めて返す。
function vernalEquinox(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

// 秋分の日の近似式（国立天文台ベース、1980 基準）
function autumnalEquinox(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
