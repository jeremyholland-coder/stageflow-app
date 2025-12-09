import React, { useState, useEffect } from 'react';
import { ChevronDown, AlertCircle } from 'lucide-react';

// Common country codes with their dial codes and formats
const COUNTRIES = [
  { code: 'US', name: 'United States', dial: '+1', flag: '🇺🇸', format: '(XXX) XXX-XXXX', maxLength: 10 },
  { code: 'CA', name: 'Canada', dial: '+1', flag: '🇨🇦', format: '(XXX) XXX-XXXX', maxLength: 10 },
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧', format: 'XXXX XXXXXX', maxLength: 10 },
  { code: 'AU', name: 'Australia', dial: '+61', flag: '🇦🇺', format: 'XXXX XXX XXX', maxLength: 9 },
  { code: 'NZ', name: 'New Zealand', dial: '+64', flag: '🇳🇿', format: 'XX XXX XXXX', maxLength: 9 },
  { code: 'IE', name: 'Ireland', dial: '+353', flag: '🇮🇪', format: 'XX XXX XXXX', maxLength: 9 },
  { code: 'DE', name: 'Germany', dial: '+49', flag: '🇩🇪', format: 'XXX XXXXXXX', maxLength: 10 },
  { code: 'FR', name: 'France', dial: '+33', flag: '🇫🇷', format: 'X XX XX XX XX', maxLength: 9 },
  { code: 'ES', name: 'Spain', dial: '+34', flag: '🇪🇸', format: 'XXX XX XX XX', maxLength: 9 },
  { code: 'IT', name: 'Italy', dial: '+39', flag: '🇮🇹', format: 'XXX XXX XXXX', maxLength: 10 },
  { code: 'NL', name: 'Netherlands', dial: '+31', flag: '🇳🇱', format: 'XX XXXXXXXX', maxLength: 9 },
  { code: 'BE', name: 'Belgium', dial: '+32', flag: '🇧🇪', format: 'XXX XX XX XX', maxLength: 9 },
  { code: 'CH', name: 'Switzerland', dial: '+41', flag: '🇨🇭', format: 'XX XXX XX XX', maxLength: 9 },
  { code: 'AT', name: 'Austria', dial: '+43', flag: '🇦🇹', format: 'XXX XXXXXXX', maxLength: 10 },
  { code: 'SE', name: 'Sweden', dial: '+46', flag: '🇸🇪', format: 'XX XXX XX XX', maxLength: 9 },
  { code: 'NO', name: 'Norway', dial: '+47', flag: '🇳🇴', format: 'XXX XX XXX', maxLength: 8 },
  { code: 'DK', name: 'Denmark', dial: '+45', flag: '🇩🇰', format: 'XX XX XX XX', maxLength: 8 },
  { code: 'FI', name: 'Finland', dial: '+358', flag: '🇫🇮', format: 'XX XXX XX XX', maxLength: 9 },
  { code: 'PL', name: 'Poland', dial: '+48', flag: '🇵🇱', format: 'XXX XXX XXX', maxLength: 9 },
  { code: 'PT', name: 'Portugal', dial: '+351', flag: '🇵🇹', format: 'XXX XXX XXX', maxLength: 9 },
  { code: 'GR', name: 'Greece', dial: '+30', flag: '🇬🇷', format: 'XXX XXX XXXX', maxLength: 10 },
  { code: 'IN', name: 'India', dial: '+91', flag: '🇮🇳', format: 'XXXXX XXXXX', maxLength: 10 },
  { code: 'CN', name: 'China', dial: '+86', flag: '🇨🇳', format: 'XXX XXXX XXXX', maxLength: 11 },
  { code: 'JP', name: 'Japan', dial: '+81', flag: '🇯🇵', format: 'XX XXXX XXXX', maxLength: 10 },
  { code: 'KR', name: 'South Korea', dial: '+82', flag: '🇰🇷', format: 'XX XXXX XXXX', maxLength: 10 },
  { code: 'SG', name: 'Singapore', dial: '+65', flag: '🇸🇬', format: 'XXXX XXXX', maxLength: 8 },
  { code: 'HK', name: 'Hong Kong', dial: '+852', flag: '🇭🇰', format: 'XXXX XXXX', maxLength: 8 },
  { code: 'MY', name: 'Malaysia', dial: '+60', flag: '🇲🇾', format: 'XX XXX XXXX', maxLength: 9 },
  { code: 'TH', name: 'Thailand', dial: '+66', flag: '🇹🇭', format: 'XX XXX XXXX', maxLength: 9 },
  { code: 'PH', name: 'Philippines', dial: '+63', flag: '🇵🇭', format: 'XXX XXX XXXX', maxLength: 10 },
  { code: 'ID', name: 'Indonesia', dial: '+62', flag: '🇮🇩', format: 'XXX XXX XXXX', maxLength: 10 },
  { code: 'VN', name: 'Vietnam', dial: '+84', flag: '🇻🇳', format: 'XX XXXX XXXX', maxLength: 10 },
  { code: 'BR', name: 'Brazil', dial: '+55', flag: '🇧🇷', format: 'XX XXXXX XXXX', maxLength: 11 },
  { code: 'MX', name: 'Mexico', dial: '+52', flag: '🇲🇽', format: 'XXX XXX XXXX', maxLength: 10 },
  { code: 'AR', name: 'Argentina', dial: '+54', flag: '🇦🇷', format: 'XX XXXX XXXX', maxLength: 10 },
  { code: 'CL', name: 'Chile', dial: '+56', flag: '🇨🇱', format: 'X XXXX XXXX', maxLength: 9 },
  { code: 'CO', name: 'Colombia', dial: '+57', flag: '🇨🇴', format: 'XXX XXX XXXX', maxLength: 10 },
  { code: 'ZA', name: 'South Africa', dial: '+27', flag: '🇿🇦', format: 'XX XXX XXXX', maxLength: 9 },
  { code: 'EG', name: 'Egypt', dial: '+20', flag: '🇪🇬', format: 'XXX XXX XXXX', maxLength: 10 },
  { code: 'IL', name: 'Israel', dial: '+972', flag: '🇮🇱', format: 'XX XXX XXXX', maxLength: 9 },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', flag: '🇦🇪', format: 'XX XXX XXXX', maxLength: 9 },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', flag: '🇸🇦', format: 'XX XXX XXXX', maxLength: 9 },
  { code: 'TR', name: 'Turkey', dial: '+90', flag: '🇹🇷', format: 'XXX XXX XXXX', maxLength: 10 },
  { code: 'RU', name: 'Russia', dial: '+7', flag: '🇷🇺', format: 'XXX XXX XX XX', maxLength: 10 },
];

