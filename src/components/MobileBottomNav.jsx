import React from 'react';
import { BarChart3, Settings, Zap } from 'lucide-react';
import { useApp } from './AppShell';
import { VIEWS } from '../lib/supabase';

/**
 * Mobile Bottom Navigation Bar
 * Apple HIG compliant - thumb-friendly navigation for mobile devices
 * Appears < 768px breakpoint with safe-area-inset support
 */
export const MobileBottomNav = () => {
  const { activeView, setActiveView } = useApp();

  const navItems = [
    {
      id: 'dashboard',
      label: 'Pipeline',
      icon: BarChart3,
      view: VIEWS.DASHBOARD,
    },
    {
      id: 'integrations',
      label: 'Integrations',
      icon: Zap,
      view: VIEWS.INTEGRATIONS,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      view: VIEWS.SETTINGS,
    },
  ];

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-[#0D1F2D]/95 backdrop-blur-xl border-t border-gray-200 dark:border-gray-700 md:hidden z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="navigation"
      aria-label="Mobile primary navigation"
    >
      <div className="flex justify-around items-center h-16 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.view;
          
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.view)}
              className={`
                flex flex-col items-center justify-center gap-1 
                min-w-[64px] min-h-[52px] rounded-lg transition-all duration-200
                ${isActive 
                  ? 'text-[#1ABC9C]' 
                  : 'text-[#6B7280] dark:text-[#9CA3AF] active:scale-95'
                }
              `}
              aria-label={`Navigate to ${item.label}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon 
                className={`w-6 h-6 transition-transform duration-200 ${
                  isActive ? 'scale-110' : ''
                }`}
                aria-hidden="true"
              />
              <span className={`text-xs font-medium ${
                isActive ? 'font-semibold' : ''
              }`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
