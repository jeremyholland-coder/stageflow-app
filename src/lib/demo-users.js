/**
 * Demo User Display Data
 *
 * TASK 3: For the demo organization (@startupstage.com), provide realistic
 * names and avatars instead of just showing email addresses.
 *
 * Uses DiceBear API for deterministic avatar generation based on name.
 */

// Demo organization email domain
export const DEMO_EMAIL_DOMAIN = 'startupstage.com';

// Demo team member mapping
// Maps email prefix to display name and role
export const DEMO_TEAM_MEMBERS = {
  // Leadership
  'founder': { name: 'Jordan Reyes', firstName: 'Jordan', lastName: 'Reyes', role: 'Founder & CEO' },
  'ceo': { name: 'Jordan Reyes', firstName: 'Jordan', lastName: 'Reyes', role: 'CEO' },
  'cro': { name: 'Alex Chen', firstName: 'Alex', lastName: 'Chen', role: 'Chief Revenue Officer' },
  'vp': { name: 'Morgan Taylor', firstName: 'Morgan', lastName: 'Taylor', role: 'VP of Sales' },
  'director': { name: 'Sam Rodriguez', firstName: 'Sam', lastName: 'Rodriguez', role: 'Sales Director' },

  // Sales Managers
  'manager1': { name: 'Taylor Kim', firstName: 'Taylor', lastName: 'Kim', role: 'Sales Manager' },
  'manager2': { name: 'Casey Wong', firstName: 'Casey', lastName: 'Wong', role: 'Sales Manager' },

  // Account Executives
  'ae1': { name: 'Mia Patel', firstName: 'Mia', lastName: 'Patel', role: 'Account Executive' },
  'ae2': { name: 'Noah Williams', firstName: 'Noah', lastName: 'Williams', role: 'Account Executive' },
  'ae3': { name: 'Sofia Martinez', firstName: 'Sofia', lastName: 'Martinez', role: 'Account Executive' },
  'ae4': { name: 'Ethan Lee', firstName: 'Ethan', lastName: 'Lee', role: 'Account Executive' },
  'ae5': { name: 'Amanda Clark', firstName: 'Amanda', lastName: 'Clark', role: 'Account Executive' },
  'ae6': { name: 'Marcus Johnson', firstName: 'Marcus', lastName: 'Johnson', role: 'Account Executive' },
  'ae7': { name: 'Isabella Torres', firstName: 'Isabella', lastName: 'Torres', role: 'Account Executive' },
  'ae8': { name: 'Daniel Park', firstName: 'Daniel', lastName: 'Park', role: 'Account Executive' },
  'ae9': { name: 'Olivia Chen', firstName: 'Olivia', lastName: 'Chen', role: 'Account Executive' },
  'ae10': { name: 'James Wilson', firstName: 'James', lastName: 'Wilson', role: 'Account Executive' },

  // SDRs (Sales Development Reps)
  'sdr1': { name: 'Emma Davis', firstName: 'Emma', lastName: 'Davis', role: 'SDR' },
  'sdr2': { name: 'Lucas Brown', firstName: 'Lucas', lastName: 'Brown', role: 'SDR' },
  'sdr3': { name: 'Ava Thompson', firstName: 'Ava', lastName: 'Thompson', role: 'SDR' },
  'sdr4': { name: 'Liam Garcia', firstName: 'Liam', lastName: 'Garcia', role: 'SDR' },

  // Revenue Operations
  'revops': { name: 'Riley Anderson', firstName: 'Riley', lastName: 'Anderson', role: 'RevOps Manager' },
  'ops': { name: 'Jordan Mitchell', firstName: 'Jordan', lastName: 'Mitchell', role: 'Sales Ops' },

  // Fallback for unknown demo emails
  'stageflow': { name: 'Demo User', firstName: 'Demo', lastName: 'User', role: 'Team Member' },
  'demo': { name: 'Demo User', firstName: 'Demo', lastName: 'User', role: 'Team Member' },
  'test': { name: 'Test User', firstName: 'Test', lastName: 'User', role: 'Team Member' },
};

/**
 * Check if an email belongs to the demo organization
 * @param {string} email - The email to check
 * @returns {boolean} True if demo org email
 */
