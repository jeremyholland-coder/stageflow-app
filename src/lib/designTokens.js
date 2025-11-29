/**
 * StageFlow 2.0 Design Tokens
 * Complete design system for consistent UI components
 */

export const colors = {
  // Primary Colors
  primary: {
    teal: '#1ABC9C',
    tealHover: '#16A085',
    tealLight: 'rgba(26, 188, 156, 0.1)',
    blue: '#3A86FF',
    blueHover: '#2E6FDB',
    blueLight: 'rgba(58, 134, 255, 0.1)',
  },
  
  // Background Colors
  background: {
    light: '#F9FAFB',
    dark: '#121212',
  },
  
  // Surface Colors
  surface: {
    light: '#E0E0E0',
    lightHover: '#D6D6D6',
    dark: '#0D1F2D',
    darkHover: '#1A2F3D',
  },
  
  // Text Colors
  text: {
    primaryLight: '#1A1A1A',
    primaryDark: '#E0E0E0',
    secondaryLight: '#61788A',
    secondaryDark: '#ABCAE2',
  },
  
  // Status Colors
  status: {
    success: '#27AE60',
    successLight: 'rgba(39, 174, 96, 0.1)',
    error: '#E74C3C',
    errorLight: 'rgba(231, 76, 60, 0.1)',
    warning: '#F39C12',
    warningLight: 'rgba(243, 156, 18, 0.1)',
  },
  
  // Border Colors
  border: {
    light: '#E5E7EB',
    dark: '#1F2A37',
  },
};

export const spacing = {
  // Page Layout
  pageMaxWidth: '1340px',
  pageGutter: '32px',
  sidebarWidth: '220px',
  
  // Widget Spacing
  widgetVerticalGap: '28px',
  widgetHorizontalGap: '24px',
  
  // Card Spacing
  cardPadding: {
    horizontal: '16px',
    vertical: '20px',
  },
  internalBlockGap: '12px',
  iconTextGap: '6px',
  
  // Button Spacing
  buttonRowGap: '12px',
  buttonVerticalStackGap: '18px',
  
  // Mobile
  mobileHorizontalMargin: '16px',
  mobileVerticalGap: '24px',
};

export const borderRadius = {
  kpiCard: '24px',
  pipelineCard: '18px',
  button: '20px',
  aiPanel: '20px',
  input: '8px',
  chip: '999px',
};

export const shadows = {
  kpiCard: '0 2px 8px rgba(26, 188, 156, 0.08)',
  kpiCardHover: '0 4px 16px rgba(26, 188, 156, 0.12)',
  pipelineCard: '0 2px 6px rgba(0, 0, 0, 0.04)',
  button: '0 2px 4px rgba(0, 0, 0, 0.1)',
  aiPanel: '0 6px 24px rgba(26, 188, 156, 0.14)',
};

export const typography = {
  // Font Families
  fontFamily: {
    heading: 'Inter, system-ui, sans-serif', // Geometric sans
    body: 'Inter, system-ui, sans-serif', // Humanist sans
  },
  
  // Font Sizes
  fontSize: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    md: '0.95rem',    // 15.2px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '2rem',    // 32px
    '4xl': '2.25rem', // 36px
  },
  
  // Font Weights
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
};

export const components = {
  kpiCard: {
    containerRadius: borderRadius.kpiCard,
    shadow: shadows.kpiCard,
    shadowHover: shadows.kpiCardHover,
    padding: `${spacing.cardPadding.vertical} ${spacing.cardPadding.horizontal}`,
    headlineSize: typography.fontSize['4xl'],
    subLabelSize: typography.fontSize.md,
    iconSize: '28px',
  },
  
  pipelineCard: {
    containerRadius: borderRadius.pipelineCard,
    shadow: shadows.pipelineCard,
    padding: '14px',
    stageNameSize: typography.fontSize.lg,
    chipSize: typography.fontSize.md,
  },
  
  button: {
    height: '42px',
    radius: borderRadius.button,
    iconSize: '22px',
    shadow: shadows.button,
  },
  
  aiPanel: {
    radius: borderRadius.aiPanel,
    shadow: shadows.aiPanel,
    padding: '22px',
    widgetSpacing: '18px',
    avatarSize: '32px',
  },
};

// Apple HIG-compliant animation system
export const animations = {
  durations: {
    instant: 0,           // Immediate feedback (0ms)
    fast: 150,            // Micro-interactions (150ms)
    normal: 250,          // Most transitions (250ms)
    slow: 350,            // Complex state changes (350ms)
    deliberate: 500,      // Major layout shifts (500ms)
  },
  easings: {
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',      // Apple standard easing
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',      // Deceleration curve
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',      // Acceleration curve
    sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',         // Sharp easing
  },
};

export const transitions = {
  default: `all ${animations.durations.fast}ms ${animations.easings.standard}`,
  fast: `all ${animations.durations.fast}ms ${animations.easings.standard}`,
  normal: `all ${animations.durations.normal}ms ${animations.easings.standard}`,
  slow: `all ${animations.durations.slow}ms ${animations.easings.decelerate}`,
};

export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  modal: 1030,
  popover: 1040,
  tooltip: 1050,
};

// Helper function to get color based on theme
export const getColor = (colorPath, isDark = false) => {
  const paths = colorPath.split('.');
  let value = colors;
  
  for (const path of paths) {
    value = value[path];
  }
  
  // Handle light/dark variants
  if (typeof value === 'object' && 'light' in value && 'dark' in value) {
    return isDark ? value.dark : value.light;
  }
  
  return value;
};

// Utility classes for Tailwind
export const tailwindUtilities = {
  primaryButton: 'bg-[#1ABC9C] hover:bg-[#16A085] text-white font-semibold rounded-[20px] px-4 py-2 transition-all duration-150 shadow-[0_2px_4px_rgba(0,0,0,0.1)]',
  secondaryButton: 'bg-white dark:bg-[#0D1F2D] hover:bg-gray-50 dark:hover:bg-[#1A2F3D] border border-[#E5E7EB] dark:border-[#1F2A37] text-[#1A1A1A] dark:text-[#E0E0E0] font-medium rounded-[20px] px-4 py-2 transition-all duration-150',
  kpiCard: 'bg-white dark:bg-[#0D1F2D] rounded-[24px] shadow-[0_2px_8px_rgba(26,188,156,0.08)] hover:shadow-[0_4px_16px_rgba(26,188,156,0.12)] p-5 transition-all duration-150 cursor-pointer',
  pipelineCard: 'bg-[rgba(250,250,251,0.95)] dark:bg-[rgba(16,32,45,0.9)] rounded-[18px] shadow-[0_2px_6px_rgba(0,0,0,0.04)] p-3.5 transition-all duration-150',
  input: 'w-full px-4 py-2 border border-[#E5E7EB] dark:border-[#1F2A37] rounded-lg focus:ring-2 focus:ring-[#1ABC9C] dark:bg-[#0D1F2D] dark:text-[#E0E0E0] transition-all duration-150',
};
