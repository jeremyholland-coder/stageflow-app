import React from 'react';

export const Logo = ({
  size = 'md',
  className = '',
  showText = false,
  showTagline = false
}) => {
  const sizes = {
    xs: { width: 24, height: 24, textClass: 'text-sm', taglineClass: 'text-[8px]' },
    sm: { width: 32, height: 32, textClass: 'text-base', taglineClass: 'text-[10px]' },
    md: { width: 40, height: 40, textClass: 'text-lg', taglineClass: 'text-xs' },
    lg: { width: 56, height: 56, textClass: 'text-2xl', taglineClass: 'text-sm' },
    xl: { width: 80, height: 80, textClass: 'text-3xl', taglineClass: 'text-base' }
  };

  const { width, height, textClass, taglineClass } = sizes[size] || sizes.md;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img
        src="/apple-touch-icon.png?v=12"
        alt="StageFlow Logo"
        width={width}
        height={height}
        className="flex-shrink-0 object-contain"
        style={{
          imageRendering: 'crisp-edges',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          perspective: 1000,
          filter: 'contrast(1.05) saturate(1.1)'
        }}
      />
      {showText && (
        <div className="flex flex-col">
          <span className={`font-bold bg-gradient-to-r from-[#55e4c3] to-[#25a9ab] bg-clip-text text-transparent ${textClass} leading-tight`}>
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

export const LogoWithBackground = ({ 
  size = 'md',
  className = '',
  showTagline = false 
}) => {
  const sizes = {
    xs: { width: 24, height: 24 },
    sm: { width: 32, height: 32 },
    md: { width: 40, height: 40 },
    lg: { width: 56, height: 56 },
    xl: { width: 80, height: 80 }
  };

  const { width, height } = sizes[size] || sizes.md;

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className={`bg-white dark:bg-[#0D1F2D] rounded-lg p-2 flex items-center justify-center ${className}`}>
        <img
          src="/apple-touch-icon.png?v=12"
          alt="StageFlow Logo"
          width={width}
          height={height}
          className="object-contain"
          style={{
            imageRendering: 'crisp-edges',
            WebkitFontSmoothing: 'antialiased',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            filter: 'contrast(1.05) saturate(1.1)'
          }}
        />
      </div>
      {showTagline && (
        <span className="text-xs text-gray-400 font-medium tracking-wide uppercase">
          Revenue Operations Platform
        </span>
      )}
    </div>
  );
};
