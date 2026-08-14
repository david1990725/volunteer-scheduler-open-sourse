import React, { useState } from 'react';
import { User } from 'lucide-react';

interface UserAvatarProps {
  src?: string | null;
  name?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** 依據姓名生成穩定的色相角度 */
function getNameHue(name?: string): number {
  if (!name) return 210;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash % 360);
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  src,
  name = '義工',
  size = 48,
  className = '',
  style = {},
}) => {
  const [imgError, setImgError] = useState(false);
  const hue = getNameHue(name);
  const initial = name ? name.trim().charAt(0) : '?';

  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className={className}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '2px solid rgba(234, 179, 8, 0.4)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          flexShrink: 0,
          ...style,
        }}
      />
    );
  }

  return (
    <div
      className={className}
      title={name}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        background: `linear-gradient(135deg, hsl(${hue}, 70%, 45%), hsl(${(hue + 40) % 360}, 80%, 35%))`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ffffff',
        fontWeight: 700,
        fontSize: `${Math.round(size * 0.42)}px`,
        border: '2px solid rgba(255, 255, 255, 0.2)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        flexShrink: 0,
        userSelect: 'none',
        ...style,
      }}
    >
      {initial && initial !== '?' ? initial : <User size={Math.round(size * 0.55)} color="#ffffff" />}
    </div>
  );
};
