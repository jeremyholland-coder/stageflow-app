import React from 'react';

/**
 * StageFlow Logo - High Definition SVG Component
 *
 * This is the master logo component with the actual StageFlow "S" with arrows design.
 * Use this component everywhere the logo appears for consistency and high quality.
 *
 * Features:
 * - Vector SVG for perfect scaling at any size
 * - Optimized for retina displays
 * - Supports light and dark modes
 * - Multiple size presets
 * - Optional text label
 * - Optional background container
 */

export const StageFlowLogoSVG = ({
  size = 'md',
  className = '',
  style = {}
}) => {
  const sizes = {
    xs: 24,
    sm: 32,
    md: 40,
    lg: 56,
    xl: 80,
    '2xl': 120,
    '3xl': 160
  };

  const dimension = sizes[size] || sizes.md;

  return (
    <img
      src="/apple-touch-icon.png?v=12"
      alt="StageFlow Logo"
      width={dimension}
      height={dimension}
      className={className}
      style={{
        ...style,
        imageRendering: 'crisp-edges',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        objectFit: 'contain',
        filter: 'contrast(1.05) saturate(1.1)'
      }}
    />
  );
};

export const StageFlowLogo = ({
  size = 'md',
  showText = true,
  showTagline = false,
  className = ''
}) => {
  const textSizes = {
    xs: { textClass: 'text-sm', taglineClass: 'text-[8px]' },
    sm: { textClass: 'text-base', taglineClass: 'text-[10px]' },
    md: { textClass: 'text-lg', taglineClass: 'text-xs' },
    lg: { textClass: 'text-2xl', taglineClass: 'text-sm' },
    xl: { textClass: 'text-3xl', taglineClass: 'text-base' },
    '2xl': { textClass: 'text-4xl', taglineClass: 'text-lg' },
    '3xl': { textClass: 'text-5xl', taglineClass: 'text-xl' }
  };

  const { textClass, taglineClass } = textSizes[size] || textSizes.md;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <StageFlowLogoSVG size={size} />
      {showText && (
        <div className="flex flex-col">
          <span className={`font-bold ${textClass} leading-tight bg-gradient-to-r from-[#1ABC9C] to-[#16A085] dark:from-[#55e4c3] dark:to-[#25a9ab] bg-clip-text text-transparent`}>
            StageFlow
          </span>
          {showTagline && (
            <span className={`${taglineClass} text-[#6B7280] dark:text-[#9CA3AF] font-medium tracking-wide uppercase`}>
              Revenue Operations Platform
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export const StageFlowLogoWithBackground = ({
  size = 'md',
  className = '',
  showTagline = false
}) => {
  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className={`bg-white dark:bg-[#0D1F2D] rounded-xl p-3 flex items-center justify-center shadow-sm ${className}`}>
        <StageFlowLogoSVG size={size} />
      </div>
      {showTagline && (
        <span className="text-xs text-gray-400 font-medium tracking-wide uppercase">
          Revenue Operations Platform
        </span>
      )}
    </div>
  );
};

// Email-safe inline SVG (for email templates)
export const getStageFlowLogoSVGString = (size = 80) => {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1ABC9C;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#16A085;stop-opacity:1" />
        </linearGradient>
      </defs>
      <path d="M 300 250 Q 200 250 200 350 Q 200 450 350 500 Q 500 550 600 600 Q 700 650 750 750 Q 800 850 700 900 L 650 850 Q 700 800 650 750 Q 600 700 500 650 Q 400 600 350 550 Q 250 500 250 400 Q 250 300 350 300 Z"
            fill="url(#logoGradient)"
            opacity="0.9"/>
      <path d="M 650 200 L 750 280 L 650 360 L 680 280 Z"
            fill="url(#logoGradient)"/>
      <path d="M 350 780 L 250 700 L 350 620 L 320 700 Z"
            fill="url(#logoGradient)"/>
      <path d="M 400 350 Q 450 400 500 450 Q 550 500 600 550"
            stroke="#1ABC9C"
            stroke-width="20"
            stroke-linecap="round"
            fill="none"
            opacity="0.6"/>
    </svg>
  `.trim();
};

export default StageFlowLogo;
