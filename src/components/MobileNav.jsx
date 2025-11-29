import React from 'react';
import { BarChart3, Puzzle, Settings, Users } from 'lucide-react';
import { VIEWS } from '../lib/supabase';

export const MobileNav = ({ activeView, setActiveView }) => {
  const navItems = [
    { id: VIEWS.DASHBOARD, label: 'Dashboard', icon: BarChart3 },
    { id: VIEWS.INTEGRATIONS, label: 'Integrations', icon: Puzzle },
    { id: VIEWS.TEAM, label: 'Team', icon: Users },
    { id: VIEWS.SETTINGS, label: 'Settings', icon: Settings },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 bg-gradient-to-t from-gray-900 to-black border-t border-teal-500/30 z-50 backdrop-blur-md"
      role="navigation"
      aria-label="Mobile navigation"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex justify-around py-2">
        {navItems.map(item => {
          const isActive = activeView === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={`flex flex-col items-center gap-1 min-w-touch min-h-touch px-4 py-2 rounded-lg transition-all ${
                isActive
                  ? 'text-teal-400 bg-teal-500/10'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              }`}
              aria-label={`Navigate to ${item.label}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="w-6 h-6" aria-hidden="true" />
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
