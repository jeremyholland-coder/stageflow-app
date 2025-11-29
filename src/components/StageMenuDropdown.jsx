import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, EyeOff, ArrowUpDown, ArrowLeft, ArrowRight } from 'lucide-react';

/**
 * Dropdown menu for stage column actions
 * Appears on each Kanban column header
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
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  // CIRCULAR DEP FIX: Use ref to track isOpen state without including in deps
  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isOpenRef.current && dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []); // FIXED: Empty deps - listener always active, checks ref for current state

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
    <div className="relative" ref={dropdownRef}>
      <button
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

      {isOpen && (
        <div
          className={`absolute right-0 mt-2 w-48 rounded-lg shadow-lg border z-50 ${
            isDarkMode
              ? 'bg-slate-800 border-slate-700'
              : 'bg-white border-gray-200'
          }`}
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
      )}
    </div>
  );
};
