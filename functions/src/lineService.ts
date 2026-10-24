// =============================================================================
// LINE Messaging API & Flex Message Builder for Firebase Cloud Functions
// =============================================================================

import * as crypto from 'crypto';

export interface LineEvent {
  type: string;
  replyToken?: string;
  source: {
    type: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  message?: {
    id: string;
    type: string;
    text?: string;
    mention?: {
      mentionees: Array<{ type: string; userId?: string; index?: number; length?: number }>;
    };
  };
  postback?: {
    data: string;
  };
}

export interface LineMessage {
  type: string;
  text?: string;
  altText?: string;
  contents?: any;
  quickReply?: {
    items: Array<{
      type: string;
      action: {
        type: string;
        label: string;
        text?: string;
        data?: string;
        displayText?: string;
      };
    }>;
  };
}

/** 取得環境變數設定 */
export function getLineConfig() {
  return {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    channelSecret: process.env.LINE_CHANNEL_SECRET || '',
    lineLoginChannelId: process.env.LINE_LOGIN_CHANNEL_ID || '',
    systemUrl: process.env.SYSTEM_URL || 'https://bolproduction.vercel.app',
    adminEmail: process.env.ADMIN_EMAIL || '',
  };
}

/** 🔒 驗證 LINE Webhook HMAC-SHA256 簽名 */
export function verifyLineSignature(rawBody: string, signature: string | undefined): boolean {
  const { channelSecret } = getLineConfig();
  // Webhook 未設定 secret 時必須停止處理，不能以開發方便放行公開端點。
  if (!channelSecret) return false;
  if (!signature) return false;

  const hash = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  return hash === signature;
}

/** 發送 LINE 回覆訊息 (Reply API) */
export async function sendLineReply(replyToken: string, messages: LineMessage[]): Promise<boolean> {
  const { channelAccessToken } = getLineConfig();
  if (!channelAccessToken || !replyToken) return false;

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[sendLineReply Failed]:', res.status, errText);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[sendLineReply Error]:', err);
    return false;
  }
}

/** 發送 LINE 推播訊息 (Push API) */
export async function sendLinePush(to: string, messages: LineMessage[]): Promise<boolean> {
  const { channelAccessToken } = getLineConfig();
  if (!channelAccessToken || !to) return false;

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        to,
        messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[sendLinePush Failed]:', res.status, errText);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[sendLinePush Error]:', err);
    return false;
  }
}

/** 建立生日祝福 Flex Message */
export function createBirthdayFlexMessage(name: string, birthdayStr?: string): LineMessage {
  const { systemUrl } = getLineConfig();
  const dateText = birthdayStr ? ` (🎂 ${birthdayStr})` : '';

  const bubble: any = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1E293B',
      paddingAll: '20px',
      contents: [
        {
          type: 'text',
          text: '🎂 生日快樂！HAPPY BIRTHDAY',
          weight: 'bold',
          color: '#F59E0B',
          size: 'sm',
          letterSpacing: '1px',
        },
        {
          type: 'text',
          text: `親愛的 ${name}${dateText}`,
          weight: 'bold',
          color: '#FFFFFF',
          size: 'xl',
          margin: 'md',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0F172A',
      paddingAll: '20px',
      contents: [
        {
          type: 'text',
          text: '「願耶和華賜福給你，保護你。願耶和華使他的臉光照你，賜恩給你。願耶和華向你仰臉，賜你平安。」',
          wrap: true,
          color: '#E2E8F0',
          size: 'sm',
          style: 'italic',
          lineSpacing: '6px',
        },
        {
          type: 'separator',
          color: '#334155',
          margin: 'lg',
        },
        {
          type: 'text',
          text: '感謝您在敬拜團隊中的忠心與擺上！在這特別的日子裡，願上帝加倍恩待您，使您新的一歲滿有喜樂、恩典與屬天的力量！🌟',
          wrap: true,
          color: '#94A3B8',
          size: 'sm',
          margin: 'lg',
          lineSpacing: '5px',
        },
      ],
    },
  };

  if (systemUrl) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0F172A',
      paddingAll: '16px',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#F59E0B',
          action: {
            type: 'uri',
            label: '進入排班系統',
            uri: systemUrl,
          },
        },
      ],
    };
  }

  return {
    type: 'flex',
    altText: `🎂 祝 ${name} 生日快樂！願上帝滿滿恩典伴隨您！`,
    contents: bubble,
  };
}
