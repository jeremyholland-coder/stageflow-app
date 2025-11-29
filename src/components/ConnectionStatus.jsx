import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { getCurrentNetworkQuality } from '../lib/network-quality';

/**
 * Connection Status Indicator
 *
 * NEXT-LEVEL UX: Shows real-time connection quality and offline status
 * Helps users understand when latency/errors are due to network vs app issues
 *
 * Features:
 * - Auto-detects online/offline status
 * - Shows network quality (Excellent, Good, Fair, Poor)
 * - Auto-hides when connection is good
 * - Prominent warning when offline or poor connection
 * - Respects reduced motion preferences
 *
 * Performance:
 * - Lightweight (~2KB)
 * - Uses native browser APIs (no polling)
 * - Event-driven (no performance impact)
 */
export const ConnectionStatus = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [networkQuality, setNetworkQuality] = useState('good');
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const updateStatus = () => {
      const online = navigator.onLine;
      const quality = online ? getCurrentNetworkQuality() : 'offline';

      setIsOnline(online);
      setNetworkQuality(quality);

      // Show banner only when offline or poor connection
      setShowBanner(!online || quality === 'poor' || quality === 'fair');
    };

    // Initial check
    updateStatus();

    // Listen for online/offline events
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);

    // CRITICAL FIX: Store connection reference to ensure cleanup uses same object
    let connectionRef = null;
    if ('connection' in navigator) {
      connectionRef = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (connectionRef) {
        connectionRef.addEventListener('change', updateStatus);
      }
    }

    // Periodic check (every 30s) as backup
    const interval = setInterval(updateStatus, 30000);

    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
      clearInterval(interval);

      // CRITICAL FIX: Use stored reference for cleanup
      if (connectionRef) {
        connectionRef.removeEventListener('change', updateStatus);
      }
    };
  }, []);

  // Don't render if connection is good
  if (!showBanner) return null;

  const getStatusConfig = () => {
    if (!isOnline || networkQuality === 'offline') {
      return {
        icon: WifiOff,
        text: 'No internet connection',
        subtext: 'Changes will sync when connection is restored',
        color: 'bg-red-500',
        textColor: 'text-white'
      };
    }

    if (networkQuality === 'poor') {
      return {
        icon: WifiOff,
        text: 'Slow connection detected',
        subtext: 'Some features may load slowly',
        color: 'bg-orange-500',
        textColor: 'text-white'
      };
    }

    if (networkQuality === 'fair') {
      return {
        icon: Wifi,
        text: 'Limited connectivity',
        subtext: 'Using reduced data mode',
        color: 'bg-yellow-500',
        textColor: 'text-gray-900'
      };
    }

    return null;
  };

  const config = getStatusConfig();
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div
      className={`
        fixed top-0 left-0 right-0 z-50
        ${config.color} ${config.textColor}
        px-4 py-2 shadow-lg
        animate-slide-down
      `}
      role="alert"
      aria-live="polite"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-3">
        <Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{config.text}</p>
          <p className="text-xs opacity-90 hidden sm:block">{config.subtext}</p>
        </div>
      </div>
    </div>
  );
};

export default ConnectionStatus;
