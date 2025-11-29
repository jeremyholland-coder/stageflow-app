import React, { useState, useEffect } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { logger } from '../lib/logger';

/**
 * ContextualTip - Simple, reliable tooltip that appears once per feature
 * Apple-style onboarding: show tips when users encounter features
 *
 * Usage:
 * <ContextualTip
 *   id="ai-insights"
 *   title="Ask AI Anything"
 *   message="Get insights about your deals, patterns, and forecasts"
 *   position="below"
 *   targetSelector=".ai-widget"
 * />
 */

export const ContextualTip = ({
  id,
  title,
  message,
  position = 'below',
  targetSelector,
  icon: Icon,
  action,
  actionLabel = 'Got it',
  delay = 1000, // Delay before showing tip (gives UI time to settle)
  userId // CRITICAL FIX: Pass userId to track per-user
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [tipPosition, setTipPosition] = useState({ top: 0, left: 0 });
  const [arrowPosition, setArrowPosition] = useState({ left: 32 }); // Track arrow position relative to tip
  const [actualPosition, setActualPosition] = useState(position); // Track actual position used
  // CRITICAL FIX: Make storage key per-user
  const storageKey = userId ? `contextual_tip_${id}_seen_${userId}` : `contextual_tip_${id}_seen`;

  // No scroll lock - users should be able to scroll to see what tooltip points at

  useEffect(() => {
    // Check if user has already seen this tip
    const hasSeenTip = localStorage.getItem(storageKey);
    if (hasSeenTip) return;

    // Wait for delay, then show tip
    const timer = setTimeout(() => {
      // Find target element
      const target = targetSelector ? document.querySelector(targetSelector) : null;

      if (!target) {
        console.warn(`ContextualTip: Target element not found for selector: ${targetSelector}`);
        return;
      }

      // Ensure target is visible and has dimensions
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.warn(`ContextualTip: Target element has no dimensions:`, targetSelector, rect);
        return;
      }

      if (target) {

        // Constants
        const TIP_WIDTH = 320;
        const TIP_HEIGHT = 180; // Approximate height
        const NAV_HEIGHT = 80; // Fixed navigation + potential banners
        const PADDING = 16;
        const ARROW_OFFSET = 16; // Distance from target to tip

        // Get current scroll position to convert viewport coords to document coords
        const scrollY = window.scrollY || window.pageYOffset;
        const scrollX = window.scrollX || window.pageXOffset;

        // Calculate initial position based on preference (add scroll to make it document-relative)
        let top, left, finalPosition = position;

        // Try preferred position first
        switch (position) {
          case 'below':
            top = rect.bottom + scrollY + ARROW_OFFSET;
            left = rect.left + scrollX + (rect.width / 2) - (TIP_WIDTH / 2);

            // If tip would go below viewport, try above
            if (rect.bottom + ARROW_OFFSET + TIP_HEIGHT > window.innerHeight + scrollY - PADDING) {
              finalPosition = 'above';
              top = rect.top + scrollY - TIP_HEIGHT - ARROW_OFFSET;
            }
            break;

          case 'above':
            top = rect.top + scrollY - TIP_HEIGHT - ARROW_OFFSET;
            left = rect.left + scrollX + (rect.width / 2) - (TIP_WIDTH / 2);

            // If tip would go above nav bar, try below
            if (rect.top - TIP_HEIGHT - ARROW_OFFSET < NAV_HEIGHT + scrollY + PADDING) {
              finalPosition = 'below';
              top = rect.bottom + scrollY + ARROW_OFFSET;
            }
            break;

          case 'right':
            top = rect.top + scrollY + (rect.height / 2) - (TIP_HEIGHT / 2);
            left = rect.right + scrollX + ARROW_OFFSET;

            // If tip would go off right edge, try left
            if (rect.right + ARROW_OFFSET + TIP_WIDTH > window.innerWidth + scrollX - PADDING) {
              finalPosition = 'left';
              left = rect.left + scrollX - TIP_WIDTH - ARROW_OFFSET;
            }
            break;

          case 'left':
            top = rect.top + scrollY + (rect.height / 2) - (TIP_HEIGHT / 2);
            left = rect.left + scrollX - TIP_WIDTH - ARROW_OFFSET;

            // If tip would go off left edge, try right
            if (rect.left - TIP_WIDTH - ARROW_OFFSET < scrollX + PADDING) {
              finalPosition = 'right';
              left = rect.right + scrollX + ARROW_OFFSET;
            }
            break;

          default:
            top = rect.bottom + scrollY + ARROW_OFFSET;
            left = rect.left + scrollX + (rect.width / 2) - (TIP_WIDTH / 2);
        }

        // Ensure tip stays within viewport (document coordinates)
        const minTop = scrollY + NAV_HEIGHT + PADDING;
        const maxTop = scrollY + window.innerHeight - TIP_HEIGHT - PADDING;
        const minLeft = scrollX + PADDING;
        const maxLeft = scrollX + window.innerWidth - TIP_WIDTH - PADDING;

        // Clamp position
        const clampedLeft = Math.max(minLeft, Math.min(left, maxLeft));
        const clampedTop = Math.max(minTop, Math.min(top, maxTop));

        // Calculate arrow position (points to center of target) - use document coords
        const targetCenterX = rect.left + scrollX + (rect.width / 2);
        const arrowLeft = Math.max(16, Math.min(targetCenterX - clampedLeft, TIP_WIDTH - 32));

        setTipPosition({ top: clampedTop, left: clampedLeft });
        setArrowPosition({ left: arrowLeft });
        setActualPosition(finalPosition);
        setIsVisible(true);

        // Debug logging (remove in production)
        logger.log(`ContextualTip "${id}" positioned:`, {
          target: targetSelector,
          targetRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          tooltipPos: { top: clampedTop, left: clampedLeft },
          arrowPos: { left: arrowLeft },
          position: finalPosition
        });
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [id, targetSelector, position, storageKey, delay]);

  const handleDismiss = () => {
    localStorage.setItem(storageKey, 'true');
    setIsVisible(false);
    if (action) action();
  };

  if (!isVisible) return null;

  return (
    <>
      {/* Subtle backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/10 backdrop-blur-[1px] transition-opacity duration-300"
        onClick={handleDismiss}
      />

      {/* Tip card - absolute positioning so it scrolls with page */}
      <div
        className="absolute z-[51] w-80 animate-in fade-in slide-in-from-top-2 duration-300"
        style={{
          top: `${tipPosition.top}px`,
          left: `${tipPosition.left}px`,
        }}
      >
        <div className="bg-white dark:bg-[#0D1F2D] rounded-2xl shadow-2xl border-2 border-[#1ABC9C]/30 overflow-hidden backdrop-blur-xl">
          {/* Header with icon */}
          <div className="bg-gradient-to-r from-[#1ABC9C] to-[#16A085] p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {Icon && (
                <div className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center">
                  <Icon className="w-5 h-5 text-white" />
                </div>
              )}
              <h3 className="text-base font-bold text-white">{title}</h3>
            </div>
            <button
              onClick={handleDismiss}
              className="p-1.5 hover:bg-white/20 rounded-lg transition-all duration-200"
              aria-label="Dismiss tip"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Content */}
          <div className="p-5">
            <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] leading-relaxed mb-5">
              {message}
            </p>

            {/* Action button */}
            <button
              onClick={handleDismiss}
              className="w-full flex items-center justify-center gap-2 bg-[#1ABC9C] hover:bg-[#16A085] text-white px-5 py-3 rounded-xl text-sm font-semibold transition-all duration-200 hover:shadow-xl hover:scale-105"
            >
              {actionLabel}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Pointer arrow - dynamically positioned to point at target */}
        {actualPosition === 'below' && (
          <div
            className="absolute -top-2 w-0 h-0"
            style={{
              left: `${arrowPosition.left - 8}px`,
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderBottom: '8px solid #1ABC9C',
              filter: 'drop-shadow(0 -1px 2px rgba(0, 0, 0, 0.1))'
            }}
          />
        )}
        {actualPosition === 'above' && (
          <div
            className="absolute -bottom-2 w-0 h-0"
            style={{
              left: `${arrowPosition.left - 8}px`,
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderTop: '8px solid white',
              filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1))'
            }}
          />
        )}
        {actualPosition === 'left' && (
          <div
            className="absolute -right-2 top-1/2 -translate-y-1/2 w-0 h-0"
            style={{
              borderTop: '8px solid transparent',
              borderBottom: '8px solid transparent',
              borderLeft: '8px solid white',
              filter: 'drop-shadow(1px 0 2px rgba(0, 0, 0, 0.1))'
            }}
          />
        )}
        {actualPosition === 'right' && (
          <div
            className="absolute -left-2 top-1/2 -translate-y-1/2 w-0 h-0"
            style={{
              borderTop: '8px solid transparent',
              borderBottom: '8px solid transparent',
              borderRight: '8px solid white',
              filter: 'drop-shadow(-1px 0 2px rgba(0, 0, 0, 0.1))'
            }}
          />
        )}
      </div>
    </>
  );
};

/**
 * Hook to manually trigger a contextual tip
 * Useful for tips that appear after user actions
 */
export const useContextualTip = (tipId) => {
  const storageKey = `contextual_tip_${tipId}_seen`;

  const hasSeenTip = () => {
    return localStorage.getItem(storageKey) === 'true';
  };

  const markAsSeen = () => {
    localStorage.setItem(storageKey, 'true');
  };

  const resetTip = () => {
    localStorage.removeItem(storageKey);
  };

  return { hasSeenTip, markAsSeen, resetTip };
};
