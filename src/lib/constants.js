/**
 * Application Constants
 * Central location for all app-wide constants to improve maintainability
 */

// UI Constants
export const UI_CONSTANTS = {
  // Z-Index layers
  Z_INDEX: {
    MODAL: 50,
    NOTIFICATION: 50,
    NAVBAR: 40,
    DROPDOWN: 30,
    CARD_BASE: 10
  },
  
  // Animation durations (ms)
  ANIMATION: {
    FAST: 150,
    NORMAL: 300,
    SLOW: 500
  },
  
  // Debounce delays (ms)
  DEBOUNCE: {
    SEARCH: 300,
    INPUT: 500
  },
  
  // Notification duration (ms)
  NOTIFICATION_DURATION: 3000,
  
  // Session refresh interval (ms)
  SESSION_REFRESH_INTERVAL: 4 * 60 * 1000 // 4 minutes
};

// StageFlow 2.0 Brand Colors
export const BRAND_COLORS = {
  // Primary
  PRIMARY_TEAL: '#1ABC9C',
  PRIMARY_BLUE: '#3A86FF',
  
  // Background
  BG_LIGHT: '#F9FAFB',
  BG_DARK: '#121212',
  
  // Surface
  SURFACE_LIGHT: '#E0E0E0',
  SURFACE_DARK: '#0D1F2D',
  
  // Text
  TEXT_LIGHT_PRIMARY: '#1A1A1A',
  TEXT_LIGHT_SECONDARY: '#61788A',
  TEXT_DARK_PRIMARY: '#E0E0E0',
  TEXT_DARK_SECONDARY: '#ABCAE2',
  
  // Status
  SUCCESS: '#27AE60',
  ERROR: '#E74C3C',
  WARNING: '#F39C12',
  
  // Border
  BORDER_LIGHT: '#E5E7EB',
  BORDER_DARK: '#1F2A37'
};

// Stage Colors (matches KanbanBoard)
export const STAGE_COLORS = {
  lead: '#64748b',
  quote: '#2563eb',
  approval: '#4f46e5',
  invoice: '#7c3aed',
  onboarding: '#9333ea',
  delivery: '#c026d3',
  retention: '#16a34a',
  lost: '#dc2626'
};

// Breakpoints (for responsive design)
export const BREAKPOINTS = {
  SM: 640,
  MD: 768,
  LG: 1024,
  XL: 1280,
  '2XL': 1536
};

// Local storage keys
export const STORAGE_KEYS = {
  THEME: 'stageflow_theme',
  LAST_VIEW: 'stageflow_last_view',
  USER_PREFERENCES: 'stageflow_preferences'
};

// API Endpoints
export const API_ENDPOINTS = {
  SETUP_ORG: '/api/setup-organization',
  SEND_NOTIFICATION: '/.netlify/functions/send-notification'
};

// Validation Rules
export const VALIDATION = {
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE_REGEX: /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/,
  MIN_PASSWORD_LENGTH: 8,
  MAX_DEAL_VALUE: 999999999,
  MAX_NOTE_LENGTH: 5000
};

// Feature Flags
export const FEATURES = {
  AI_ASSISTANT: true,
  STAGE_ANALYTICS: true,
  BULK_OPERATIONS: false,
  ADVANCED_REPORTING: false,
  EXPORT_DATA: true
};
