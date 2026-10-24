import test from 'node:test';
import assert from 'node:assert/strict';
import { canServeNetworkDirector, parseScheduleResponsesData, parseSkillTreeData, type Shift } from '../src/utils/scheduler';
import { calculateMeals, displayAssignee } from '../src/utils/scheduleMeals';

const row = (name: string, videoSkills: Record<string, number>, skillRoles: string[] = [], isFullTimer = false) => ({
  name, jobTitles: ['video'], skillRoles, videoSkills, isFullTimer,
});

test('網路導播資格採導播認證或技能加 AD 門檻', () => {
  const certified = parseSkillTreeData([row('導播', { ad: 0 }, ['director_xj'])])['導播'];
  const trained = parseSkillTreeData([row('受訓', { networkDirector: 1, ad: 5 })])['受訓'];
  const below = parseSkillTreeData([row('不足', { networkDirector: 10, ad: 4 })])['不足'];
  assert.equal(canServeNetworkDirector(certified), true);
  assert.equal(canServeNetworkDirector(trained), true);
  assert.equal(canServeNetworkDirector(below), false);
});

test('平面偏好仍可排網路導播並標記 override，缺人時不自動兼任', () => {
  const volunteers = parseSkillTreeData([
    row('宣教導播', { director: 9 }, ['director_xj'], true),
    row('山莊導播', { director: 9 }, ['director_sz']),
    row('平面', { photo: 9 }),
    row('一機', { cam1: 9 }),
    row('二機', { cam2: 9 }),
    row('三機', { cam3: 9 }),
    row('網導', { networkDirector: 7, ad: 5 }),
  ]);
  const responses = Object.keys(volunteers).filter(name => name !== '宣教導播').map(name => ({
    姓名: name, 組別: name === '網導' ? '平面拍照組' : '動態攝影組',
    '[11/01]': name === '網導' ? '山莊(平面)' : '山莊(動態)',
  }));
  const shifts = parseScheduleResponsesData(responses, volunteers, ['11/01']);
  const sz = shifts.find(shift => shift.location === '山莊大堂')!;
  assert.equal(sz.assignments['網路導播'], '網導');
  assert.equal(sz.overrides['網路導播'], true);
  const noNetwork = { ...volunteers };
  delete noNetwork['網導'];
  const missing = parseScheduleResponsesData(responses, noNetwork, ['11/01'])
    .find(shift => shift.location === '山莊大堂')!;
  assert.equal(missing.assignments['網路導播'], '缺');
});

test('兼任只展示標記，山莊早餐和宣教午餐各一份', () => {
  const shifts: Shift[] = [
    { date: '11/01', location: '山莊大堂', roleKeys: ['導播', '網路導播'], assignments: { 導播: '甲', 網路導播: '甲' }, overrides: {} },
    { date: '11/01', location: '宣教大樓', roleKeys: ['信息版'], assignments: { 信息版: '甲' }, overrides: {} },
  ];
  assert.deepEqual(calculateMeals(shifts, '11/01'), { szBreakfast: 1, xjBreakfast: 0, xjLunch: 1 });
  assert.equal(displayAssignee('網路導播', '甲', shifts[0]), '甲（兼任）');
  assert.equal(shifts[0].assignments['網路導播'], '甲');
});

test('信息版即使只有宣教職位，也計入山莊早餐與宣教午餐', () => {
  const shifts: Shift[] = [
    { date: '11/08', location: '山莊大堂', roleKeys: ['導播'], assignments: { 導播: '乙' }, overrides: {} },
    { date: '11/08', location: '宣教大樓', roleKeys: ['信息版'], assignments: { 信息版: '甲' }, overrides: {} },
  ];
  assert.deepEqual(calculateMeals(shifts, '11/08'), { szBreakfast: 2, xjBreakfast: 0, xjLunch: 1 });
});