export function isDemoEmail(email) {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

/**
 * Get demo user data for an email
 * @param {string} email - The email to look up
 * @returns {object|null} Demo user data or null if not a demo email
 */
export function getDemoUserData(email) {
  if (!isDemoEmail(email)) return null;

  const prefix = email.toLowerCase().split('@')[0];

  // First try exact match
  if (DEMO_TEAM_MEMBERS[prefix]) {
    return DEMO_TEAM_MEMBERS[prefix];
  }

  // Try removing numbers for base role match (ae1 -> ae, sdr2 -> sdr)
  const basePrefix = prefix.replace(/\d+$/, '');
  if (basePrefix !== prefix && DEMO_TEAM_MEMBERS[basePrefix]) {
    // Generate a variation based on the original prefix
    const num = parseInt(prefix.replace(/\D/g, '')) || 1;
    const base = DEMO_TEAM_MEMBERS[basePrefix];
    return {
      ...base,
      // Keep the original name from mapping if it exists
    };
  }

  // Fallback: generate a reasonable display
  return {
    name: `${capitalizeFirst(prefix)} User`,
    firstName: capitalizeFirst(prefix),
    lastName: 'User',
    role: 'Team Member'
  };
}

/**
 * Generate a DiceBear avatar URL for a name
 * Uses the 'initials' style for a clean, professional look
 * @param {string} name - The name to generate avatar for
 * @param {number} size - Avatar size in pixels (default 80)
 * @returns {string} DiceBear avatar URL
 */
export function getDemoAvatarUrl(name, size = 80) {
  if (!name) return null;

  // Use notionists-neutral style for realistic, professional avatars
  // Seed with the full name for consistency
  const seed = encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'));
  return `https://api.dicebear.com/7.x/notionists-neutral/svg?seed=${seed}&size=${size}&backgroundColor=0CE3B1,0D9488,0891B2,7C3AED,2563EB&backgroundType=gradientLinear`;
}

/**
 * Get display name for a user, using demo data if applicable
 * @param {object} user - User object with email, full_name, first_name, last_name
 * @returns {string} Display name
 */
export function getDisplayName(user) {
  if (!user) return 'Unknown';

  const email = user.email || user.profiles?.email;

  // Check if demo user
  if (isDemoEmail(email)) {
    const demoData = getDemoUserData(email);
    if (demoData) return demoData.name;
  }

  // Fall back to regular name display
  const first = user.first_name || user.profiles?.first_name || user.profilesData?.first_name;
  const last = user.last_name || user.profiles?.last_name || user.profilesData?.last_name;
  const fullName = user.full_name || user.profiles?.full_name;

  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (fullName) return fullName;
  if (email) return email.split('@')[0];

  return 'Unknown';
}

/**
 * Get avatar URL for a user, using demo data if applicable
 * @param {object} user - User object with email, avatar_url
 * @returns {string|null} Avatar URL or null
 */
export function getAvatarUrl(user) {
  if (!user) return null;

  const email = user.email || user.profiles?.email;

  // Check if demo user - generate DiceBear avatar
  if (isDemoEmail(email)) {
    const demoData = getDemoUserData(email);
    if (demoData) return getDemoAvatarUrl(demoData.name);
  }

  // Fall back to stored avatar URL
  return user.avatar_url || user.profilesData?.avatar_url || user.profiles?.avatar_url || null;
}

/**
 * Get initials for a user, using demo data if applicable
 * @param {object} user - User object
 * @returns {string} Initials (1-2 characters)
 */
export function getInitials(user) {
  if (!user) return 'U';

  const email = user.email || user.profiles?.email;

  // Check if demo user
  if (isDemoEmail(email)) {
    const demoData = getDemoUserData(email);
    if (demoData && demoData.firstName && demoData.lastName) {
      return `${demoData.firstName[0]}${demoData.lastName[0]}`.toUpperCase();
    }
  }

  // Fall back to regular initials
  const first = user.first_name || user.profiles?.first_name || user.profilesData?.first_name;
  const last = user.last_name || user.profiles?.last_name || user.profilesData?.last_name;
  const fullName = user.full_name || user.profiles?.full_name;

  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  if (first) return first[0].toUpperCase();
  if (fullName) {
    const parts = fullName.split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return parts[0][0].toUpperCase();
  }
  if (email) return email[0].toUpperCase();

  return 'U';
}

// Helper function
function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export default {
  DEMO_EMAIL_DOMAIN,
  DEMO_TEAM_MEMBERS,
  isDemoEmail,
  getDemoUserData,
  getDemoAvatarUrl,
  getDisplayName,
  getAvatarUrl,
  getInitials,
};
