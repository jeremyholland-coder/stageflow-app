/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // RESPONSIVE BREAKPOINTS - Webflow-inspired comprehensive device coverage
      screens: {
        'xs': '480px',   // Mobile landscape
        'sm': '640px',   // Small tablets
        'md': '768px',   // Tablets portrait
        'lg': '1024px',  // Tablets landscape / small desktop
        'xl': '1280px',  // Desktop
        '2xl': '1536px', // Large desktop
        '3xl': '1920px', // Full HD / Ultra-wide
        '4xl': '2560px', // 2K / 4K displays
      },
      // DESIGN TOKEN SYSTEM - StageFlow Brand
      colors: {
        // Primary Brand Colors (Teal/Emerald)
        brand: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#1ABC9C', // Primary brand color
          600: '#16A085', // Primary hover
          700: '#0F766E',
          800: '#115E59',
          900: '#134E4A',
        },
        // Neutral palette (keeping existing slate but adding semantic names)
        surface: {
          DEFAULT: '#FFFFFF',
          dark: '#0D1F2D',
          card: '#FFFFFF',
          'card-dark': '#1A2B3A',
        },
        text: {
          primary: '#1A1A1A',
          'primary-dark': '#E0E0E0',
          secondary: '#6B7280',
          'secondary-dark': '#9CA3AF',
          tertiary: '#9CA3AF',
          'tertiary-dark': '#6B7280',
        }
      },
      spacing: {
        // Consistent spacing tokens
        'card': '1.5rem', // 24px - standard card padding
        'card-sm': '1rem', // 16px - compact card padding
        'section': '1.5rem', // 24px - section spacing
        'touch': '2.75rem', // 44px - minimum touch target
      },
      borderRadius: {
        'card': '0.75rem', // 12px - standard card radius
        'button': '0.5rem', // 8px - button radius
        'modal': '1rem', // 16px - modal radius
      },
      fontSize: {
        // Apple HIG Typography Scale
        'large-title': ['2rem', { lineHeight: '2.5rem', fontWeight: '700' }], // 32px
        'title-1': ['1.75rem', { lineHeight: '2.25rem', fontWeight: '700' }], // 28px
        'title-2': ['1.5rem', { lineHeight: '2rem', fontWeight: '600' }], // 24px
        'title-3': ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }], // 20px
        'headline': ['1.0625rem', { lineHeight: '1.5rem', fontWeight: '600' }], // 17px
        'body': ['1.0625rem', { lineHeight: '1.5rem', fontWeight: '400' }], // 17px
        'callout': ['1rem', { lineHeight: '1.5rem', fontWeight: '400' }], // 16px
        'subheadline': ['0.9375rem', { lineHeight: '1.25rem', fontWeight: '400' }], // 15px
        'footnote': ['0.8125rem', { lineHeight: '1.125rem', fontWeight: '400' }], // 13px
        'caption-1': ['0.75rem', { lineHeight: '1rem', fontWeight: '400' }], // 12px
        'caption-2': ['0.6875rem', { lineHeight: '0.875rem', fontWeight: '400' }], // 11px
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'card-hover': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        'modal': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
      },
      minHeight: {
        'touch': '2.75rem', // 44px minimum touch target
      },
      minWidth: {
        'touch': '2.75rem', // 44px minimum touch target
      },
      transitionDuration: {
        'fast': '150ms',
        'normal': '250ms',
        'slow': '350ms',
      }
    },
  },
  // LOW FIX: Safelist moved to root level for proper CSS purging
  // Protects dynamic classes from being purged during build
  safelist: [
    'bg-emerald-100',
    'bg-emerald-900/20',
    'bg-red-100',
    'bg-red-900/20',
    'bg-amber-100',
    'bg-amber-900/20',
    'text-emerald-700',
    'text-red-700',
    'text-amber-700',
  ],
  plugins: [],
}
