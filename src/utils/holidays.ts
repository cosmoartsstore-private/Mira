export interface Holiday {
  day: number;
  name: string;
}

export function getJapaneseHolidays(year: number, month: number): Holiday[] {
  const holidays: Holiday[] = [];

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

  // Happy Monday holidays
  if (month === 1) holidays.push({ day: nthMonday(year, 1, 2), name: "成人の日" });
  if (month === 7) holidays.push({ day: nthMonday(year, 7, 3), name: "海の日" });
  if (month === 9) holidays.push({ day: nthMonday(year, 9, 3), name: "敬老の日" });
  if (month === 10) holidays.push({ day: nthMonday(year, 10, 2), name: "スポーツの日" });

  // Equinox days (approximate)
  if (month === 3) holidays.push({ day: vernalEquinox(year), name: "春分の日" });
  if (month === 9) holidays.push({ day: autumnalEquinox(year), name: "秋分の日" });

  // Substitute holidays (振替休日): if holiday falls on Sunday, next Monday is off
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

function nthMonday(year: number, month: number, n: number): number {
  const first = new Date(year, month - 1, 1);
  let dow = first.getDay();
  let firstMonday = dow <= 1 ? 1 + (1 - dow) : 1 + (8 - dow);
  return firstMonday + (n - 1) * 7;
}

function vernalEquinox(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinox(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
