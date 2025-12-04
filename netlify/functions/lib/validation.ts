import { z } from 'zod';

// Deal validation schema
export const DealSchema = z.object({
  client: z.string().min(1, 'Client name required').max(255, 'Client name too long'),
  email: z.string().email('Invalid email address'),
  phone: z.string().regex(/^[+]?[\d\s()-]+$/, 'Invalid phone number').optional().or(z.literal('')),
  value: z.number().min(0, 'Value must be positive').max(999999999, 'Value too large'),
  stage: z.enum(['lead', 'quote', 'approval', 'invoice', 'onboarding', 'delivery', 'retention']),
  status: z.enum(['active', 'won', 'lost', 'disqualified']),
  notes: z.string().max(5000, 'Notes too long').optional().or(z.literal(''))
});

// Webhook validation schema
export const WebhookSchema = z.object({
  name: z.string().min(1, 'Webhook name required').max(255, 'Name too long'),
  url: z.string().url('Invalid URL').regex(/^https?:\/\//i, 'URL must use HTTP or HTTPS'),
  events: z.array(z.string()).min(1, 'At least one event required'),
  secret: z.string().optional()
});

// API key validation schema
export const ApiKeySchema = z.object({
  name: z.string().min(1, 'Key name required').max(255, 'Name too long')
});

// Notification payload schema
export const NotificationPayloadSchema = z.object({
  type: z.enum(['deal_created', 'stage_changed', 'deal_won', 'deal_lost']),
  user_email: z.string().email('Invalid email'),
  user_id: z.string().uuid('Invalid user ID'),
  organization_id: z.string().uuid('Invalid organization ID'),
  deal: z.object({
    id: z.string().uuid('Invalid deal ID'),
    client: z.string(),
    value: z.number(),
    stage: z.string(),
    from_stage: z.string().optional()
  })
});

// LLM query schema
export const LLMQuerySchema = z.object({
  prompt: z.string().min(1, 'Prompt required').max(10000, 'Prompt too long'),
  deal_id: z.string().uuid('Invalid deal ID').optional(),
  user_id: z.string().uuid('Invalid user ID'),
  organization_id: z.string().uuid('Invalid organization ID'),
  test_key: z.string().optional(),
  test_provider: z.string().optional()
});

// AI Provider schema
export const AIProviderSchema = z.object({
  // FIX 2025-12-04: Only 3 providers (removed xAI/Grok)
  provider_type: z.enum(['openai', 'anthropic', 'google']),
  api_key: z.string().min(1, 'API key required'),
  display_name: z.string().max(255, 'Display name too long').optional()
});

// Helper function to validate and return typed data
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
  try {
    const validated = schema.parse(data);
    return { success: true, data: validated };
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const messages = (error as any).errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ');
      return { success: false, error: messages };
    }
    return { success: false, error: 'Validation failed' };
  }
}
