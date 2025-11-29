-- NOTIFICATION SYSTEM V1
-- Apple-grade notification architecture with per-user preferences
-- Phase N1: Database schema for notification categories, user preferences, and queue

-- ============================================================================
-- 1) notification_categories - Master list of notification types
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,  -- e.g. 'DEAL_ASSIGNED', 'TASK_DUE_TODAY'
  name TEXT NOT NULL,         -- Human label
  description TEXT,
  is_critical BOOLEAN NOT NULL DEFAULT false,
  default_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed initial notification categories
INSERT INTO notification_categories (code, name, description, is_critical, default_enabled)
VALUES
  ('DEAL_ASSIGNED', 'Deal assigned to you', 'Alerts when a deal is assigned to you', true, true),
  ('DEAL_WON', 'Deal won', 'Celebration when a deal is marked as won', false, true),
  ('DEAL_LOST', 'Deal lost', 'Notification when a deal is marked as lost', false, true),
  ('TASK_DUE_TODAY', 'Task due today', 'Reminder for tasks due today', false, true),
  ('STAGE_CHANGED', 'Deal stage changed', 'Alerts when a deal moves to a different stage', false, false),
  ('WEEKLY_PIPELINE_DIGEST', 'Weekly pipeline summary', 'Weekly email with your pipeline health', false, true),
  ('TEAM_MENTION', 'Team mentions', 'When someone mentions you in notes or comments', false, true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 2) user_notification_preferences - Per-user, per-category preferences
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  category_code TEXT NOT NULL REFERENCES notification_categories (code) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  channel_email BOOLEAN NOT NULL DEFAULT true,
  channel_in_app BOOLEAN NOT NULL DEFAULT true,
  channel_push BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, category_code)
);

-- Index for fast preference lookups
CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_user_cat
  ON user_notification_preferences (user_id, category_code);

-- ============================================================================
-- 3) notifications_queue - Audit log and retry queue for sent notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  category_code TEXT NOT NULL REFERENCES notification_categories (code),
  channel TEXT NOT NULL, -- 'email', 'in_app', 'push'
  payload JSONB NOT NULL,   -- e.g. { "dealId": "...", "title": "...", "amount": 1000 }
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0
);

-- Index for queue processing and user notification history
CREATE INDEX IF NOT EXISTS idx_notifications_queue_status
  ON notifications_queue (status, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_queue_user
  ON notifications_queue (user_id, created_at DESC);

-- ============================================================================
-- 4) Trigger for auto-updating updated_at on preferences
-- ============================================================================
CREATE OR REPLACE FUNCTION set_notification_pref_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_pref_updated_at ON user_notification_preferences;

CREATE TRIGGER trg_notification_pref_updated_at
BEFORE UPDATE ON user_notification_preferences
FOR EACH ROW EXECUTE FUNCTION set_notification_pref_updated_at();

-- ============================================================================
-- 5) RLS Policies
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE notification_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_queue ENABLE ROW LEVEL SECURITY;

-- notification_categories: Everyone can read, only service role can modify
DROP POLICY IF EXISTS "notification_categories_select" ON notification_categories;
CREATE POLICY "notification_categories_select" ON notification_categories
  FOR SELECT USING (true);

-- user_notification_preferences: Users can only access their own
DROP POLICY IF EXISTS "user_notification_prefs_select" ON user_notification_preferences;
CREATE POLICY "user_notification_prefs_select" ON user_notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_notification_prefs_insert" ON user_notification_preferences;
CREATE POLICY "user_notification_prefs_insert" ON user_notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_notification_prefs_update" ON user_notification_preferences;
CREATE POLICY "user_notification_prefs_update" ON user_notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_notification_prefs_delete" ON user_notification_preferences;
CREATE POLICY "user_notification_prefs_delete" ON user_notification_preferences
  FOR DELETE USING (auth.uid() = user_id);

-- notifications_queue: Users can view their own, service role can manage all
DROP POLICY IF EXISTS "notifications_queue_select" ON notifications_queue;
CREATE POLICY "notifications_queue_select" ON notifications_queue
  FOR SELECT USING (auth.uid() = user_id);

-- Service role policies for backend operations (using service_role key bypasses RLS)
-- No additional policies needed as service_role key bypasses RLS

-- ============================================================================
-- End of Migration
-- ============================================================================
