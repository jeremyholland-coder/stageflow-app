import React from 'react';
import { Calendar, Loader2 } from 'lucide-react';

/**
 * PlanMyDayButton - Hero CTA Component for Phase 5.1
 *
 * The primary AI action button that generates a structured daily plan
 * with partnership-focused, momentum-driven insights.
 *
 * Design: Mint gradient, prominent, center-aligned, auto-executes on click
 */
export const PlanMyDayButton = ({
  onClick,
  disabled = false,
  loading = false,
  className = ''
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      aria-label="Plan my day - generate AI daily action plan"
      className={`
        relative group w-full max-w-md mx-auto
        flex items-center justify-center gap-3
        px-8 py-4 rounded-2xl
        bg-gradient-to-r from-[#1ABC9C] via-[#16A085] to-[#1ABC9C]
        hover:from-[#16A085] hover:via-[#1ABC9C] hover:to-[#16A085]
        text-white font-semibold text-lg
        shadow-lg shadow-[#1ABC9C]/30
        hover:shadow-xl hover:shadow-[#1ABC9C]/40
        transform hover:scale-[1.02] active:scale-[0.98]
        transition-all duration-300 ease-out
        disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none
        border border-[#1ABC9C]/50
        ${className}
      `}
    >
      {/* Animated background shimmer effect */}
      <div className="absolute inset-0 rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out" />
      </div>

      {/* Content */}
      <div className="relative flex items-center gap-3">
        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : (
          <Calendar className="w-6 h-6" />
        )}
        <span>{loading ? 'Planning Your Day...' : 'Plan My Day'}</span>
      </div>

      {/* Subtle pulse ring on hover */}
      <div className="absolute inset-0 rounded-2xl border-2 border-[#1ABC9C]/0 group-hover:border-[#1ABC9C]/30 group-hover:scale-105 transition-all duration-500 pointer-events-none" />
    </button>
  );
};

export default PlanMyDayButton;
