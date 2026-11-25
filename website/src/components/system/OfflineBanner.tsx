import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

/** Small notice that appears when the connection drops and clears when it returns. */
export const OfflineBanner: React.FC = () => {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-2.5 rounded-full bg-[#171717] px-5 py-3 text-[14px] font-medium text-[#FFFFFF] shadow-[0_20px_40px_-16px_rgba(23,23,23,0.6)] ring-1 ring-[#C9A332]/60"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-[#C9A332]" aria-hidden />
      You are offline. Check your internet and we will pick up where you left off.
    </div>
  );
};
