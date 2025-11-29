/**
 * Role-Based Access Control (RBAC) Framework
 *
 * Enforces granular permissions based on user roles.
 *
 * Role Hierarchy (highest to lowest):
 * - owner: Full control including billing and org deletion
 * - admin: Manage team, settings, integrations
 * - member: Create/edit deals, view analytics
 * - viewer: Read-only access
 * - api_only: API access only (for service accounts)
 */

import { User } from '@supabase/supabase-js';
import { InsufficientRoleError, ForbiddenError } from './auth-errors';

// Role definitions
export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
  API_ONLY: 'api_only'
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

// Permission definitions
export const PERMISSIONS = {
  // Deal permissions
  READ_DEALS: 'read_deals',
  CREATE_DEALS: 'create_deals',
  EDIT_DEALS: 'edit_deals',
  DELETE_DEALS: 'delete_deals',

  // Analytics permissions
  VIEW_ANALYTICS: 'view_analytics',
  EXPORT_DATA: 'export_data',

  // Settings permissions
  EDIT_SETTINGS: 'edit_settings',
  EDIT_PIPELINE: 'edit_pipeline',

  // Team permissions
  VIEW_TEAM: 'view_team',
  INVITE_MEMBERS: 'invite_members',
  REMOVE_MEMBERS: 'remove_members',
  CHANGE_ROLES: 'change_roles',

  // Integration permissions
  VIEW_INTEGRATIONS: 'view_integrations',
  MANAGE_INTEGRATIONS: 'manage_integrations',

  // Billing permissions
  VIEW_BILLING: 'view_billing',
  MANAGE_BILLING: 'manage_billing',

  // Organization permissions
  DELETE_ORGANIZATION: 'delete_organization'
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// Role -> Permissions mapping
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    PERMISSIONS.READ_DEALS,
    PERMISSIONS.CREATE_DEALS,
    PERMISSIONS.EDIT_DEALS,
    PERMISSIONS.DELETE_DEALS,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.EXPORT_DATA,
    PERMISSIONS.EDIT_SETTINGS,
    PERMISSIONS.EDIT_PIPELINE,
    PERMISSIONS.VIEW_TEAM,
    PERMISSIONS.INVITE_MEMBERS,
    PERMISSIONS.REMOVE_MEMBERS,
    PERMISSIONS.CHANGE_ROLES,
    PERMISSIONS.VIEW_INTEGRATIONS,
    PERMISSIONS.MANAGE_INTEGRATIONS,
    PERMISSIONS.VIEW_BILLING,
    PERMISSIONS.MANAGE_BILLING,
    PERMISSIONS.DELETE_ORGANIZATION
  ],

  admin: [
    PERMISSIONS.READ_DEALS,
    PERMISSIONS.CREATE_DEALS,
    PERMISSIONS.EDIT_DEALS,
    PERMISSIONS.DELETE_DEALS,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.EXPORT_DATA,
    PERMISSIONS.EDIT_SETTINGS,
    PERMISSIONS.EDIT_PIPELINE,
    PERMISSIONS.VIEW_TEAM,
    PERMISSIONS.INVITE_MEMBERS,
    PERMISSIONS.REMOVE_MEMBERS,
    PERMISSIONS.VIEW_INTEGRATIONS,
    PERMISSIONS.MANAGE_INTEGRATIONS,
    PERMISSIONS.VIEW_BILLING
  ],

  member: [
    PERMISSIONS.READ_DEALS,
    PERMISSIONS.CREATE_DEALS,
    PERMISSIONS.EDIT_DEALS,
    PERMISSIONS.DELETE_DEALS,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.VIEW_TEAM,
    PERMISSIONS.VIEW_INTEGRATIONS,
    PERMISSIONS.VIEW_BILLING
  ],

  viewer: [
    PERMISSIONS.READ_DEALS,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.VIEW_TEAM
  ],

  api_only: [
    PERMISSIONS.READ_DEALS,
    PERMISSIONS.CREATE_DEALS,
    PERMISSIONS.EDIT_DEALS,
    PERMISSIONS.DELETE_DEALS
  ]
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions?.includes(permission) || false;
}

/**
 * Check if user has required permission
 * Throws ForbiddenError if permission is missing
 */
