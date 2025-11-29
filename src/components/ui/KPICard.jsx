import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

/**
 * KPI Card Widget Component
 *
 * Beautiful, reusable metric card following StageFlow design system
 * Spec: 24px radius, subtle shadow, hover elevation
 */
export const KPICard = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  color = 'teal',
  onClick,
  className = '',
  isDarkMode = false
}) => {
  const isClickable = !!onClick;

  // Color variants
  const colorClasses = {
    teal: 'text-[#1ABC9C]',
    blue: 'text-[#3A86FF]',
    green: 'text-[#27AE60]',
    amber: 'text-[#F39C12]',
    red: 'text-[#E74C3C]'
  };

  const iconBgClasses = {
    teal: 'bg-[#1ABC9C]/10',
    blue: 'bg-[#3A86FF]/10',
    green: 'bg-[#27AE60]/10',
    amber: 'bg-[#F39C12]/10',
    red: 'bg-[#E74C3C]/10'
  };

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      className={`
        relative
        rounded-3xl
        px-4 py-5
        transition-all duration-200 ease-out
        ${isDarkMode
          ? 'bg-[#0D1F2D] border-[#1F2A37]'
          : 'bg-white border-[#E5E7EB]'
        }
        border
        shadow-[0_2px_8px_rgba(26,188,156,0.08)]
        ${isClickable
          ? 'cursor-pointer hover:shadow-[0_8px_24px_rgba(26,188,156,0.16)] hover:scale-[1.02] hover:border-[#1ABC9C]/50'
          : ''
        }
        ${className}
      `}
    >
      <div className="flex items-start justify-between">
        {/* Left: Value & Label */}
        <div className="flex-1 min-w-0">
          {/* Headline Value */}
          <div className={`
            text-4xl font-bold mb-1
            ${colorClasses[color]}
          `}>
            {value}
          </div>

          {/* Title */}
          <h3 className={`
            text-sm font-medium mb-1
            ${isDarkMode ? 'text-[#ABCAE2]' : 'text-[#61788A]'}
          `}>
            {title}
          </h3>

          {/* Subtitle/Helper */}
          {subtitle && (
            <p className={`
              text-xs
              ${isDarkMode ? 'text-[#ABCAE2]/70' : 'text-[#61788A]/70'}
            `}>
              {subtitle}
            </p>
          )}

          {/* Trend Indicator */}
          {trend && trendValue && (
            <div className={`
              flex items-center gap-1 mt-2
              text-xs font-semibold
              ${trend === 'up' ? 'text-[#27AE60]' : 'text-[#E74C3C]'}
            `}>
              {trend === 'up' ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>{trendValue}</span>
            </div>
          )}
        </div>

        {/* Right: Icon */}
        {Icon && (
          <div className={`
            flex-shrink-0
            w-14 h-14
            rounded-2xl
            flex items-center justify-center
            ${iconBgClasses[color]}
          `}>
            <Icon className={`w-7 h-7 ${colorClasses[color]}`} />
          </div>
        )}
      </div>
    </div>
  );
};

export default KPICard;
