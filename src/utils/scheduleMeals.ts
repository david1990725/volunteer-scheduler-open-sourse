import type { Shift } from './scheduler';

export type MealCounts = { szBreakfast: number; xjBreakfast: number; xjLunch: number };

const cleanName = (value?: string): string => (value || '').replace(/（兼任）|\(兼任\)/g, '').trim();
export const isAssignedPerson = (value?: string): boolean => {
  const name = cleanName(value);
  return Boolean(name && !['缺', '—', '-', '待補', '未填', '徵求'].includes(name));
};

export function getAssignedPeople(shift: Shift | undefined, edits: Record<string, string> = {}, excludeInfoBoard = false): Set<string> {
  const result = new Set<string>();
  if (!shift) return result;
  const roles = new Set([...(shift.roleKeys || []), ...Object.keys(shift.assignments || {})]);
  for (const role of roles) {
    if (excludeInfoBoard && role.endsWith('信息版')) continue;
    const value = edits[`${shift.location}|${shift.date}|${role}`] ?? shift.assignments?.[role];
    if (isAssignedPerson(value)) result.add(cleanName(value));
  }
  return result;
}

export function calculateMeals(shifts: Shift[], date: string, edits: Record<string, string> = {}): MealCounts {
  const sz = shifts.find(s => s.date === date && s.location === '山莊大堂');
  const xj = shifts.find(s => s.date === date && s.location === '宣教大樓');
  const szPeople = getAssignedPeople(sz, edits);
  const xjPeople = getAssignedPeople(xj, edits, true);
  const infoRole = [...(xj?.roleKeys || []), ...Object.keys(xj?.assignments || {})].find(role => role.endsWith('信息版'));
  const infoValue = infoRole ? (edits[`宣教大樓|${date}|${infoRole}`] ?? xj?.assignments?.[infoRole]) : undefined;
  if (isAssignedPerson(infoValue)) szPeople.add(cleanName(infoValue));
  const xjBreakfast = new Set([...xjPeople].filter(person => !szPeople.has(person)));
  const xjLunch = new Set(xjPeople);
  if (isAssignedPerson(infoValue)) xjLunch.add(cleanName(infoValue));
  return { szBreakfast: szPeople.size, xjBreakfast: xjBreakfast.size, xjLunch: xjLunch.size };
}

export function displayAssignee(role: string, person: string, shift: Shift, edits: Record<string, string> = {}): string {
  if (role !== '網路導播' || !isAssignedPerson(person)) return person;
  const director = edits[`${shift.location}|${shift.date}|導播`] ?? shift.assignments?.['導播'];
  return cleanName(person) === cleanName(director) ? `${cleanName(person)}（兼任）` : person;
}
