/**
 * Apple HIG Compliant Form Validation
 * Real-time inline validation with blur triggers and debouncing
 */

export const validationRules = {
  required: (value) => ({
    valid: value && String(value).trim().length > 0,
    message: 'This field is required'
  }),
  
  email: (value) => {
    if (!value) return { valid: true, message: '' };
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return {
      valid: emailRegex.test(value),
      message: 'Please enter a valid email address'
    };
  },
  
  phone: (value) => {
    if (!value) return { valid: true, message: '' };
    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    // FIX M14: Support international phone numbers (7-15 digits)
    const digitCount = value.replace(/\D/g, '').length;
    const hasValidLength = digitCount >= 7 && digitCount <= 15;
    return {
      valid: phoneRegex.test(value) && hasValidLength,
      message: 'Please enter a valid phone number (7-15 digits)'
    };
  },
  
  minValue: (value, min) => {
    const num = parseFloat(value);
    return {
      valid: !isNaN(num) && num >= min,
      message: `Must be at least ${min}`
    };
  },
  
  positiveNumber: (value) => {
    const num = parseFloat(value);
    return {
      valid: !isNaN(num) && num >= 0,
      message: 'Must be a positive number'
    };
  },

  // FIX M15: Min/max length validation
  minLength: (value, min) => {
    return {
      valid: !value || value.length >= min,
      message: `Must be at least ${min} characters`
    };
  },

  maxLength: (value, max) => {
    return {
      valid: !value || value.length <= max,
      message: `Must be no more than ${max} characters`
    };
  },

  maxValue: (value, max) => {
    const num = parseFloat(value);
    return {
      valid: !isNaN(num) && num <= max,
      message: `Must be no more than ${max}`
    };
  },

  // MEDIUM FIX: Strong password validation for security
  password: (value) => {
    if (!value) return { valid: true, message: '' };

    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(value);
    const hasLowerCase = /[a-z]/.test(value);
    const hasNumber = /\d/.test(value);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(value);
    const isLongEnough = value.length >= minLength;

    if (!isLongEnough) {
      return {
        valid: false,
        message: 'Password must be at least 8 characters long'
      };
    }

    const strengthCriteria = [hasUpperCase, hasLowerCase, hasNumber, hasSpecialChar];
    const metCriteria = strengthCriteria.filter(Boolean).length;

    // Require at least 3 out of 4 criteria for strong password
    if (metCriteria < 3) {
      const missing = [];
      if (!hasUpperCase) missing.push('uppercase letter');
      if (!hasLowerCase) missing.push('lowercase letter');
      if (!hasNumber) missing.push('number');
      if (!hasSpecialChar) missing.push('special character');

      return {
        valid: false,
        message: `Password must include at least 3 of: uppercase, lowercase, number, special character`
      };
    }

    return { valid: true, message: '' };
  },

  // MEDIUM FIX: Password confirmation matching
  passwordMatch: (value, passwordValue) => {
    return {
      valid: value === passwordValue,
      message: 'Passwords must match'
    };
  }
};

/**
 * Validates a single field with multiple rules
 * @param {*} value - Field value
 * @param {Array} rules - Array of {rule, params} objects
 * @returns {{valid: boolean, message: string}}
 */
export const validateField = (value, rules) => {
  for (const ruleConfig of rules) {
    const { rule, value: ruleValue } = ruleConfig;
    const result = validationRules[rule](value, ruleValue);
    if (!result.valid) {
      return result;
    }
  }
  return { valid: true, message: '' };
};

/**
 * Creates debounced validation handler (300ms delay)
 */
export const createDebouncedValidator = (callback, delay = 300) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), delay);
  };
};

/**
 * MEDIUM FIX: Get ARIA attributes for accessible form inputs
 * Usage: <input {...getAccessibleInputProps('email', emailError)} />
 * @param {string} fieldId - Unique field identifier
 * @param {string|null} error - Error message or null if valid
 * @returns {Object} ARIA attributes for input element
 */
export const getAccessibleInputProps = (fieldId, error) => ({
  'aria-invalid': error ? 'true' : 'false',
  'aria-describedby': error ? `${fieldId}-error` : undefined
});

/**
 * MEDIUM FIX: Get props for accessible error message
 * Usage: <p {...getAccessibleErrorProps('email')}>Error message</p>
 * @param {string} fieldId - Unique field identifier matching input
 * @returns {Object} Props for error message element
 */
export const getAccessibleErrorProps = (fieldId) => ({
  id: `${fieldId}-error`,
  role: 'alert'
});

/**
 * MEDIUM FIX: Calculate password strength for user feedback
 * Returns strength level and criteria met for visual indicators
 * @param {string} password - Password to analyze
 * @returns {{strength: string, score: number, criteria: object}}
 */
export const getPasswordStrength = (password) => {
  if (!password) {
    return {
      strength: 'none',
      score: 0,
      criteria: {
        length: false,
        uppercase: false,
        lowercase: false,
        number: false,
        special: false
      }
    };
  }

  const criteria = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
  };

  const metCriteria = Object.values(criteria).filter(Boolean).length;

  let strength = 'weak';
  let score = 0;

  if (metCriteria >= 5) {
    strength = 'strong';
    score = 100;
  } else if (metCriteria >= 3 && criteria.length) {
    strength = 'medium';
    score = 60;
  } else {
    strength = 'weak';
    score = metCriteria * 20;
  }

  return { strength, score, criteria };
};
