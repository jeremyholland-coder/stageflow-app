import { useEffect, useCallback } from 'react';

/**
 * Apple HIG Keyboard Shortcuts Hook
 * Implements keyboard shortcuts following macOS conventions
 * 
 * Common patterns:
 * ⌘ + N: New item
 * ⌘ + K: Command palette/search
 * ⌘ + /: Show shortcuts
 * ESC: Close/dismiss
 * ⌘ + S: Save
 * ⌘ + Enter: Submit
 */

const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modKey = isMac ? 'metaKey' : 'ctrlKey';

export const useKeyboardShortcuts = (shortcuts) => {
  const handleKeyDown = useCallback((event) => {
    const { key, metaKey, ctrlKey, altKey, shiftKey } = event;
    
    // Check each shortcut
    for (const shortcut of shortcuts) {
      const {
        key: shortcutKey,
        cmd = false,
        ctrl = false,
        alt = false,
        shift = false,
        callback,
        preventDefault = true,
      } = shortcut;
      
      // Match key (case insensitive)
      const keyMatch = key.toLowerCase() === shortcutKey.toLowerCase();
      
      // Match modifiers
      const cmdMatch = cmd ? (isMac ? metaKey : ctrlKey) : !metaKey && !ctrlKey;
      const altMatch = alt === altKey;
      const shiftMatch = shift === shiftKey;
      
      if (keyMatch && cmdMatch && altMatch && shiftMatch) {
        if (preventDefault) {
          event.preventDefault();
        }
        callback(event);
        break;
      }
    }
  }, [shortcuts]);
  
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
};

/**
 * Global keyboard shortcuts
 * These work anywhere in the app
 */
export const useGlobalShortcuts = (actions) => {
  const shortcuts = [
    // ⌘ + N: New deal
    {
      key: 'n',
      cmd: true,
      callback: () => actions.onNewDeal?.(),
    },
    // ⌘ + K: Command palette (search)
    {
      key: 'k',
      cmd: true,
      callback: () => actions.onSearch?.(),
    },
    // ⌘ + /: Show keyboard shortcuts
    {
      key: '/',
      cmd: true,
      callback: () => actions.onShowShortcuts?.(),
    },
    // ESC: Close modal/dialog
    {
      key: 'Escape',
      callback: () => actions.onEscape?.(),
    },
  ];
  
  useKeyboardShortcuts(shortcuts.filter(s => s.callback));
};

/**
 * Modal-specific shortcuts
 */
export const useModalShortcuts = (actions) => {
  const shortcuts = [
    // ESC: Close modal
    {
      key: 'Escape',
      callback: () => actions.onClose?.(),
    },
    // ⌘ + Enter: Submit form
    {
      key: 'Enter',
      cmd: true,
      callback: () => actions.onSubmit?.(),
    },
  ];
  
  useKeyboardShortcuts(shortcuts.filter(s => s.callback));
};

/**
 * Keyboard shortcut display component
 */
export const KeyboardShortcut = ({ keys, className = '' }) => {
  const formatKey = (key) => {
    const keyMap = {
      cmd: isMac ? '⌘' : 'Ctrl',
      ctrl: 'Ctrl',
      alt: isMac ? '⌥' : 'Alt',
      shift: '⇧',
      enter: '↵',
      escape: 'Esc',
      backspace: '⌫',
      delete: 'Del',
      up: '↑',
      down: '↓',
      left: '←',
      right: '→',
    };
    
    return keyMap[key.toLowerCase()] || key.toUpperCase();
  };
  
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {keys.map((key, idx) => (
        <kbd
          key={idx}
          className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
        >
          {formatKey(key)}
        </kbd>
      ))}
    </span>
  );
};

/**
 * Keyboard shortcuts help panel
 */
export const KeyboardShortcutsPanel = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (isOpen) {
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);
  
  if (!isOpen) return null;
  
  const shortcuts = [
    { keys: ['cmd', 'N'], description: 'Create new deal' },
    { keys: ['cmd', 'K'], description: 'Focus search' },
    { keys: ['cmd', '/'], description: 'Show keyboard shortcuts' },
    { keys: ['Escape'], description: 'Close dialog' },
    { keys: ['cmd', 'Enter'], description: 'Submit form' },
    { keys: ['cmd', 'S'], description: 'Save changes' },
  ];
  
  return (
    <div
      className="fixed inset-0 modal-backdrop-apple z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#0D1F2D] rounded-xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            aria-label="Close keyboard shortcuts"
          >
            <span className="text-2xl">×</span>
          </button>
        </div>
        <div className="space-y-3">
          {shortcuts.map((shortcut, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
            >
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {shortcut.description}
              </span>
              <KeyboardShortcut keys={shortcut.keys} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
