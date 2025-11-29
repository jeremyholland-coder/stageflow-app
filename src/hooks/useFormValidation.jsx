/**
 * Apple HIG Form Validation Hook
 * Manages validation state with blur triggers and real-time feedback
 */
import { useState, useCallback, useRef } from 'react';
import { validateField, createDebouncedValidator } from '../lib/formValidation';

export const useFormValidation = (fieldConfigs) => {
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const debouncedValidators = useRef({});

  // Initialize debounced validators for each field
  Object.keys(fieldConfigs).forEach(fieldName => {
    if (!debouncedValidators.current[fieldName]) {
      debouncedValidators.current[fieldName] = createDebouncedValidator((value) => {
        const config = fieldConfigs[fieldName];
        const result = validateField(value, config.rules || []);
        
        setErrors(prev => ({
          ...prev,
          [fieldName]: result.valid ? null : result.message
        }));
      });
    }
  });

  // Handle blur event - immediate validation
  const handleBlur = useCallback((fieldName, value) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }));
    
    const config = fieldConfigs[fieldName];
    const result = validateField(value, config.rules || []);
    
    setErrors(prev => ({
      ...prev,
      [fieldName]: result.valid ? null : result.message
    }));
  }, [fieldConfigs]);

  // Handle change event - debounced validation (only after touched)
  const handleChange = useCallback((fieldName, value) => {
    if (touched[fieldName]) {
      debouncedValidators.current[fieldName](value);
    }
  }, [touched]);

  // Validate all fields (for form submission)
  const validateAll = useCallback((formData) => {
    const newErrors = {};
    let isValid = true;

    Object.keys(fieldConfigs).forEach(fieldName => {
      const config = fieldConfigs[fieldName];
      const result = validateField(formData[fieldName], config.rules || []);
      
      if (!result.valid) {
        newErrors[fieldName] = result.message;
        isValid = false;
      }
    });

    setErrors(newErrors);
    setTouched(Object.keys(fieldConfigs).reduce((acc, key) => ({ ...acc, [key]: true }), {}));
    
    return isValid;
  }, [fieldConfigs]);

  // Clear validation for a field
  const clearError = useCallback((fieldName) => {
    setErrors(prev => ({ ...prev, [fieldName]: null }));
  }, []);

  // Reset all validation
  const reset = useCallback(() => {
    setErrors({});
    setTouched({});
  }, []);

  return {
    errors,
    touched,
    handleBlur,
    handleChange,
    validateAll,
    clearError,
    reset
  };
};
