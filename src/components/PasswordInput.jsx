import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Password Input with Visibility Toggle
 *
 * Apple-level UX component for password entry with show/hide functionality.
 * Addresses HIGH-UX-1 from QA audit.
 *
 * Features:
 * - Toggle password visibility with eye icon
 * - Accessible with ARIA labels
 * - Matches StageFlow's design system
 * - Touch-friendly targets (44x44pt minimum)
 */
export const PasswordInput = ({
  id,
  value,
  onChange,
  placeholder = "Enter password",
  disabled = false,
  autoFocus = false,
  className = "",
  label,
  error,
  ...props
}) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-white mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className={`w-full pr-12 pl-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition ${className}`}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 min-w-touch min-h-touch flex items-center justify-center text-gray-300 hover:text-white transition rounded-lg"
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          disabled={disabled}
          tabIndex={0}
        >
          {showPassword ? (
            <EyeOff className="w-5 h-5" />
          ) : (
            <Eye className="w-5 h-5" />
          )}
        </button>
      </div>
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1 text-sm text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
};

/**
 * Password Requirements Checklist
 *
 * Apple-level UX component showing password requirements with real-time validation.
 * Addresses HIGH-UX-2 from QA audit.
 *
 * Features:
 * - Always visible (not just on error)
 * - Real-time validation feedback
 * - Green checkmarks for met requirements
 * - Clear, friendly language
 */
export const PasswordRequirements = ({ password = '' }) => {
  const requirements = [
    {
      label: 'At least 8 characters',
      met: password.length >= 8
    },
    {
      label: 'One uppercase letter (A-Z)',
      met: /[A-Z]/.test(password)
    },
    {
      label: 'One lowercase letter (a-z)',
      met: /[a-z]/.test(password)
    },
    {
      label: 'One number (0-9)',
      met: /[0-9]/.test(password)
    },
    {
      label: 'One special character (!@#$%^&*)',
      met: /[^A-Za-z0-9]/.test(password)
    }
  ];

  const allMet = requirements.every(req => req.met);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-white">Password must contain:</p>
      <ul className="space-y-1.5">
        {requirements.map((req, index) => (
          <li
            key={index}
            className={`text-sm flex items-center gap-2 transition-colors ${
              req.met ? 'text-emerald-400' : 'text-gray-300'
            }`}
          >
            <span
              className={`inline-flex items-center justify-center w-4 h-4 rounded-full border-2 transition-colors ${
                req.met
                  ? 'border-emerald-400 bg-emerald-400/20'
                  : 'border-gray-500'
              }`}
            >
              {req.met && (
                <svg
                  className="w-3 h-3 text-emerald-400"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 13l4 4L19 7"></path>
                </svg>
              )}
            </span>
            {req.label}
          </li>
        ))}
      </ul>
      {allMet && password.length > 0 && (
        <p className="text-sm text-emerald-400 font-medium mt-3 flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          Strong password!
        </p>
      )}
    </div>
  );
};
