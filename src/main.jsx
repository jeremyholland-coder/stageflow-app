import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { MaintenanceMode } from './components/MaintenanceMode.jsx'
import { initSentry } from './lib/sentry'
import { initPerformanceMonitoring } from './lib/performance'
import { preloadCriticalChunks, preconnectAPIs } from './lib/preload-chunks'
import './index.css'
import './styles/glass.css'
import './styles/focus-states.css'

// Check for maintenance mode
const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE_MODE === 'true';

// CRITICAL: Initialize error monitoring FIRST (before any errors can occur)
initSentry();

// CRITICAL FIX #14: Defer error handler to prevent TDZ errors
if (typeof window !== 'undefined') {
  // Use setTimeout to defer until after module initialization
  setTimeout(() => {
    window.addEventListener('error', (event) => {
      if (event.error && event.error.message && event.error.message.includes('before initialization')) {
        console.error('🔴 INITIALIZATION ERROR CAUGHT:', {
          message: event.error.message,
          stack: event.error.stack,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        });

        // Show error to user
        if (document.body) {
          document.body.innerHTML = `
            <div style="padding: 40px; font-family: system-ui; max-width: 800px; margin: 0 auto;">
              <h1 style="color: #e11d48;">🔴 Initialization Error</h1>
              <p style="font-size: 16px; color: #666;">A module initialization error occurred. Please share this information:</p>
              <pre style="background: #f3f4f6; padding: 20px; border-radius: 8px; overflow: auto; font-size: 12px;">${event.error.message}\n\n${event.error.stack}</pre>
              <button onclick="location.reload()" style="margin-top: 20px; padding: 12px 24px; background: #1ABC9C; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px;">Reload Page</button>
            </div>
          `;
        }
        event.preventDefault();
      }
    });
  }, 0);
}

// Cache buster: This timestamp forces a new bundle hash on each build
// Changed to console.log for production (console.error should only be for actual errors)
console.log('[StageFlow] App starting - v1.7.46');

// NEXT-LEVEL: Initialize performance monitoring
initPerformanceMonitoring();

// SURGICAL FIX: Preconnect to external APIs to eliminate first-request latency
preconnectAPIs();

// CRITICAL FIX #14: Defer preloadCriticalChunks() to prevent TDZ errors
// It accesses document.readyState and adds event listeners
if (typeof window !== 'undefined') {
  setTimeout(() => {
    preloadCriticalChunks();
  }, 0);
}

// StrictMode ENABLED: React 18 best practice - helps catch bugs during development
// Double-renders in dev mode are intentional to catch side effects
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isMaintenanceMode ? <MaintenanceMode /> : <App />}
  </React.StrictMode>
)
