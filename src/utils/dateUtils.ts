export function getCycleDates(): {
  isOpen: boolean;
  targetMonths: [number, number];
  sundays: string[]; // e.g. "05/05", "05/12"
} {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // 目前預設為全時開啟，若未來要恢復雙數月開放機制，請修改下方 isOpen 值
  const isEvenMonth = month % 2 === 0;

  // 計算目標週期（下兩個月）
  let targetMonth1 = month + 1;
  let targetMonth2 = month + 2;
  let targetYear1 = year;
  let targetYear2 = year;

  if (targetMonth1 > 12) {
    targetMonth1 -= 12;
    targetYear1 += 1;
  }
  if (targetMonth2 > 12) {
    targetMonth2 -= 12;
    targetYear2 += 1;
  }

  // 依據當前雙數月計算目標週期
  let baseMonth = isEvenMonth ? month : month - 1;
  if (baseMonth <= 0) baseMonth += 12;

  targetMonth1 = baseMonth + 1;
  targetMonth2 = baseMonth + 2;
  if (targetMonth1 > 12) { targetMonth1 -= 12; targetYear1 = year + 1; }
  if (targetMonth2 > 12) { targetMonth2 -= 12; targetYear2 = year + 1; }

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