// Detect country from timezone
const detectCountryFromTimezone = () => {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Common timezone to country mappings
    const timezoneMap = {
      'America/New_York': 'US',
      'America/Chicago': 'US',
      'America/Denver': 'US',
      'America/Los_Angeles': 'US',
      'America/Toronto': 'CA',
      'America/Vancouver': 'CA',
      'Europe/London': 'GB',
      'Europe/Dublin': 'IE',
      'Australia/Sydney': 'AU',
      'Australia/Melbourne': 'AU',
      'Pacific/Auckland': 'NZ',
      'Europe/Berlin': 'DE',
      'Europe/Paris': 'FR',
      'Europe/Madrid': 'ES',
      'Europe/Rome': 'IT',
      'Europe/Amsterdam': 'NL',
      'Europe/Brussels': 'BE',
      'Europe/Zurich': 'CH',
      'Europe/Vienna': 'AT',
      'Europe/Stockholm': 'SE',
      'Europe/Oslo': 'NO',
      'Europe/Copenhagen': 'DK',
      'Europe/Helsinki': 'FI',
      'Europe/Warsaw': 'PL',
      'Europe/Lisbon': 'PT',
      'Europe/Athens': 'GR',
      'Asia/Kolkata': 'IN',
      'Asia/Shanghai': 'CN',
      'Asia/Tokyo': 'JP',
      'Asia/Seoul': 'KR',
      'Asia/Singapore': 'SG',
      'Asia/Hong_Kong': 'HK',
      'Asia/Kuala_Lumpur': 'MY',
      'Asia/Bangkok': 'TH',
      'Asia/Manila': 'PH',
      'Asia/Jakarta': 'ID',
      'Asia/Ho_Chi_Minh': 'VN',
      'America/Sao_Paulo': 'BR',
      'America/Mexico_City': 'MX',
      'America/Buenos_Aires': 'AR',
      'America/Santiago': 'CL',
      'America/Bogota': 'CO',
      'Africa/Johannesburg': 'ZA',
      'Africa/Cairo': 'EG',
      'Asia/Jerusalem': 'IL',
      'Asia/Dubai': 'AE',
      'Asia/Riyadh': 'SA',
      'Europe/Istanbul': 'TR',
      'Europe/Moscow': 'RU',
    };

    return timezoneMap[timezone] || 'US'; // Default to US if not found
  } catch {
    return 'US'; // Fallback to US
  }
};

