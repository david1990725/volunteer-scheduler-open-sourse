// =============================================================================
// Vercel Serverless Function — Unified Cron Dispatcher (/api/cron)
// =============================================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyCronAuth } from './utils/lineService';
import handleBirthday from './cron-birthday';
import handleSaturday from './cron-saturday';
import handleCycle from './cron-cycle';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 🔒 驗證 Cron 授權
  const authHeader = req.headers['authorization'];
  if (!verifyCronAuth(authHeader)) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing CRON_SECRET authorization.' });
  }

  const job = req.query.job as string | undefined;

  if (job === 'saturday') {
    return handleSaturday(req, res);
  }
  if (job === 'cycle') {
    return handleCycle(req, res);
  }
  if (job === 'birthday') {
    return handleBirthday(req, res);
  }

  // 預設同時執行每日例行檢查 (生日祝福 + 週期催填檢查)
  try {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const twDate = new Date(utc + 8 * 3600000);
    const day = twDate.getDay(); // 6 = Saturday

    const results: Record<string, any> = {};

    const createMockRes = (key: string): VercelResponse =>
      ({
        status: (_code: number) => ({
          json: (data: any) => {
            results[key] = data;
            return {} as any;
          },
          send: (data: any) => {
            results[key] = data;
            return {} as any;
          },
        }),
      } as unknown as VercelResponse);

    // 每日執行生日祝賀
    await handleBirthday(req, createMockRes('birthday'));

    // 每日檢查是否為 15 或 20 號催填
    await handleCycle(req, createMockRes('cycle'));

    // 若剛好為週六下午，可一併執行週六服事提醒
    if (day === 6) {
      await handleSaturday(req, createMockRes('saturday'));
    }

    return res.status(200).json({
      success: true,
      message: 'Vercel Cron 每日檢查執行完畢！',
      results,
    });
  } catch (err: any) {
    console.error('[cron dispatcher Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
}
