import type { Handler } from "@netlify/functions";
import { shouldUseNewAuth } from "./lib/feature-flags";
import { requireAuth, createAuthErrorResponse } from "./lib/auth-middleware";
import { createClient } from '@supabase/supabase-js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = 'jeremy@startupstage.com';
const FROM_EMAIL = 'StageFlow Digest <support@startupstage.com>';

interface FeedbackItem {
  id: string;
  user_email: string;
  rating: number | null;
  category: string;
  message: string | null;
  page_url: string;
  created_at: string;
}

interface CategorizedFeedback {
  bug: FeedbackItem[];
  feature: FeedbackItem[];
  love: FeedbackItem[];
  confused: FeedbackItem[];
  other: FeedbackItem[];
}

interface FeedbackAnalysis {
  totalCount: number;
  averageRating: number;
  categoryCounts: { [key: string]: number };
  criticalIssues: FeedbackItem[];
  commonThemes: { theme: string; count: number; items: FeedbackItem[] }[];
}

// Keywords for detecting common themes
const THEME_KEYWORDS = {
  'performance': ['slow', 'loading', 'lag', 'responsive', 'speed', 'wait', 'takes too long', 'freezing'],
  'mobile': ['mobile', 'iphone', 'android', 'phone', 'tablet', 'responsive'],
  'kanban': ['kanban', 'board', 'card', 'drag', 'column'],
  'dashboard': ['dashboard', 'home', 'overview'],
  'navigation': ['navigate', 'menu', 'find', 'locate', 'cant find', 'where is'],
  'deals': ['deal', 'pipeline', 'stage'],
  'ui/ux': ['confusing', 'unclear', 'dont understand', 'complicated', 'hard to'],
  'integrations': ['integration', 'connect', 'sync', 'api'],
  'ai': ['ai', 'assistant', 'chatgpt', 'claude'],
};