// Format phone number based on country format
const formatPhoneNumber = (value, country) => {
  const numbers = value.replace(/\D/g, '');
  const format = country.format;
  let formatted = '';
  let numberIndex = 0;

  for (let i = 0; i < format.length && numberIndex < numbers.length; i++) {
    if (format[i] === 'X') {
      formatted += numbers[numberIndex];
      numberIndex++;
    } else {
      formatted += format[i];
    }
  }

  return formatted;
};

export const PhoneInput = ({
  value = '',
  onChange,
  onBlur,
  error,
  required = false,
  className = '',
  id = 'phone',
  disabled = false,
  // P0 FIX 2025-12-08: Added variant prop for different contexts
  // 'default' = settings/forms, 'modal' = DealDetailsModal dark theme
  variant = 'default'
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState('');

  // Initialize country selection
  useEffect(() => {
    // Try to get saved country from localStorage
    const savedCountryCode = localStorage.getItem('preferred_country_code');

    let initialCountryCode;
    if (savedCountryCode) {
      initialCountryCode = savedCountryCode;
    } else {
      // Auto-detect from timezone
      initialCountryCode = detectCountryFromTimezone();
    }

    const country = COUNTRIES.find(c => c.code === initialCountryCode) || COUNTRIES[0];
    setSelectedCountry(country);
  }, []);

  // Parse existing value on mount
  useEffect(() => {
    if (value && selectedCountry) {
      // Remove dial code and extract just the number
      const dialCode = selectedCountry.dial;
      let number = value;

      // If value starts with + or dial code, remove it
      if (number.startsWith('+')) {
        number = number.substring(dialCode.length);
      } else if (number.startsWith(dialCode.replace('+', ''))) {
        number = number.substring(dialCode.length - 1);
      }

      // Remove all non-numeric characters
      number = number.replace(/\D/g, '');
      setPhoneNumber(number);
    }
  }, [value, selectedCountry]);

  const handleCountrySelect = (country) => {
    setSelectedCountry(country);
    setIsDropdownOpen(false);
    setSearchQuery('');

    // Save to localStorage
    localStorage.setItem('preferred_country_code', country.code);

    // Re-format existing number for new country
    if (phoneNumber) {
      const fullNumber = `${country.dial}${phoneNumber}`;
      onChange?.(fullNumber);
    }
  };

  const handlePhoneChange = (e) => {
    if (!selectedCountry) return;

    // Get only numbers
    const numbers = e.target.value.replace(/\D/g, '');

    // Limit to country's max length
    const limited = numbers.slice(0, selectedCountry.maxLength);

    setPhoneNumber(limited);

    // Format and return full number with dial code
    const fullNumber = `${selectedCountry.dial}${limited}`;
    onChange?.(fullNumber);
  };

  const filteredCountries = COUNTRIES.filter(country =>
    country.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    country.dial.includes(searchQuery) ||
    country.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!selectedCountry) return null;

  const formattedNumber = phoneNumber ? formatPhoneNumber(phoneNumber, selectedCountry) : '';

  // P0 FIX 2025-12-08: Variant-specific styling to match context
  const isModalVariant = variant === 'modal';

  // Button styles based on variant
  const buttonBaseStyles = isModalVariant
    ? 'flex items-center gap-2 px-3 py-3 border rounded-xl bg-gray-800/50 hover:bg-gray-700/50 transition'
    : 'flex items-center gap-2 px-3 py-2 border rounded-lg bg-white dark:bg-[#121212] hover:bg-gray-50 dark:hover:bg-[#1A1A1A] transition';

  const buttonBorderStyles = isModalVariant
    ? (error ? 'border-red-500/50' : 'border-gray-700')
    : (error ? 'border-[#E74C3C] dark:border-[#FF6B6B]' : 'border-[#E0E0E0] dark:border-gray-700');

  // Input styles based on variant
  const inputStyles = isModalVariant
    ? 'flex-1 px-4 py-3 border rounded-xl bg-gray-800/50 text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition'
    : `flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-[#1ABC9C] dark:bg-[#121212] dark:text-[#E0E0E0] ${className}`;

  const inputBorderStyles = isModalVariant
    ? (error ? 'border-red-500/50' : 'border-gray-700')
    : (error ? 'border-[#E74C3C] dark:border-[#FF6B6B]' : 'border-[#E0E0E0] dark:border-gray-700');

  // Label styles based on variant
  const labelStyles = isModalVariant
    ? 'block text-sm font-medium text-white mb-2'
    : 'block text-sm font-medium text-[#1A1A1A] dark:text-[#E0E0E0] mb-2';

  // Text styles for country selector
  const dialCodeStyles = isModalVariant
    ? 'text-sm text-gray-400'
    : 'text-sm text-[#6B7280] dark:text-[#9CA3AF]';

  const chevronStyles = isModalVariant
    ? 'w-4 h-4 text-gray-400'
    : 'w-4 h-4 text-[#6B7280] dark:text-[#9CA3AF]';

  return (
    <div className="relative w-full min-w-0">
      <label htmlFor={id} className={labelStyles}>
        Phone {required && '*'}
      </label>

      <div className="flex gap-2 w-full min-w-0">
        {/* Country Selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            disabled={disabled}
            className={`${buttonBaseStyles} ${buttonBorderStyles} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            aria-label="Select country"
          >
            <span className="text-2xl">{selectedCountry.flag}</span>
            <span className={dialCodeStyles}>{selectedCountry.dial}</span>
            <ChevronDown className={chevronStyles} />
          </button>

          {/* Dropdown */}
          {isDropdownOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsDropdownOpen(false)}
              />

              {/* Dropdown Menu */}
              <div className="absolute top-full left-0 mt-2 w-80 bg-white dark:bg-[#0D1F2D] border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-20 max-h-96 overflow-hidden flex flex-col">
                {/* Search */}
                <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                  <input
                    type="text"
                    placeholder="Search countries..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#121212] text-[#1A1A1A] dark:text-[#E0E0E0] focus:ring-2 focus:ring-[#1ABC9C] focus:border-transparent"
                    autoFocus
                  />
                </div>

                {/* Countries List */}
                <div className="overflow-y-auto flex-1">
                  {filteredCountries.map((country) => (
                    <button
                      key={country.code}
                      type="button"
                      onClick={() => handleCountrySelect(country)}
                      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-[#1A1A1A] transition text-left ${
                        selectedCountry.code === country.code ? 'bg-[#1ABC9C]/10' : ''
                      }`}
                    >
                      <span className="text-2xl">{country.flag}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[#1A1A1A] dark:text-[#E0E0E0] truncate">
                          {country.name}
                        </div>
                        <div className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                          {country.dial}
                        </div>
                      </div>
                      {selectedCountry.code === country.code && (
                        <div className="w-2 h-2 bg-[#1ABC9C] rounded-full" />
                      )}
                    </button>
                  ))}

                  {filteredCountries.length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                      No countries found
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Phone Number Input */}
        {/* UI-FIX 2025-12-09: Added min-w-0 to allow flex-1 to shrink below intrinsic width */}
        <input
          id={id}
          type="tel"
          value={formattedNumber}
          onChange={handlePhoneChange}
          onBlur={onBlur}
          disabled={disabled}
          className={`${inputStyles} ${inputBorderStyles} min-w-0 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          placeholder={selectedCountry.format.replace(/X/g, '0')}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${id}-error` : undefined}
        />
      </div>

      {/* Error Message */}
      {error && (
        <div id={`${id}-error`} className="mt-2 flex items-start gap-1.5" role="alert">
          <AlertCircle className="w-4 h-4 text-[#E74C3C] dark:text-[#FF6B6B] flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-[#E74C3C] dark:text-[#FF6B6B] font-medium">
            {error}
          </p>
        </div>
      )}

      {/* Hint - P0 FIX 2025-12-08: Use variant-specific styling */}
      {!error && (
        <p className={`mt-2 text-xs ${isModalVariant ? 'text-gray-500' : 'text-[#6B7280] dark:text-[#9CA3AF]'}`}>
          Format: {selectedCountry.dial} {selectedCountry.format.replace(/X/g, '0')}
        </p>
      )}
    </div>
  );
};
