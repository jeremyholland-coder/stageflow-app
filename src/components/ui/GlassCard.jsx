import React from 'react';

/**
 * GlassCard - Apple-inspired glass-like card component with backdrop blur.
 *
 * Used for consistent dark-theme card styling with:
 * - Rounded corners
 * - Subtle border
 * - Glass-like background with backdrop blur
 * - Soft shadow
 *
 * @param {string} title - Optional card title
 * @param {string} description - Optional description below title
 * @param {React.ReactNode} children - Card content
 * @param {string} className - Additional CSS classes
 */
export function GlassCard({
  title,
  description,
  children,
  className = '',
}) {
  return (
    <div
      className={
        'rounded-2xl border border-white/8 bg-white/5 ' +
        'backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.55)] ' +
        'px-5 py-4 sm:px-6 sm:py-5 ' +
        className
      }
    >
      {(title || description) && (
        <div className="mb-4 flex flex-col gap-1">
          {title && (
            <h3 className="text-sm font-semibold tracking-wide text-slate-50">
              {title}
            </h3>
          )}
          {description && (
            <p className="text-xs text-slate-400">{description}</p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

export default GlassCard;
