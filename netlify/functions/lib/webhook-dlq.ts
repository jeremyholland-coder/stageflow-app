// netlify/functions/lib/webhook-dlq.ts
/**
 * Webhook Dead Letter Queue (DLQ) System
 * Handles failed webhook deliveries with retry logic
 * 
 * CRITICAL FIX #4: Prevents lost webhook events
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface WebhookEvent {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: any;
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  last_error: string | null;
  created_at: string;
}

interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export class WebhookDLQ {
  private supabase: SupabaseClient;
  private config: RetryConfig;

  constructor(supabaseUrl: string, supabaseKey: string, config?: Partial<RetryConfig>) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.config = {
      maxAttempts: config?.maxAttempts || 5,
      initialDelay: config?.initialDelay || 60000, // 1 minute
      maxDelay: config?.maxDelay || 3600000, // 1 hour
      backoffMultiplier: config?.backoffMultiplier || 2
    };
  }

  /**
   * Calculate next retry time using exponential backoff
   */
  private calculateNextRetry(attemptNumber: number): Date {
    const delay = Math.min(
      this.config.initialDelay * Math.pow(this.config.backoffMultiplier, attemptNumber),
      this.config.maxDelay
    );
    
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    const finalDelay = delay + jitter;
    
    return new Date(Date.now() + finalDelay);
  }

  /**
   * Add failed webhook to DLQ
   */
  async addToQueue(
    webhookId: string,
    eventType: string,
    payload: any,
    error: string
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const nextRetry = this.calculateNextRetry(0);

      const { data, error: dbError } = await this.supabase
        .from('webhook_dlq')
        .insert({
          webhook_id: webhookId,
          event_type: eventType,
          payload: payload,
          attempts: 0,
          max_attempts: this.config.maxAttempts,
          next_retry_at: nextRetry.toISOString(),
          last_error: error,
          status: 'pending'
        })
        .select()
        .single();

      if (dbError) {
        console.error('[DLQ] Failed to add:', dbError);
        return { success: false, error: dbError.message };
      }

      return { success: true, id: data.id };
    } catch (error: any) {
      console.error('[DLQ] Error adding:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get events ready for retry
   */
  async getRetryableEvents(limit: number = 100): Promise<WebhookEvent[]> {
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('webhook_dlq')
      .select('*')
      .eq('status', 'pending')
      .filter('attempts', 'lt', 'max_attempts')
      .lte('next_retry_at', now)
      .order('next_retry_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('[DLQ] Error fetching retryable:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Attempt to deliver webhook
   */
  async deliverWebhook(
    webhookUrl: string,
    eventType: string,
    payload: any,
    secret: string
  ): Promise<{ success: boolean; status?: number; error?: string }> {
    try {
      const signature = await this.createSignature(payload, secret);
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': eventType,
          'User-Agent': 'StageFlow-Webhooks/1.0'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
      });

      if (response.ok) {
        return { success: true, status: response.status };
      }

      const errorText = await response.text().catch(() => 'No error message');
      return {
        success: false,
        status: response.status,
        error: `HTTP ${response.status}: ${errorText}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Delivery failed'
      };
    }
  }

  /**
   * Create webhook signature
   */
  private async createSignature(payload: any, secret: string): Promise<string> {
    const data = JSON.stringify(payload);
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(data)
    );
    
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Retry a single DLQ event
   */
  async retryEvent(event: WebhookEvent): Promise<boolean> {
    const { data: webhook, error: webhookError } = await this.supabase
      .from('webhooks')
      .select('url, secret, is_active')
      .eq('id', event.webhook_id)
      .single();

    if (webhookError || !webhook) {
      console.error(`[DLQ] Webhook ${event.webhook_id} not found`);
      await this.markAsFailed(event.id, 'Webhook not found or deleted');
      return false;
    }

    if (!webhook.is_active) {
      console.warn(`[DLQ] Webhook ${event.webhook_id} is inactive`);
      await this.markAsFailed(event.id, 'Webhook is inactive');
      return false;
    }

    const result = await this.deliverWebhook(
      webhook.url,
      event.event_type,
      event.payload,
      webhook.secret
    );

    const newAttempts = event.attempts + 1;

    if (result.success) {
      await this.markAsDelivered(event.id);
      await this.logDelivery(event.webhook_id, event.event_type, event.payload, true, result.status);
      return true;
    } else {
      if (newAttempts >= event.max_attempts) {
        await this.markAsFailed(event.id, result.error || 'Max retries exceeded');
        await this.logDelivery(event.webhook_id, event.event_type, event.payload, false, result.status, result.error);
        return false;
      } else {
        const nextRetry = this.calculateNextRetry(newAttempts);
        await this.updateForNextRetry(event.id, newAttempts, result.error || 'Unknown error', nextRetry);
        return false;
      }
    }
  }

  private async markAsDelivered(eventId: string): Promise<void> {
    await this.supabase
      .from('webhook_dlq')
      .update({ 
        status: 'delivered',
        delivered_at: new Date().toISOString()
      })
      .eq('id', eventId);
  }

  private async markAsFailed(eventId: string, error: string): Promise<void> {
    await this.supabase
      .from('webhook_dlq')
      .update({ 
        status: 'failed',
        last_error: error,
        failed_at: new Date().toISOString()
      })
      .eq('id', eventId);
  }

  private async updateForNextRetry(
    eventId: string,
    attempts: number,
    error: string,
    nextRetry: Date
  ): Promise<void> {
    await this.supabase
      .from('webhook_dlq')
      .update({ 
        attempts,
        last_error: error,
        next_retry_at: nextRetry.toISOString()
      })
      .eq('id', eventId);
  }

  private async logDelivery(
    webhookId: string,
    eventType: string,
    payload: any,
    success: boolean,
    statusCode?: number,
    errorMessage?: string
  ): Promise<void> {
    await this.supabase
      .from('webhook_deliveries')
      .insert({
        webhook_id: webhookId,
        event_type: eventType,
        payload: payload,
        success: success,
        response_status: statusCode,
        response_body: errorMessage,
        delivered_at: new Date().toISOString()
      });
  }

  /**
   * Process all retryable events
   */
  async processQueue(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const events = await this.getRetryableEvents();
    
    let succeeded = 0;
    let failed = 0;


    for (const event of events) {
      const success = await this.retryEvent(event);
      if (success) {
        succeeded++;
      } else {
        failed++;
      }
    }


    return {
      processed: events.length,
      succeeded,
      failed
    };
  }

  /**
   * Get DLQ statistics
   */
  async getStats(): Promise<{
    pending: number;
    delivered: number;
    failed: number;
    totalAttempts: number;
  }> {
    const { data, error } = await this.supabase
      .from('webhook_dlq')
      .select('status, attempts');

    if (error) {
      console.error('[DLQ] Error getting stats:', error);
      return { pending: 0, delivered: 0, failed: 0, totalAttempts: 0 };
    }

    const stats = {
      pending: 0,
      delivered: 0,
      failed: 0,
      totalAttempts: 0
    };

    data?.forEach(event => {
      stats.totalAttempts += event.attempts;
      if (event.status === 'pending') stats.pending++;
      if (event.status === 'delivered') stats.delivered++;
      if (event.status === 'failed') stats.failed++;
    });

    return stats;
  }
}

export default WebhookDLQ;
