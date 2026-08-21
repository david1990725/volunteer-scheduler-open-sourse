import React, { useState } from 'react';
import { User } from 'lucide-react';

interface UserAvatarProps {
  src?: string | null;
  name?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  src,
  name = '義工',
  size = 48,
  className = '',
  style = {},
}) => {
  const [imgError, setImgError] = useState(false);
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
          border: '1.5px solid var(--bg-card-border, rgba(255, 255, 255, 0.15))',
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
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.03) 100%)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-primary)',
        fontWeight: 600,
        fontSize: `${Math.round(size * 0.42)}px`,
        border: '1.5px solid var(--bg-card-border, rgba(255, 255, 255, 0.12))',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        flexShrink: 0,
        userSelect: 'none',
        ...style,
      }}
    >
      {initial && initial !== '?' ? initial : <User size={Math.round(size * 0.55)} color="var(--text-secondary)" />}
    </div>
  );
};

