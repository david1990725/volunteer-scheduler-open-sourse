export function getLastSundayOfCycle(year: number, months: [number, number]): Date {
  const m2 = months[1];
  // Start from the last day of month m2
  const lastDay = new Date(year, m2, 0); // 0th day of next month is the last day of m2
  // Find the last Sunday of month m2 by walking backwards
  while (lastDay.getDay() !== 0) {
    lastDay.setDate(lastDay.getDate() - 1);
  }
  // Set time to the very end of that day (23:59:59.999)
  lastDay.setHours(23, 59, 59, 999);
  return lastDay;
}

export function getSundaysForCycle(year: number, months: [number, number]): string[] {
  const [m1, m2] = months;
  const sundays: string[] = [];

  const y1 = year;
  const y2 = m2 < m1 ? year + 1 : year;

  // Find all Sundays in m1
  let d = new Date(y1, m1 - 1, 1);
  while (d.getMonth() === m1 - 1) {
    if (d.getDay() === 0) { // Sunday
      sundays.push(`${String(m1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
    }
    d.setDate(d.getDate() + 1);
  }

  // Find all Sundays in m2
  d = new Date(y2, m2 - 1, 1);
  while (d.getMonth() === m2 - 1) {
    if (d.getDay() === 0) { // Sunday
      sundays.push(`${String(m2).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
    }
    d.setDate(d.getDate() + 1);
  }

  return sundays;
}

export function getCycleDates(): {
  isOpen: boolean;
  currentMonths: [number, number];
  nextMonths: [number, number];
  sundays: string[]; // e.g. "05/05", "05/12"
  currentCycleId: string;
  nextCycleId: string;
} {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const isEvenMonth = month % 2 === 0;

  // 計算當前所在的雙數月週期結尾 (例如 5月、6月皆屬於 6月結尾的週期)
  const currentCycleEndMonth = isEvenMonth ? month : month + 1;
  const currentCycleStartMonth = currentCycleEndMonth - 1;
  
  // 目標週期為下一個雙數月份週期
  let targetMonth1 = currentCycleEndMonth + 1;
  let targetMonth2 = currentCycleEndMonth + 2;

  // 跨年處理
  if (targetMonth1 > 12) targetMonth1 -= 12;
  if (targetMonth2 > 12) targetMonth2 -= 12;

  const nextMonths: [number, number] = [targetMonth1, targetMonth2];
  const nextCycleYear = targetMonth1 < currentCycleStartMonth ? year + 1 : year;
  const sundays = getSundaysForCycle(nextCycleYear, nextMonths);

  return {
    isOpen: true, // 預設全時開啟
    currentMonths: [currentCycleStartMonth, currentCycleEndMonth],
    nextMonths,
    sundays,
    currentCycleId: `${year}-${String(currentCycleStartMonth).padStart(2, '0')}-${String(currentCycleEndMonth).padStart(2, '0')}`,
    nextCycleId: `${nextCycleYear}-${String(targetMonth1).padStart(2, '0')}-${String(targetMonth2).padStart(2, '0')}`,
  };
}

/** 週期 ID 是表單與班表的資料邊界；不可依執行當天推測其年份。 */
export function getCycleId(year: number, months: [number, number]): string {
  return `${year}-${String(months[0]).padStart(2, '0')}-${String(months[1]).padStart(2, '0')}`;
}
