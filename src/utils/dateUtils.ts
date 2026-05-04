export function getCycleDates(): {
  isOpen: boolean;
  targetMonths: [number, number];
  sundays: string[]; // e.g. "05/05", "05/12"
} {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const isEvenMonth = month % 2 === 0;

  // 計算當前所在的雙數月週期結尾 (例如 5月、6月皆屬於 6月結尾的週期)
  let currentCycleEndMonth = isEvenMonth ? month : month + 1;

  // 目標週期為下一個雙數月份週期
  let targetMonth1 = currentCycleEndMonth + 1;
  let targetMonth2 = currentCycleEndMonth + 2;
  let targetYear1 = year;
  let targetYear2 = year;

  // 跨年處理
  if (targetMonth1 > 12) {
    targetMonth1 -= 12;
    targetYear1 = year + 1;
  }
  if (targetMonth2 > 12) {
    targetMonth2 -= 12;
    targetYear2 = year + 1;
  }

  const sundays: string[] = [];
  
  // Find all Sundays in targetMonth1
  let d = new Date(targetYear1, targetMonth1 - 1, 1);
  while (d.getMonth() === targetMonth1 - 1) {
    if (d.getDay() === 0) { // Sunday
      sundays.push(`${String(targetMonth1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
    }
    d.setDate(d.getDate() + 1);
  }

  // Find all Sundays in targetMonth2
  d = new Date(targetYear2, targetMonth2 - 1, 1);
  while (d.getMonth() === targetMonth2 - 1) {
    if (d.getDay() === 0) { // Sunday
      sundays.push(`${String(targetMonth2).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
    }
    d.setDate(d.getDate() + 1);
  }

  return {
    isOpen: true, // 預設全時開啟
    targetMonths: [targetMonth1, targetMonth2],
    sundays
  };
}
