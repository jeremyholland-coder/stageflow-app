import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Enhanced Button Component with Micro-Interactions
 * 
 * Features:
 * - Smooth hover/active states
 * - Loading state with spinner
 * - Ripple effect on click
 * - Disabled state handling
 * - Multiple variants (primary, secondary, danger, ghost)
 */

const VARIANTS = {
  primary: 'bg-gradient-to-r from-[#1ABC9C] to-[#16A085] text-white hover:shadow-[0_8px_24px_rgba(26,188,156,0.3)] hover:scale-[1.02] active:scale-[0.98]',
  secondary: 'bg-white dark:bg-[#0D1F2D] text-[#1ABC9C] border-2 border-[#1ABC9C] hover:bg-[#1ABC9C]/10 hover:scale-[1.02] active:scale-[0.98]',
  danger: 'bg-gradient-to-r from-[#E74C3C] to-[#C0392B] text-white hover:shadow-[0_8px_24px_rgba(231,76,60,0.3)] hover:scale-[1.02] active:scale-[0.98]',
  ghost: 'bg-transparent text-[#6B7280] dark:text-[#9CA3AF] hover:bg-gray-100 dark:hover:bg-gray-800 hover:scale-[1.02] active:scale-[0.98]',
  success: 'bg-gradient-to-r from-[#27AE60] to-[#229954] text-white hover:shadow-[0_8px_24px_rgba(39,174,96,0.3)] hover:scale-[1.02] active:scale-[0.98]',
};

// MEDIUM FIX: Ensure minimum 44px touch targets (Apple HIG / WCAG standards)
const SIZES = {
  sm: 'px-3 py-2.5 text-sm min-h-[44px]',  // Increased py from 1.5 to 2.5, added min-h
  md: 'px-4 py-3 text-base min-h-[44px]',   // Increased py from 2 to 3, added min-h
  lg: 'px-6 py-3 text-lg min-h-[48px]',     // Already OK, standardized with min-h
};

export const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  size = 'md',
  loading = false,
  disabled = false,
  icon: Icon = null,
  className = '',
  type = 'button',
  ...props 
}) => {
  const isDisabled = disabled || loading;

  const baseClasses = 'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#1ABC9C]/50 focus:ring-offset-2 dark:focus:ring-offset-[#121212]';
  
  const variantClasses = VARIANTS[variant] || VARIANTS.primary;
  const sizeClasses = SIZES[size] || SIZES.md;
  const disabledClasses = isDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : '';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={`${baseClasses} ${variantClasses} ${sizeClasses} ${disabledClasses} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {!loading && Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
};

/**
 * Icon Button - Circular button for icons only
 */
export const IconButton = ({ 
  icon: Icon, 
  onClick, 
  variant = 'ghost', 
  size = 'md',
  loading = false,
  disabled = false,
  title = '',
  className = '',
  ...props 
}) => {
  const isDisabled = disabled || loading;

  // MEDIUM FIX: Ensure minimum 44px touch targets for icon buttons
  const sizeMap = {
    sm: 'w-11 h-11 p-2',  // Changed from 32px (8*4) to 44px (11*4)
    md: 'w-11 h-11 p-2',  // Changed from 40px (10*4) to 44px (11*4)
    lg: 'w-12 h-12 p-3',  // 48px - already OK
  };

  const baseClasses = 'inline-flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#1ABC9C]/50';
  
  const variantClasses = VARIANTS[variant] || VARIANTS.ghost;
  const sizeClasses = sizeMap[size] || sizeMap.md;
  const disabledClasses = isDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : '';

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      title={title}
      className={`${baseClasses} ${variantClasses} ${sizeClasses} ${disabledClasses} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
    </button>
  );
};

export default Button;
