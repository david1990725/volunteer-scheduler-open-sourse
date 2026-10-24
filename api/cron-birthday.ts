// =============================================================================
// Vercel Serverless Function — Daily Birthday Greetings (09:00 AM)
// =============================================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendLinePush, createBirthdayFlexMessage, verifyCronAuth } from './utils/lineService.js';
import { getAllVolunteers } from './utils/firebaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 🔒 驗證 Cron 授權
  const authHeader = req.headers['authorization'];
  if (!verifyCronAuth(authHeader)) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing CRON_SECRET authorization.' });
  }

  try {
    const now = new Date();
    // 轉至 UTC+8
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const twDate = new Date(utc + 8 * 3600000);

    const m = twDate.getMonth() + 1;
    const d = twDate.getDate();
    const todayMMDD = `${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;

    const volunteers = await getAllVolunteers();
    const birthdayList: string[] = [];
    let sentCount = 0;

    for (const vol of volunteers) {
      if (!vol.birthday) continue;

      const raw = vol.birthday.trim().replace(/\//g, '-');
      let bMMDD = '';

      const parts = raw.split('-');
      if (parts.length === 3) {
        // YYYY-MM-DD
        const bm = parseInt(parts[1], 10);
        const bd = parseInt(parts[2], 10);
        bMMDD = `${bm < 10 ? '0' + bm : bm}-${bd < 10 ? '0' + bd : bd}`;
      } else if (parts.length === 2) {
        // MM-DD
        const bm = parseInt(parts[0], 10);
        const bd = parseInt(parts[1], 10);
        bMMDD = `${bm < 10 ? '0' + bm : bm}-${bd < 10 ? '0' + bd : bd}`;
      }

      if (bMMDD === todayMMDD || req.query.name === vol.name) {
        birthdayList.push(vol.name);

        if (vol.lineId) {
          const flexMsg = createBirthdayFlexMessage(vol.name, `${m}月${d}日`);
          const ok = await sendLinePush(vol.lineId, [flexMsg]);
          if (ok) sentCount++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `今日壽星檢查完成！今日 (${todayMMDD}) 壽星: ${birthdayList.join(', ') || '無'}，成功發送 Flex 賀卡: ${sentCount} 人。`,
      todayMMDD,
      birthdayList,
      sentCount,
    });
  } catch (err: any) {
    console.error('[cron-birthday Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
}
