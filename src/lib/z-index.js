/**
 * Global Z-Index Standards for StageFlow
 *
 * This file defines a consistent z-index hierarchy to prevent
 * dropdowns, popovers, tooltips, and modals from being clipped
 * or rendered behind other UI elements.
 *
 * IMPORTANT: All dropdown/popover components MUST use these values
 * when rendered via Portal to ensure consistent layering.
 *
 * Hierarchy (lowest to highest):
 * - Base UI: 0-10
 * - Sticky headers: 10-20
 * - Floating elements (tooltips, dropdowns): 9000-9100
 * - Modals/Dialogs: 9500
 * - Modal overlays: 9600
 * - Critical notifications: 9900
 * - Portaled dropdowns: 9999 (always on top)
 */

export const Z_INDEX = {
  // Base layers
  base: 0,
  header: 10,
  stickyHeader: 20,

  // Floating elements (non-portaled)
  dropdown: 50,
  tooltip: 60,

  // Portaled elements (escape stacking contexts)
  portalDropdown: 9999,
  portalTooltip: 9998,
  portalPopover: 9997,

  // Modals
  modalBackdrop: 9500,
  modal: 9600,

  // Critical UI
  notification: 9900,
  criticalOverlay: 10000,
};

/**
 * Get the portal root element
 * Falls back to document.body if sf-portal-root doesn't exist
 */
export function getPortalRoot() {
  return document.getElementById('sf-portal-root') || document.body;
}
