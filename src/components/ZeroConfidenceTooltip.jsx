import React, { useState, useRef, useEffect } from 'react';
import { Portal, calculateDropdownPosition, Z_INDEX } from './ui/Portal';

/**
 * ZeroConfidenceTooltip
 *
 * Apple-style tooltip that appears when hovering over the confidence
 * label or percentage for deals with 0% confidence.
 *
 * Design: Minimal, neutral, helpful (no guilt, no complexity)
 */
export const ZeroConfidenceTooltip = ({ children, confidenceScore }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const triggerRef = useRef(null);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const hideTimeoutRef = useRef(null);

  // Only show tooltip for 0% confidence
  const shouldShowTooltip = confidenceScore === 0;

  // Calculate tooltip position when shown
  useEffect(() => {
    if (!showTooltip || !triggerRef.current) return;

    const updatePosition = () => {
      const pos = calculateDropdownPosition(triggerRef.current, {
        placement: 'top',
        offset: 8,
        dropdownWidth: 260,
        dropdownHeight: 88,
      });
      setTooltipPosition(pos);
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [showTooltip]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    if (!shouldShowTooltip) return;

    // Clear any pending hide
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    // Small delay to prevent flicker when moving between trigger and tooltip
    hideTimeoutRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, 100);
  };

  // If not 0% confidence, just render children without tooltip behavior
  if (!shouldShowTooltip) {
    return <>{children}</>;
  }

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="cursor-help"
      >
        {children}
      </div>

      {/* Apple-style Tooltip via Portal */}
      {showTooltip && (
        <Portal>
          <div
            role="tooltip"
            aria-label="Why 0% confidence?"
            className="fixed pointer-events-none"
            style={{
              top: tooltipPosition.top,
              left: tooltipPosition.left,
              zIndex: Z_INDEX.portalTooltip,
              // Apple-style fade in animation
              animation: 'fadeInUp 0.12s ease-out forwards',
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Tooltip Container - Apple-style glass morphism */}
            <div
              className="max-w-[260px] rounded-xl shadow-lg"
              style={{
                background: 'rgba(10, 10, 10, 0.72)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '12px 14px',
                // Soft ambient shadow
                boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2)',
              }}
            >
              {/* Title */}
              <p
                className="font-semibold mb-1"
                style={{
                  fontSize: '13px',
                  lineHeight: '1.3',
                  color: 'rgba(255, 255, 255, 0.9)',
                }}
              >
                Why 0% confidence?
              </p>

              {/* Body */}
              <p
                style={{
                  fontSize: '13px',
                  lineHeight: '1.4',
                  color: '#D1D5DB', // text-gray-300
                }}
              >
                No recent activity. Add notes, update the stage, or log contact to improve confidence.
              </p>
            </div>

            {/* Arrow pointing down (toward the trigger) */}
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                bottom: '-6px',
                width: 0,
                height: 0,
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                borderTop: '6px solid rgba(10, 10, 10, 0.72)',
              }}
            />
          </div>

          {/* Inline animation keyframes */}
          <style>{`
            @keyframes fadeInUp {
              from {
                opacity: 0;
                transform: translateY(4px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
          `}</style>
        </Portal>
      )}
    </>
  );
};

export default ZeroConfidenceTooltip;
