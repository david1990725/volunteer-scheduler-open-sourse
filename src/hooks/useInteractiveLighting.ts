import { useEffect } from 'react';

/**
 * 全域互動光影效果 Hook
 *
 * - 桌面端：追蹤滑鼠位置，更新 CSS 變數驅動玻璃反光與 3D 傾斜。
 * - 行動端：使用加速度感測器（DeviceOrientation），若不支援則維持正面。
 */
export function useInteractiveLighting() {
  useEffect(() => {
    // --- Desktop: 滑鼠追蹤 ---
    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      document.documentElement.style.setProperty('--mouse-x', `${x}%`);
      document.documentElement.style.setProperty('--mouse-y', `${y}%`);

      const rotateY = (e.clientX / window.innerWidth - 0.5) * 4;
      const rotateX = (e.clientY / window.innerHeight - 0.5) * -4;
      document.documentElement.style.setProperty('--tilt-x', `${rotateX}deg`);
      document.documentElement.style.setProperty('--tilt-y', `${rotateY}deg`);
    };

    // --- Mobile: 加速度感測器 ---
    const handleDeviceOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;

      // beta: -180~180 (前後傾斜), gamma: -90~90 (左右傾斜)
      const tiltX = Math.max(-10, Math.min(10, e.beta / 10)) * -1;
      const tiltY = Math.max(-10, Math.min(10, e.gamma / 10));

      document.documentElement.style.setProperty('--tilt-x', `${tiltX}deg`);
      document.documentElement.style.setProperty('--tilt-y', `${tiltY}deg`);

      const mouseX = 50 + (e.gamma / 90) * 50;
      const mouseY = 50 + (e.beta / 180) * 50;
      document.documentElement.style.setProperty('--mouse-x', `${mouseX}%`);
      document.documentElement.style.setProperty('--mouse-y', `${mouseY}%`);
    };

    document.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('deviceorientation', handleDeviceOrientation);

    // iOS 需要使用者互動後才能取得權限
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      const requestPermission = async () => {
        try {
          await (DeviceOrientationEvent as any).requestPermission();
        } catch {
          console.error('Device orientation permission denied');
        }
      };
      document.addEventListener('click', requestPermission, { once: true });
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('deviceorientation', handleDeviceOrientation);
    };
  }, []);
}
