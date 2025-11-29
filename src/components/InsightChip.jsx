import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * InsightChip - Secondary Action Chip Component for Phase 5.1
 *
 * Subtle mint-outline chip buttons for secondary AI insights.
 * Auto-executes on click (no pre-fill + send flow).
 *
 * Design: Smaller, subtle mint outline, clean hover states
 */
export const InsightChip = ({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  loading = false,
  tooltip = '',
  className = ''
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title={tooltip}
      className={`
        group relative
        flex items-center gap-2
        px-4 py-2.5 rounded-xl
        bg-transparent
        border border-[#1ABC9C]/30
        hover:border-[#1ABC9C]/60 hover:bg-[#1ABC9C]/10
        text-white/80 hover:text-white
        text-sm font-medium
        transition-all duration-200 ease-out
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
    >
      {/* Icon */}
      {loading ? (
        <Loader2 className="w-4 h-4 text-[#1ABC9C] animate-spin" />
      ) : Icon ? (
        <Icon className="w-4 h-4 text-[#1ABC9C] group-hover:text-[#16A085] transition-colors" />
      ) : null}

      {/* Label */}
      <span className="whitespace-nowrap">{label}</span>

      {/* Subtle glow on hover */}
      <div className="absolute inset-0 rounded-xl bg-[#1ABC9C]/0 group-hover:bg-[#1ABC9C]/5 transition-colors pointer-events-none" />
    </button>
  );
};

export default InsightChip;