export function requirePermission(
  userRole: string,
  requiredPermission: Permission
): void {
  if (!hasPermission(userRole as Role, requiredPermission)) {
    throw new InsufficientRoleError(
      [`Permission required: ${requiredPermission}`],
      userRole
    );
  }
}

/**
 * Check if user has any of the required permissions
 */
export function hasAnyPermission(
  role: Role,
  requiredPermissions: Permission[]
): boolean {
  return requiredPermissions.some(permission => hasPermission(role, permission));
}

/**
 * Check if user has all of the required permissions
 */
export function hasAllPermissions(
  role: Role,
  requiredPermissions: Permission[]
): boolean {
  return requiredPermissions.every(permission => hasPermission(role, permission));
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Check if role is at least as powerful as required role
 *
 * Hierarchy: owner > admin > member > viewer > api_only
 */
export function hasRoleLevel(userRole: string, requiredRole: Role): boolean {
  const roleHierarchy: Record<Role, number> = {
    owner: 5,
    admin: 4,
    member: 3,
    viewer: 2,
    api_only: 1
  };

  const userLevel = roleHierarchy[userRole as Role] || 0;
  const requiredLevel = roleHierarchy[requiredRole] || 0;

  return userLevel >= requiredLevel;
}

/**
 * Require user to have at least specified role level
 */
export function requireRoleLevel(userRole: string, requiredRole: Role): void {
  if (!hasRoleLevel(userRole, requiredRole)) {
    throw new InsufficientRoleError(
      [requiredRole],
      userRole
    );
  }
}

/**
 * Check if user is organization owner
 */
export function isOwner(role: string): boolean {
  return role === ROLES.OWNER;
}

/**
 * Check if user is admin or higher
 */
export function isAdminOrHigher(role: string): boolean {
  return hasRoleLevel(role, ROLES.ADMIN);
}

/**
 * Check if user can manage team (invite/remove members)
 */
export function canManageTeam(role: string): boolean {
  return hasPermission(role as Role, PERMISSIONS.INVITE_MEMBERS);
}

/**
 * Check if user can manage billing
 */
export function canManageBilling(role: string): boolean {
  return hasPermission(role as Role, PERMISSIONS.MANAGE_BILLING);
}

/**
 * Check if user can delete organization
 */
export function canDeleteOrganization(role: string): boolean {
  return hasPermission(role as Role, PERMISSIONS.DELETE_ORGANIZATION);
}

/**
 * Validate that operation is allowed for role
 *
 * Usage examples:
 *   validateOperation(member.role, 'delete_organization');
 *   validateOperation(member.role, 'manage_integrations');
 */
export function validateOperation(userRole: string, operation: string): void {
  // Map common operations to permissions
  const operationMap: Record<string, Permission> = {
    'delete_organization': PERMISSIONS.DELETE_ORGANIZATION,
    'manage_billing': PERMISSIONS.MANAGE_BILLING,
    'manage_integrations': PERMISSIONS.MANAGE_INTEGRATIONS,
    'invite_members': PERMISSIONS.INVITE_MEMBERS,
    'remove_members': PERMISSIONS.REMOVE_MEMBERS,
    'change_roles': PERMISSIONS.CHANGE_ROLES,
    'edit_settings': PERMISSIONS.EDIT_SETTINGS,
    'delete_deals': PERMISSIONS.DELETE_DEALS
  };

  const permission = operationMap[operation];

  if (!permission) {
    throw new ForbiddenError(`Unknown operation: ${operation}`);
  }

  requirePermission(userRole, permission);
}

/**
 * Get human-readable role name
 */
export function getRoleName(role: Role): string {
  const roleNames: Record<Role, string> = {
    owner: 'Owner',
    admin: 'Administrator',
    member: 'Member',
    viewer: 'Viewer',
    api_only: 'API Access Only'
  };

  return roleNames[role] || role;
}

/**
 * Get role description
 */
export function getRoleDescription(role: Role): string {
  const descriptions: Record<Role, string> = {
    owner: 'Full control including billing and organization deletion',
    admin: 'Manage team, settings, and integrations',
    member: 'Create and edit deals, view analytics',
    viewer: 'Read-only access to deals and analytics',
    api_only: 'API access for integrations and automations'
  };

  return descriptions[role] || '';
}