const handler: Handler = async (event) => {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 9: Add authentication to scheduled job (allows internal scheduling)
  if (shouldUseNewAuth("daily-feedback-digest")) {
    try {
      const authHeader = (event as any).headers?.authorization || (event as any).headers?.Authorization;
      if (authHeader) {
        const request = new Request("https://dummy.com", {
          method: "POST",
          headers: { "Authorization": authHeader }
        });
        await requireAuth(request);
      }
      // No auth header = scheduled execution (allowed)
    } catch (authError) {
      const errorResponse = createAuthErrorResponse(authError);
      return {
        statusCode: errorResponse.status,
        body: await errorResponse.text()
      };
    }
  }
  // LEGACY AUTH PATH: No authentication (allows both manual and scheduled execution)

  // Only allow scheduled execution or admin secret
  const cronSecret = event.headers['x-netlify-cron-secret'];
  const adminSecret = event.headers['x-admin-secret'];

  if (cronSecret !== process.env.NETLIFY_CRON_SECRET && adminSecret !== process.env.ADMIN_SECRET) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized - This function can only be run by Netlify scheduled functions or admin' })
    };
  }

  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Email service not configured' })
    };
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get feedback from last 24 hours
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: feedback, error } = await supabase
      .from('feedback')
      .select('*')
      .gte('created_at', yesterday)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // If no feedback, don't send email
    if (!feedback || feedback.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No feedback to report' })
      };
    }

    // Analyze and categorize feedback
    const analysis = analyzeFeedback(feedback);
    const html = generateDigestEmail(feedback, analysis);

    // Send digest email
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject: `Feedback Widget Responses - Daily Digest (${feedback.length} items)`,
        html
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Resend API error:', result);
      throw new Error(`Resend API error: ${JSON.stringify(result)}`);
    }


    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        feedbackCount: feedback.length,
        emailId: result.id
      })
    };

  } catch (error) {
    console.error('Error generating daily feedback digest:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to generate digest',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

function analyzeFeedback(feedback: FeedbackItem[]): FeedbackAnalysis {
  const analysis: FeedbackAnalysis = {
    totalCount: feedback.length,
    averageRating: 0,
    categoryCounts: {},
    criticalIssues: [],
    commonThemes: []
  };

  // Calculate average rating
  const ratingsOnly = feedback.filter(f => f.rating !== null);
  if (ratingsOnly.length > 0) {
    analysis.averageRating = ratingsOnly.reduce((sum, f) => sum + (f.rating || 0), 0) / ratingsOnly.length;
  }

  // Count by category
  feedback.forEach(f => {
    const cat = f.category || 'other';
    analysis.categoryCounts[cat] = (analysis.categoryCounts[cat] || 0) + 1;
  });

  // Find critical issues (rating 1-2 with bug category)
  analysis.criticalIssues = feedback.filter(f =>
    (f.rating && f.rating <= 2) || f.category === 'bug'
  );

  // Detect common themes
  const themeMap: { [key: string]: FeedbackItem[] } = {};

  feedback.forEach(f => {
    const text = `${f.message || ''} ${f.page_url || ''}`.toLowerCase();

    Object.entries(THEME_KEYWORDS).forEach(([theme, keywords]) => {
      if (keywords.some(keyword => text.includes(keyword))) {
        if (!themeMap[theme]) themeMap[theme] = [];
        themeMap[theme].push(f);
      }
    });
  });

  // Convert to array and sort by frequency
  analysis.commonThemes = Object.entries(themeMap)
    .map(([theme, items]) => ({ theme, count: items.length, items }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5); // Top 5 themes

  return analysis;
}

function generateDigestEmail(feedback: FeedbackItem[], analysis: FeedbackAnalysis): string {
  const ratingStars = analysis.averageRating > 0 ? '⭐'.repeat(Math.round(analysis.averageRating)) : 'N/A';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 800px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #2C3E50 0%, #1ABC9C 100%); color: white; padding: 40px; border-radius: 12px 12px 0 0; }
          .summary { background: #f9f9f9; padding: 30px; border-bottom: 1px solid #ddd; }
          .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }
          .stat-card { background: white; padding: 20px; border-radius: 8px; text-align: center; border: 2px solid #1ABC9C; }
          .stat-value { font-size: 32px; font-weight: bold; color: #1ABC9C; }
          .stat-label { font-size: 12px; color: #666; text-transform: uppercase; margin-top: 5px; }
          .section { padding: 30px; background: white; }
          .section-title { font-size: 20px; font-weight: bold; margin-bottom: 20px; color: #2C3E50; border-left: 4px solid #1ABC9C; padding-left: 15px; }
          .theme-item { background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 15px 0; border-radius: 4px; }
          .theme-header { font-weight: bold; color: #1e40af; display: flex; justify-content: space-between; align-items: center; }
          .theme-count { background: #3b82f6; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; }
          .feedback-item { background: #fff; border: 1px solid #ddd; padding: 20px; margin: 15px 0; border-radius: 8px; }
          .feedback-header { display: flex; justify-content: space-between; margin-bottom: 10px; }
          .user-info { font-weight: bold; color: #2C3E50; }
          .rating { color: #f59e0b; }
          .category-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; color: white; }
          .category-bug { background: #ef4444; }
          .category-feature { background: #8b5cf6; }
          .category-love { background: #ec4899; }
          .category-confused { background: #f59e0b; }
          .category-other { background: #6b7280; }
          .message { margin: 15px 0; padding: 15px; background: #f9fafb; border-left: 3px solid #1ABC9C; border-radius: 4px; }
          .meta { font-size: 12px; color: #666; margin-top: 10px; }
          .critical-alert { background: #fee2e2; border: 2px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 8px; }
          .critical-title { color: #dc2626; font-weight: bold; font-size: 18px; margin-bottom: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">📊 Daily Feedback Digest</h1>
            <p style="margin: 10px 0 0; opacity: 0.9; font-size: 16px;">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>

          <div class="summary">
            <h2 style="margin-top: 0;">Summary</h2>
            <div class="stat-grid">
              <div class="stat-card">
                <div class="stat-value">${analysis.totalCount}</div>
                <div class="stat-label">Total Feedback</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${ratingStars}</div>
                <div class="stat-label">Avg Rating</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${analysis.criticalIssues.length}</div>
                <div class="stat-label">Critical Issues</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${analysis.commonThemes.length}</div>
                <div class="stat-label">Common Themes</div>
              </div>
            </div>

            <h3 style="margin-top: 30px;">Category Breakdown:</h3>
            <ul style="list-style: none; padding: 0;">
              ${Object.entries(analysis.categoryCounts).map(([cat, count]) => {
                const emoji = {
                  'bug': '🐛',
                  'feature': '💡',
                  'love': '❤️',
                  'confused': '🤔',
                  'other': '💬'
                }[cat] || '💬';
                return `<li style="padding: 8px 0;"><strong>${emoji} ${cat}:</strong> ${count} items</li>`;
              }).join('')}
            </ul>
          </div>

          ${analysis.criticalIssues.length > 0 ? `
            <div class="critical-alert">
              <div class="critical-title">🚨 Critical Issues Requiring Attention</div>
              <p>These items have low ratings (1-2 stars) or are marked as bugs and should be prioritized:</p>
              ${analysis.criticalIssues.slice(0, 5).map(item => `
                <div class="feedback-item">
                  <div class="feedback-header">
                    <span class="user-info">${item.user_email}</span>
                    <span class="rating">${item.rating ? '⭐'.repeat(item.rating) : 'No rating'}</span>
                  </div>
                  <span class="category-badge category-${item.category}">${item.category}</span>
                  ${item.message ? `<div class="message">${item.message}</div>` : ''}
                  <div class="meta">
                    Page: ${item.page_url || 'Unknown'} |
                    Time: ${new Date(item.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${analysis.commonThemes.length > 0 ? `
            <div class="section">
              <div class="section-title">🎯 Common Themes Detected</div>
              ${analysis.commonThemes.map(theme => `
                <div class="theme-item">
                  <div class="theme-header">
                    <span>${theme.theme.toUpperCase()}</span>
                    <span class="theme-count">${theme.count} mentions</span>
                  </div>
                  <ul style="margin: 10px 0 0 0; padding-left: 20px;">
                    ${theme.items.slice(0, 3).map(item => `
                      <li style="margin: 8px 0;">
                        <strong>${item.user_email}:</strong> "${item.message?.substring(0, 100)}${(item.message?.length || 0) > 100 ? '...' : ''}"
                      </li>
                    `).join('')}
                  </ul>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <div class="section">
            <div class="section-title">📝 All Feedback (Last 24 Hours)</div>
            ${feedback.map(item => `
              <div class="feedback-item">
                <div class="feedback-header">
                  <span class="user-info">${item.user_email}</span>
                  <span class="rating">${item.rating ? '⭐'.repeat(item.rating) : 'No rating'}</span>
                </div>
                <span class="category-badge category-${item.category}">${item.category}</span>
                ${item.message ? `<div class="message">${item.message}</div>` : ''}
                <div class="meta">
                  Page: ${item.page_url || 'Unknown'} |
                  Time: ${new Date(item.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST
                </div>
              </div>
            `).join('')}
          </div>

          <div style="background: #f9fafb; padding: 30px; text-align: center; border-radius: 0 0 12px 12px;">
            <p style="color: #666; margin: 0;">This is an automated daily digest. Feedback is saved in your Supabase database.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

export { handler };
