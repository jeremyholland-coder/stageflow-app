import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, EyeOff, ArrowUpDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { Portal, calculateDropdownPosition, Z_INDEX } from './ui/Portal';

/**
 * Dropdown menu for stage column actions
 * Appears on each Kanban column header
 *
 * PORTAL FIX 2025-12-06: Dropdown now renders via Portal to escape
 * parent overflow:hidden and stacking contexts in Kanban columns.
 */
export const StageMenuDropdown = ({
  stageName,
  onHideStage,
  onReorderStages,
  onMoveLeft,
  onMoveRight,
  canMoveLeft = true,
  canMoveRight = true,
  showReorderOption = false,
  isDarkMode = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);

  // PORTAL FIX: Track dropdown position
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  // Close dropdown when clicking outside (handles portal-rendered dropdown)
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Check if click is on trigger button
      if (triggerRef.current && triggerRef.current.contains(event.target)) {
        return;
      }
      // Check if click is inside the portal dropdown
      if (event.target.closest('[data-stage-menu-dropdown]')) {
        return;
      }
      setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // PORTAL FIX: Recalculate position on scroll/resize when open
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const updatePosition = () => {
      const pos = calculateDropdownPosition(triggerRef.current, {
        placement: 'bottom-end',
        offset: 8,
        dropdownWidth: 192, // w-48 = 192px
        dropdownHeight: 200,
      });
      setDropdownPosition(pos);
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen]);

  const handleHideClick = () => {
    setIsOpen(false);
    onHideStage();
  };

  const handleReorderClick = () => {
    setIsOpen(false);
    onReorderStages?.();
  };

  const handleMoveLeftClick = () => {
    setIsOpen(false);
    onMoveLeft?.();
  };

  const handleMoveRightClick = () => {
    setIsOpen(false);
    onMoveRight?.();
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
          isDarkMode
            ? 'hover:bg-slate-700 text-slate-400 hover:text-slate-200'
            : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700'
        } ${isOpen ? (isDarkMode ? 'bg-slate-700' : 'bg-slate-100') : ''}`}
        title="Stage options"
        aria-label="Stage options"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {/* PORTAL FIX: Render dropdown via Portal to escape stacking contexts */}
      {isOpen && (
        <Portal>
          <div
            data-stage-menu-dropdown
            className={`fixed w-48 rounded-lg shadow-2xl border ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700'
                : 'bg-white border-gray-200'
            }`}
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              zIndex: Z_INDEX.portalDropdown,
            }}
          >
            <div className="py-1">
              {/* Move Left */}
              {canMoveLeft && onMoveLeft && (
                <button
                  onClick={handleMoveLeftClick}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                    isDarkMode
                      ? 'hover:bg-slate-700 text-slate-200'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <ArrowLeft className="w-4 h-4" />
                  Move Left
                </button>
              )}

              {/* Move Right */}
              {canMoveRight && onMoveRight && (
                <button
                  onClick={handleMoveRightClick}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                    isDarkMode
                      ? 'hover:bg-slate-700 text-slate-200'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <ArrowRight className="w-4 h-4" />
                  Move Right
                </button>
              )}

              {/* Divider if we have move options */}
              {((canMoveLeft && onMoveLeft) || (canMoveRight && onMoveRight)) && (
                <div className={`h-px my-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`} />
              )}

              {/* Reorder Stages - only show on first column */}
              {showReorderOption && onReorderStages && (
                <>
                  <button
                    onClick={handleReorderClick}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                      isDarkMode
                        ? 'hover:bg-slate-700 text-slate-200'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    <ArrowUpDown className="w-4 h-4" />
                    Reorder All Stages
                  </button>
                  <div className={`h-px my-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`} />
                </>
              )}

              {/* Hide Stage */}
              <button
                onClick={handleHideClick}
                className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                  isDarkMode
                    ? 'hover:bg-slate-700 text-slate-200'
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                <EyeOff className="w-4 h-4" />
                Hide "{stageName}"
              </button>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
};
