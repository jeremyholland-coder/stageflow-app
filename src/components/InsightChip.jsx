import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * InsightChip - Secondary Action Chip Component for Phase 5.1
 *
 * Subtle mint-outline pill buttons for secondary AI insights.
 * Auto-executes on click (no pre-fill + send flow).
 *
 * FIX E2: Made smaller and more pill-like, less dominant than Plan My Day
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
        flex items-center gap-1.5
        px-3 py-1.5 rounded-full
        bg-transparent
        border border-[#1ABC9C]/20
        hover:border-[#1ABC9C]/50 hover:bg-[#1ABC9C]/5
        text-white/60 hover:text-white/90
        text-xs font-medium
        transition-all duration-200 ease-out
        disabled:opacity-40 disabled:cursor-not-allowed
        ${className}
      `}
    >
      {/* Icon - FIX E2: Smaller icons for pill buttons */}
      {loading ? (
        <Loader2 className="w-3 h-3 text-[#1ABC9C] animate-spin" />
      ) : Icon ? (
        <Icon className="w-3 h-3 text-[#1ABC9C]/70 group-hover:text-[#1ABC9C] transition-colors" />
      ) : null}

      {/* Label */}
      <span className="whitespace-nowrap">{label}</span>

      {/* Subtle glow on hover */}
      <div className="absolute inset-0 rounded-xl bg-[#1ABC9C]/0 group-hover:bg-[#1ABC9C]/5 transition-colors pointer-events-none" />
    </button>
  );
};

export default InsightChip;
