import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { getPortalRoot, Z_INDEX } from '../../lib/z-index';

/**
 * Portal Component
 *
 * Renders children into a DOM node outside the React component tree.
 * This is essential for dropdowns, popovers, and tooltips that need
 * to escape parent overflow:hidden and stacking contexts.
 *
 * Usage:
 * <Portal>
 *   <DropdownMenu style={{ zIndex: Z_INDEX.portalDropdown }} />
 * </Portal>
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Content to render in portal
 * @param {string} [props.containerId] - Optional custom container ID
 */
export function Portal({ children, containerId = 'sf-portal-root' }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) return null;

  const container = document.getElementById(containerId) || document.body;
  return createPortal(children, container);
}

/**
 * Calculate dropdown position based on trigger element
 * Ensures dropdown stays within viewport bounds
 *
 * @param {HTMLElement} triggerRef - Reference to trigger element
 * @param {Object} options - Positioning options
 * @param {string} [options.placement='bottom-start'] - Preferred placement
 * @param {number} [options.offset=4] - Gap between trigger and dropdown
 * @returns {{ top: number, left: number, placement: string }}
 */
export function calculateDropdownPosition(triggerRef, options = {}) {
  const {
    placement = 'bottom-start',
    offset = 4,
    dropdownWidth = 200,
    dropdownHeight = 300,
  } = options;

  if (!triggerRef) {
    return { top: 0, left: 0, placement };
  }

  const rect = triggerRef.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top, left;
  let finalPlacement = placement;

  // Calculate base position based on placement
  switch (placement) {
    case 'bottom-start':
      top = rect.bottom + offset;
      left = rect.left;
      break;
    case 'bottom-end':
      top = rect.bottom + offset;
      left = rect.right - dropdownWidth;
      break;
    case 'top-start':
      top = rect.top - dropdownHeight - offset;
      left = rect.left;
      break;
    case 'top-end':
      top = rect.top - dropdownHeight - offset;
      left = rect.right - dropdownWidth;
      break;
    case 'bottom':
      top = rect.bottom + offset;
      left = rect.left + (rect.width - dropdownWidth) / 2;
      break;
    case 'top':
      top = rect.top - dropdownHeight - offset;
      left = rect.left + (rect.width - dropdownWidth) / 2;
      break;
    default:
      top = rect.bottom + offset;
      left = rect.left;
  }

  // Viewport boundary checks
  // Check if dropdown would overflow right edge
  if (left + dropdownWidth > viewportWidth - 8) {
    left = viewportWidth - dropdownWidth - 8;
  }

  // Check if dropdown would overflow left edge
  if (left < 8) {
    left = 8;
  }

  // Check if dropdown would overflow bottom - flip to top
  if (top + dropdownHeight > viewportHeight - 8 && placement.startsWith('bottom')) {
    top = rect.top - dropdownHeight - offset;
    finalPlacement = placement.replace('bottom', 'top');
  }

  // Check if dropdown would overflow top - flip to bottom
  if (top < 8 && placement.startsWith('top')) {
    top = rect.bottom + offset;
    finalPlacement = placement.replace('top', 'bottom');
  }

  // Ensure top is never negative
  if (top < 8) {
    top = 8;
  }

  return { top, left, placement: finalPlacement };
}

export { Z_INDEX };
