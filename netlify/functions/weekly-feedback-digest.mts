import type { Context } from "@netlify/functions";
import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = 'jeremy@startupstage.com';
const FROM_EMAIL = 'StageFlow Weekly Digest <support@startupstage.com>';

/**
 * Weekly Feedback Digest
 * Runs every Saturday at 5 AM ET (10 AM UTC)
 * Aggregates and analyzes all feedback from the past week
 */
export default async (req: Request, context: Context) => {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 9: Add authentication to scheduled job (allows internal scheduling)
  if (shouldUseNewAuth('weekly-feedback-digest')) {
    try {
      const authHeader = req.headers.get('Authorization');
      if (authHeader) {
        await requireAuth(req);
      }
      // No auth header = scheduled execution (allowed)
    } catch (authError) {
      return createAuthErrorResponse(authError);
    }
  }
  // LEGACY AUTH PATH: No authentication (allows both manual and scheduled execution)

  console.log('📊 Starting weekly feedback digest generation...');

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase credentials');
    }

    if (!RESEND_API_KEY) {
      throw new Error('Missing Resend API key');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get feedback from past 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: feedback, error } = await supabase
      .from('feedback')
      .select('*')
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch feedback: ${error.message}`);
    }

    console.log(`📬 Found ${feedback?.length || 0} feedback submissions from past 7 days`);

    // If no feedback, send a brief email saying so
    if (!feedback || feedback.length === 0) {
      const html = generateNoFeedbackEmail();
      await sendEmail({
        subject: '📊 Weekly Feedback Digest - No New Feedback This Week',
        html
      });

      return new Response(JSON.stringify({
        success: true,
        message: 'No feedback this week - notification sent'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Analyze feedback
    const analysis = analyzeFeedback(feedback);

    // Generate HTML email
    const html = generateDigestEmail(feedback, analysis);

    // Send email
    await sendEmail({
      subject: `📊 Weekly Feedback Digest - ${feedback.length} Submission${feedback.length === 1 ? '' : 's'} This Week`,
      html
    });

    console.log('✅ Weekly digest sent successfully');

    return new Response(JSON.stringify({
      success: true,
      feedbackCount: feedback.length,
      analysis
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Error generating weekly digest:', error);
    return new Response(JSON.stringify({
      error: 'Failed to generate digest',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

function analyzeFeedback(feedback: any[]) {
  // Group by category
  const byCategory = {
    bug: feedback.filter(f => f.category === 'bug'),
    feature: feedback.filter(f => f.category === 'feature'),
    love: feedback.filter(f => f.category === 'love'),
    confused: feedback.filter(f => f.category === 'confused'),
    other: feedback.filter(f => f.category === 'other' || !f.category)
  };

  // Calculate average rating
  const withRatings = feedback.filter(f => f.rating !== null && f.rating !== undefined);
  const avgRating = withRatings.length > 0
    ? withRatings.reduce((sum, f) => sum + f.rating, 0) / withRatings.length
    : null;

  // Rating distribution
  const ratingDist = {
    5: feedback.filter(f => f.rating === 5).length,
    4: feedback.filter(f => f.rating === 4).length,
    3: feedback.filter(f => f.rating === 3).length,
    2: feedback.filter(f => f.rating === 2).length,
    1: feedback.filter(f => f.rating === 1).length
  };

  // Identify trends (keywords in messages)
  const allMessages = feedback
    .filter(f => f.message)
    .map(f => f.message.toLowerCase())
    .join(' ');

  const keywords = {
    mobile: (allMessages.match(/mobile|iphone|android|responsive/g) || []).length,
    slow: (allMessages.match(/slow|loading|performance|lag/g) || []).length,
    error: (allMessages.match(/error|bug|broken|crash/g) || []).length,
    ui: (allMessages.match(/ui|ux|design|interface/g) || []).length
  };

  // Critical issues (1-2 star ratings with bug category)
  const critical = feedback.filter(f =>
    (f.rating === 1 || f.rating === 2) && f.category === 'bug'
  );

  return {
    byCategory,
    avgRating,
    ratingDist,
    keywords,
    critical,
    totalSubmissions: feedback.length,
    totalWithRatings: withRatings.length
  };
}

function generateDigestEmail(feedback: any[], analysis: any) {
  const { byCategory, avgRating, ratingDist, keywords, critical } = analysis;

  // Generate rating stars
  const ratingStars = avgRating !== null
    ? '⭐'.repeat(Math.round(avgRating)) + '☆'.repeat(5 - Math.round(avgRating))
    : 'No ratings';

  // Identify top issues
  const topKeywords = Object.entries(keywords)
    .sort(([,a], [,b]) => (b as number) - (a as number))
    .slice(0, 3)
    .filter(([,count]) => count > 0);

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background: #f5f5f5;
    }
    .container {
      max-width: 800px;
      margin: 20px auto;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #2C3E50 0%, #1ABC9C 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }
    .header h1 {
      margin: 0 0 10px 0;
      font-size: 28px;
    }
    .header p {
      margin: 0;
      opacity: 0.9;
      font-size: 14px;
    }
    .summary {
      padding: 30px;
      background: #f9f9f9;
      border-bottom: 1px solid #e0e0e0;
    }
    .summary h2 {
      margin: 0 0 20px 0;
      font-size: 20px;
      color: #2C3E50;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .stat-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      border: 1px solid #e0e0e0;
    }
    .stat-value {
      font-size: 32px;
      font-weight: bold;
      color: #1ABC9C;
      margin: 0;
    }
    .stat-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      margin: 5px 0 0 0;
    }
    .section {
      padding: 30px;
      border-bottom: 1px solid #e0e0e0;
    }
    .section h2 {
      margin: 0 0 20px 0;
      font-size: 20px;
      color: #2C3E50;
    }
    .feedback-item {
      background: #f9f9f9;
      padding: 20px;
      border-left: 4px solid #1ABC9C;
      border-radius: 4px;
      margin-bottom: 15px;
    }
    .feedback-item.critical {
      border-left-color: #e74c3c;
      background: #fee;
    }
    .feedback-meta {
      font-size: 12px;
      color: #666;
      margin-bottom: 10px;
    }
    .feedback-message {
      margin: 10px 0;
      white-space: pre-wrap;
    }
    .category-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 8px;
    }
    .badge-bug { background: #fee; color: #c00; }
    .badge-feature { background: #e3f2fd; color: #1976d2; }
    .badge-love { background: #fce4ec; color: #c2185b; }
    .badge-confused { background: #fff8e1; color: #f57c00; }
    .badge-other { background: #f5f5f5; color: #666; }
    .trend-item {
      padding: 10px 15px;
      background: white;
      border-radius: 4px;
      margin-bottom: 10px;
      border: 1px solid #e0e0e0;
    }
    .action-items {
      background: #fff3cd;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .action-items h3 {
      margin: 0 0 15px 0;
      color: #856404;
    }
    .action-items ul {
      margin: 0;
      padding-left: 20px;
    }
    .action-items li {
      color: #856404;
      margin-bottom: 8px;
    }
    .footer {
      padding: 20px;
      background: #f5f5f5;
      text-align: center;
      font-size: 12px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Weekly Feedback Digest</h1>
      <p>Week of ${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString()} - ${new Date().toLocaleDateString()}</p>
    </div>

    <div class="summary">
      <h2>📈 Summary</h2>
      <div class="stats">
        <div class="stat-card">
          <p class="stat-value">${feedback.length}</p>
          <p class="stat-label">Total Submissions</p>
        </div>
        <div class="stat-card">
          <p class="stat-value">${avgRating !== null ? avgRating.toFixed(1) : 'N/A'}</p>
          <p class="stat-label">Avg Rating</p>
        </div>
        <div class="stat-card">
          <p class="stat-value">${byCategory.bug.length}</p>
          <p class="stat-label">🐛 Bugs</p>
        </div>
        <div class="stat-card">
          <p class="stat-value">${byCategory.feature.length}</p>
          <p class="stat-label">💡 Features</p>
        </div>
        <div class="stat-card">
          <p class="stat-value">${critical.length}</p>
          <p class="stat-label">🔴 Critical</p>
        </div>
      </div>

      ${avgRating !== null ? `
        <div style="margin: 20px 0;">
          <strong>Rating Distribution:</strong><br>
          5⭐: ${'★'.repeat(ratingDist[5])}${'☆'.repeat(Math.max(0, 10 - ratingDist[5]))} (${ratingDist[5]})<br>
          4⭐: ${'★'.repeat(ratingDist[4])}${'☆'.repeat(Math.max(0, 10 - ratingDist[4]))} (${ratingDist[4]})<br>
          3⭐: ${'★'.repeat(ratingDist[3])}${'☆'.repeat(Math.max(0, 10 - ratingDist[3]))} (${ratingDist[3]})<br>
          2⭐: ${'★'.repeat(ratingDist[2])}${'☆'.repeat(Math.max(0, 10 - ratingDist[2]))} (${ratingDist[2]})<br>
          1⭐: ${'★'.repeat(ratingDist[1])}${'☆'.repeat(Math.max(0, 10 - ratingDist[1]))} (${ratingDist[1]})
        </div>
      ` : ''}

      ${topKeywords.length > 0 ? `
        <div style="margin: 20px 0;">
          <strong>🔍 Top Trends:</strong><br>
          ${topKeywords.map(([keyword, count]) => `
            <div class="trend-item">
              <strong>${keyword.charAt(0).toUpperCase() + keyword.slice(1)}:</strong> mentioned ${count} time${count === 1 ? '' : 's'}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>

    ${critical.length > 0 ? `
      <div class="section">
        <h2>🔴 Critical Issues (Immediate Attention Required)</h2>
        ${critical.map(item => `
          <div class="feedback-item critical">
            <div class="feedback-meta">
              <span class="category-badge badge-bug">🐛 ${item.category}</span>
              <strong>${item.user_email}</strong> • ${new Date(item.created_at).toLocaleDateString()}
              ${item.rating ? ` • ${' ⭐'.repeat(item.rating)}` : ''}
            </div>
            ${item.message ? `<div class="feedback-message">${escapeHtml(item.message)}</div>` : ''}
            <div class="feedback-meta" style="margin-top: 10px;">
              Page: ${item.page_url || 'Unknown'}
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${byCategory.bug.length > 0 ? `
      <div class="section">
        <h2>🐛 Bug Reports (${byCategory.bug.length})</h2>
        ${byCategory.bug.slice(0, 10).map(item => `
          <div class="feedback-item">
            <div class="feedback-meta">
              <span class="category-badge badge-bug">🐛 Bug</span>
              <strong>${item.user_email}</strong> • ${new Date(item.created_at).toLocaleDateString()}
              ${item.rating ? ` • ${'⭐'.repeat(item.rating)}` : ''}
            </div>
            ${item.message ? `<div class="feedback-message">${escapeHtml(item.message)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${byCategory.feature.length > 0 ? `
      <div class="section">
        <h2>💡 Feature Requests (${byCategory.feature.length})</h2>
        ${byCategory.feature.map(item => `
          <div class="feedback-item">
            <div class="feedback-meta">
              <span class="category-badge badge-feature">💡 Feature</span>
              <strong>${item.user_email}</strong> • ${new Date(item.created_at).toLocaleDateString()}
              ${item.rating ? ` • ${'⭐'.repeat(item.rating)}` : ''}
            </div>
            ${item.message ? `<div class="feedback-message">${escapeHtml(item.message)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${byCategory.love.length > 0 ? `
      <div class="section">
        <h2>❤️ Positive Feedback (${byCategory.love.length})</h2>
        ${byCategory.love.map(item => `
          <div class="feedback-item">
            <div class="feedback-meta">
              <span class="category-badge badge-love">❤️ Love</span>
              <strong>${item.user_email}</strong> • ${new Date(item.created_at).toLocaleDateString()}
              ${item.rating ? ` • ${'⭐'.repeat(item.rating)}` : ''}
            </div>
            ${item.message ? `<div class="feedback-message">${escapeHtml(item.message)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="section">
      <h2>🎯 Recommended Actions</h2>
      <div class="action-items">
        <h3>⚡ This Week's Priority:</h3>
        <ul>
          ${critical.length > 0 ? `<li><strong>Address ${critical.length} critical issue${critical.length === 1 ? '' : 's'}</strong> (1-2 star ratings with bugs)</li>` : ''}
          ${byCategory.bug.length > 2 ? `<li>Investigate ${byCategory.bug.length} bug reports - look for patterns</li>` : ''}
          ${keywords.mobile > 1 ? `<li>Mobile responsiveness mentioned ${keywords.mobile} times - needs QA</li>` : ''}
          ${keywords.slow > 1 ? `<li>Performance concerns mentioned ${keywords.slow} times - monitor metrics</li>` : ''}
          ${byCategory.feature.length > 0 ? `<li>Review ${byCategory.feature.length} feature request${byCategory.feature.length === 1 ? '' : 's'} for product roadmap</li>` : ''}
          <li>Run: <code>node scripts/verify-feedback-issues.mjs</code> to check current status</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <p>📊 Weekly Feedback Digest • Generated automatically every Saturday at 5 AM ET</p>
      <p>View detailed reports: FEEDBACK_REPORT.json | FEEDBACK_ISSUES_STATUS.json</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

function generateNoFeedbackEmail() {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #2C3E50 0%, #1ABC9C 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }
    .content {
      padding: 40px;
      text-align: center;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Weekly Feedback Digest</h1>
      <p>${new Date().toLocaleDateString()}</p>
    </div>
    <div class="content">
      <div class="icon">📭</div>
      <h2>No New Feedback This Week</h2>
      <p>There were no feedback submissions in the past 7 days.</p>
      <p style="color: #666; font-size: 14px; margin-top: 20px;">
        This digest is automatically generated every Saturday at 5 AM ET
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

async function sendEmail({ subject, html }: { subject: string; html: string }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject,
        html
      })
    });

    clearTimeout(timeoutId);

    const result = await response.json();

    if (!response.ok) {
      throw new Error(`Resend API error: ${JSON.stringify(result)}`);
    }

    console.log('✅ Email sent successfully:', result.id);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\n/g, '<br>');
}

export const config = {
  schedule: "0 10 * * 6" // Every Saturday at 10:00 AM UTC (5 AM ET)
};
