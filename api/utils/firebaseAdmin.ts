// =============================================================================
// Firebase Firestore Service for Vercel Serverless Functions
// =============================================================================

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'bol-production-tw',
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || '',
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID || '',
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

export interface VolunteerRecord {
  name: string;
  userLevel?: string;
  jobTitles?: string[];
  skillRoles?: string[];
  videoSkills?: Record<string, number>;
  lightLevel?: number;
  stageLevel?: number;
  audioSkills?: Record<string, number>;
  lineId?: string;
  lineDisplayName?: string;
  pictureUrl?: string;
  birthday?: string;
  isFullTimer?: boolean;
  isBackfillLeader?: boolean;
}

export interface ShiftSlot {
  date: string;
  location: string;
  assignments: Record<string, string>;
  roleKeys: string[];
}

export interface ScheduleDoc {
  id?: string;
  cycleKey: string;
  team: string;
  shifts: ShiftSlot[];
  updatedAt?: any;
}

/** 取得所有義工名單 */
export async function getAllVolunteers(): Promise<VolunteerRecord[]> {
  try {
    const colRef = collection(db, 'volunteers');
    const snap = await getDocs(colRef);
    const result: VolunteerRecord[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      result.push({
        name: data.name || d.id,
        userLevel: data.userLevel || 'user',
        jobTitles: data.jobTitles || [],
        skillRoles: data.skillRoles || [],
        videoSkills: data.videoSkills || {},
        lightLevel: data.lightLevel || 1,
        stageLevel: data.stageLevel || 1,
        audioSkills: data.audioSkills || {},
        lineId: data.lineId,
        lineDisplayName: data.lineDisplayName,
        pictureUrl: data.pictureUrl,
        birthday: data.birthday,
        isFullTimer: data.isFullTimer,
        isBackfillLeader: data.isBackfillLeader,
      });
    });
    return result;
  } catch (err) {
    console.error('[getAllVolunteers Error]:', err);
    return [];
  }
}

/** 依據 LINE userId 尋找義工 */
export async function getVolunteerByLineId(lineId: string): Promise<VolunteerRecord | null> {
  if (!lineId) return null;
  try {
    const colRef = collection(db, 'volunteers');
    const q = query(colRef, where('lineId', '==', lineId));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      const data = d.data() as any;
      return {
        name: data.name || d.id,
        ...data,
      };
    }
  } catch (err) {
    console.error('[getVolunteerByLineId Error]:', err);
  }
  return null;
}

/** 記錄或更新群組狀態 */
export async function saveGroupStatus(groupId: string, type: string, status: 'active' | 'left'): Promise<void> {
  if (!groupId) return;
  try {
    const docRef = doc(db, 'line_groups', groupId);
    await setDoc(
      docRef,
      {
        groupId,
        type: type || 'group',
        status,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error('[saveGroupStatus Error]:', err);
  }
}

/** 取得所有活躍的群組 ID */
export async function getActiveGroups(): Promise<string[]> {
  try {
    const colRef = collection(db, 'line_groups');
    const q = query(colRef, where('status', '==', 'active'));
    const snap = await getDocs(q);
    const groups: string[] = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.groupId) groups.push(data.groupId);
    });
    return groups;
  } catch (err) {
    console.error('[getActiveGroups Error]:', err);
    return [];
  }
}

/** 取得指定週期與團隊的排班表 (支援多種 docId 命名規則) */
export async function getSchedule(cycleKey: string, team: string = 'video'): Promise<ScheduleDoc | null> {
  try {
    const candidates = [
      `${cycleKey}_${team}`,
      `${cycleKey.replace(/_(\d{2})-(\d{2})/, '年_$1-$2月排班表')}_${team}`,
      `${cycleKey.replace(/_0?(\d+)-0?(\d+)/, '年_$1-$2月排班表')}_${team}`,
      cycleKey,
    ];

    for (const docId of candidates) {
      const docRef = doc(db, 'schedules', docId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return { id: snap.id, ...(snap.data() as any) };
      }
    }
  } catch (err) {
    console.error('[getSchedule Error]:', err);
  }
  return null;
}

/** 取得指定週期的最終整合服事表 */
export async function getFinalSchedule(cycleKey: string): Promise<ScheduleDoc | null> {
  try {
    const candidates = [
      `${cycleKey}_final`,
      `${cycleKey.replace(/_(\d{2})-(\d{2})/, '年_$1-$2月排班表')}_final`,
      `${cycleKey.replace(/_0?(\d+)-0?(\d+)/, '年_$1-$2月排班表')}_final`,
      `${cycleKey}_video`,
      cycleKey,
    ];

    for (const docId of candidates) {
      const docRef = doc(db, 'schedules', docId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return { id: snap.id, ...(snap.data() as any) };
      }
    }
  } catch (err) {
    console.error('[getFinalSchedule Error]:', err);
  }
  return null;
}

/** 即時補位更新排班表（同時更新團隊 doc 與 _final doc） */
export async function applySlotFill(
  cycleKey: string,
  team: string,
  targetDate: string,
  location: string,
  role: string,
  volunteerName: string
): Promise<{ success: boolean; message: string }> {
  try {
    const schedule = await getSchedule(cycleKey, team);
    if (!schedule || !schedule.shifts) {
      return { success: false, message: `找不到週期 ${cycleKey} 的排班表` };
    }

    let found = false;
    const updatedShifts = schedule.shifts.map((shift) => {
      const shiftDate = shift.date.trim();
      const shiftLoc = shift.location.trim();

      const matchDate = shiftDate.includes(targetDate) || targetDate.includes(shiftDate);
      const matchLoc = !location || shiftLoc.includes(location) || location.includes(shiftLoc);

      if (matchDate && matchLoc) {
        if (shift.assignments && (shift.assignments[role] === '缺' || !shift.assignments[role] || shift.assignments[role] === '')) {
          shift.assignments[role] = volunteerName;
          found = true;
        }
      }
      return shift;
    });

    if (!found) {
      return { success: false, message: `該週 (${targetDate} ${location} ${role}) 可能已被填補或無此空缺。` };
    }

    const docId = schedule.id || `${cycleKey}_${team}`;
    const docRef = doc(db, 'schedules', docId);
    await setDoc(docRef, { shifts: updatedShifts, updatedAt: serverTimestamp() }, { merge: true });

    // 同步更新 _final doc (若存在)
    try {
      const finalSchedule = await getFinalSchedule(cycleKey);
      if (finalSchedule && finalSchedule.shifts && finalSchedule.id?.endsWith('_final')) {
        const updatedFinalShifts = finalSchedule.shifts.map((shift) => {
          const shiftDate = shift.date.trim();
          const shiftLoc = shift.location.trim();
          const matchDate = shiftDate.includes(targetDate) || targetDate.includes(shiftDate);
          const matchLoc = !location || shiftLoc.includes(location) || location.includes(shiftLoc);

          if (matchDate && matchLoc && shift.assignments && (shift.assignments[role] === '缺' || !shift.assignments[role] || shift.assignments[role] === '')) {
            shift.assignments[role] = volunteerName;
          }
          return shift;
        });

        await setDoc(doc(db, 'schedules', finalSchedule.id), {
          shifts: updatedFinalShifts,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
    } catch (finalErr) {
      console.warn('[SlotFill Final Sync Warning]:', finalErr);
    }

    return { success: true, message: `已成功將 ${volunteerName} 填入 ${targetDate} ${location}【${role}】！` };
  } catch (err: any) {
    console.error('[applySlotFill Error]:', err);
    return { success: false, message: err?.message || '更新排班表失敗' };
  }
}
