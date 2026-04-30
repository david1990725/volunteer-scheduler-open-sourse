export function getCycleDates(): {
  isOpen: boolean;
  targetMonths: [number, number];
  sundays: string[]; // e.g. "05/05", "05/12"
} {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();

  // "雙數月10號開啟表單，25號統計資料後關閉表單"
  // Even month checking
  const isEvenMonth = month % 2 === 0;
  // TODO: remove DEV OVERRIDE in production if strictly enforced
  // const isOpen = isEvenMonth && date >= 10 && date <= 25;
  // FOR TESTING: Always open, but calculate the correct cycle

  // Target cycle is the next two months.
  // If we are in month 4 (April), cycle is 5 and 6 (May/June)
  // If we are in month 12 (Dec), cycle is 1 and 2 of next year.
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

  // To be safe, if we are in an odd month, the cycle would normally be defined by the previous even month.
  // Let's just calculate based on the next even month. 
  // Wait, if it's month 5 (odd), the form is closed, but if we want to show it, what is the cycle?
  // Let's strictly use the current even month's next two months.
  let baseMonth = isEvenMonth ? month : month - 1;
  if (baseMonth <= 0) baseMonth += 12; // Handle Jan (1) -> Dec (12)
  
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
