/**
 * Accessibility Utilities
 * Area 5 - Production Hardening (WCAG 2.1 AA Compliance)
 *
 * Provides:
 * - Focus trap for modals/dialogs
 * - Screen reader announcements (live regions)
 * - Keyboard navigation helpers
 * - ARIA utilities
 *
 * @author StageFlow Engineering
 * @date December 2025
 */

import React, { useCallback, useRef, useEffect } from 'react';

/**
 * Generate accessible ARIA label for buttons
 */
export const getAriaLabel = (action, context) => {
  return `${action} ${context}`;
};

/**
 * Screen reader only text (visually hidden but accessible)
 */
export const ScreenReaderOnly = ({ children }) => (
  <span className="sr-only">{children}</span>
);

/**
 * Focus trap for modals and dialogs
 * WCAG 2.1 Level A: Keyboard accessible (2.1.1, 2.1.2)
 */
export const useFocusTrap = (isActive) => {
  const containerRef = React.useRef(null);
  const previousActiveElement = React.useRef(null);

  React.useEffect(() => {
    if (!isActive || !containerRef.current) return;

    // Store the previously focused element to restore on close
    previousActiveElement.current = document.activeElement;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Focus first element on mount (small delay to ensure DOM is ready)
    requestAnimationFrame(() => {
      firstElement.focus();
    });

    const handleTab = (e) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    // Handle Escape key to close (parent should handle actual close)
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        // Restore focus to the previously focused element
        if (previousActiveElement.current && previousActiveElement.current.focus) {
          previousActiveElement.current.focus();
        }
      }
    };

    container.addEventListener('keydown', handleTab);
    document.addEventListener('keydown', handleEscape);

    return () => {
      container.removeEventListener('keydown', handleTab);
      document.removeEventListener('keydown', handleEscape);

      // Restore focus when closing
      if (previousActiveElement.current && previousActiveElement.current.focus) {
        previousActiveElement.current.focus();
      }
    };
  }, [isActive]);

  return containerRef;
};

// Persistent live region element for announcements
let liveRegionElement = null;

/**
 * Get or create the live region element
 * Using a persistent element ensures consistent announcement behavior
 */
const getLiveRegion = (priority) => {
  const id = `sr-announcer-${priority}`;
  let region = document.getElementById(id);

  if (!region) {
    region = document.createElement('div');
    region.id = id;
    region.setAttribute('role', priority === 'assertive' ? 'alert' : 'status');
    region.setAttribute('aria-live', priority);
    region.setAttribute('aria-atomic', 'true');
    region.className = 'sr-only';
    region.style.cssText = 'position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;';
    document.body.appendChild(region);
  }

  return region;
};

/**
 * Announce to screen readers
 * WCAG 2.1 Level A: Status Messages (4.1.3)
 *
 * @param {string} message - The message to announce
 * @param {string} priority - 'polite' (default) or 'assertive'
 */
export const announce = (message, priority = 'polite') => {
  if (!message) return;

  const region = getLiveRegion(priority);

  // Clear and re-add to ensure announcement
  region.textContent = '';

  // Small delay ensures screen readers catch the update
  requestAnimationFrame(() => {
    region.textContent = message;
  });
};

/**
 * Hook for React components to announce status changes
 */
export const useAnnounce = () => {
  const announcePolite = useCallback((message) => {
    announce(message, 'polite');
  }, []);

  const announceAssertive = useCallback((message) => {
    announce(message, 'assertive');
  }, []);

  return { announcePolite, announceAssertive, announce };
};

/**
 * Keyboard navigation helper
 */
export const useKeyboardNav = (onEnter, onEscape) => {
  return (e) => {
    if (e.key === 'Enter' && onEnter) {
      e.preventDefault();
      onEnter();
    }
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      onEscape();
    }
  };
};

/**
 * Hook for managing roving tabindex navigation
 * Useful for lists, menus, and toolbars
 */
export const useRovingTabIndex = (itemCount, initialIndex = 0) => {
  const [focusedIndex, setFocusedIndex] = React.useState(initialIndex);

  const handleKeyDown = useCallback((e) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % itemCount);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + itemCount) % itemCount);
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(itemCount - 1);
        break;
      default:
        break;
    }
  }, [itemCount]);

  const getTabIndex = useCallback((index) => {
    return index === focusedIndex ? 0 : -1;
  }, [focusedIndex]);

  return {
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
    getTabIndex,
  };
};

/**
 * Hook to detect user's motion preference
 * WCAG 2.1 Level AAA: Animation from Interactions (2.3.3)
 */
export const usePrefersReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (e) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
};
