/**
 * Apple-Quality Logo Component
 * Handles responsive sizing with zero distortion
 */

export const Logo = ({ 
  size = 'md',
  showText = true,
  showTagline = false,
  className = ''
}) => {
  // Size configurations (maintains aspect ratio)
  const sizes = {
    xs: { width: 24, height: 24, textClass: 'text-sm', taglineClass: 'text-[8px]' },
    sm: { width: 32, height: 32, textClass: 'text-base', taglineClass: 'text-[10px]' },
    md: { width: 40, height: 40, textClass: 'text-lg', taglineClass: 'text-xs' },
    lg: { width: 56, height: 56, textClass: 'text-2xl', taglineClass: 'text-sm' },
    xl: { width: 80, height: 80, textClass: 'text-3xl', taglineClass: 'text-base' },
    '2xl': { width: 120, height: 120, textClass: 'text-4xl', taglineClass: 'text-lg' }
  };

  const { width, height, textClass, taglineClass } = sizes[size] || sizes.md;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img
        src="/apple-touch-icon.png?v=12"
        alt="StageFlow Logo"
        width={width}
        height={height}
        className="flex-shrink-0"
        style={{
          // Apple-quality rendering
          imageRendering: 'crisp-edges',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          // Prevent distortion
          objectFit: 'contain',
          // Sharp edges on retina displays
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          perspective: 1000,
          filter: 'contrast(1.05) saturate(1.1)'
        }}
      />
      {showText && (
        <div className="flex flex-col">
          <span className={`font-bold ${textClass} leading-tight bg-gradient-to-r from-[#1ABC9C] to-[#16A085] bg-clip-text text-transparent`}>
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

export const LogoIcon = ({ 
  size = 'md',
  className = '',
  withBackground = false 
}) => {
  const sizes = {
    xs: 24,
    sm: 32,
    md: 40,
    lg: 56,
    xl: 80,
    '2xl': 120
  };

  const dimension = sizes[size] || sizes.md;

  const logoElement = (
    <img
      src="/apple-touch-icon.png?v=12"
      alt="StageFlow"
      width={dimension}
      height={dimension}
      className="object-contain"
      style={{
        imageRendering: 'crisp-edges',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        filter: 'contrast(1.05) saturate(1.1)'
      }}
    />
  );

  if (withBackground) {
    return (
      <div className={`bg-white dark:bg-[#0D1F2D] rounded-xl p-3 inline-flex items-center justify-center shadow-sm ${className}`}>
        {logoElement}
      </div>
    );
  }

  return <div className={className}>{logoElement}</div>;
};

export default Logo;
