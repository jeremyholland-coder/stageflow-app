// Email template utilities for StageFlow notifications

export const getEmailTemplate = (type: string, data: any): { subject: string; html: string } => {
  const baseStyles = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f9fafb; }
      .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
      .header { background: linear-gradient(135deg, #1ABC9C 0%, #3A86FF 100%); padding: 32px; text-align: center; }
      .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
      .content { padding: 32px; }
      .deal-card { background: #f9fafb; border-radius: 12px; padding: 20px; margin: 20px 0; border-left: 4px solid #1ABC9C; }
      .deal-name { font-size: 20px; font-weight: bold; color: #1a1a1a; margin-bottom: 8px; }
      .deal-value { font-size: 24px; font-weight: bold; color: #1ABC9C; margin: 12px 0; }
      .stage-badge { display: inline-block; padding: 6px 12px; background: #1ABC9C; color: white; border-radius: 6px; font-size: 14px; font-weight: 600; }
      .button { display: inline-block; background: linear-gradient(135deg, #1ABC9C 0%, #3A86FF 100%); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0; }
      .footer { background: #f9fafb; padding: 24px; text-align: center; color: #6b7280; font-size: 14px; }
      .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 20px 0; }
    </style>
  `;

  switch (type) {
    case 'deal_created':
      return {
        subject: `🎯 New Deal: ${data.clientName}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>${baseStyles}</head>
          <body>
            <div class="container">
              <div class="header">
                <h1>📊 StageFlow CRM</h1>
              </div>
              <div class="content">
                <h2>New Deal Created</h2>
                <p>A new deal has been added to your pipeline.</p>
                <div class="deal-card">
                  <div class="deal-name">${data.clientName}</div>
                  <div style="color: #6b7280; margin-bottom: 12px;">${data.email}</div>
                  <div class="deal-value">$${data.value.toLocaleString()}</div>
                  <span class="stage-badge">${data.stage}</span>
                </div>
                <a href="${data.dealUrl}" class="button">View Deal</a>
              </div>
              <div class="footer">
                <p>StageFlow CRM - Manage your pipeline with ease</p>
                <p><a href="${data.settingsUrl}" style="color: #1ABC9C;">Manage notification preferences</a></p>
              </div>
            </div>
          </body>
          </html>
        `
      };

    case 'stage_changed':
      return {
        subject: `📈 Deal Moved: ${data.clientName} → ${data.toStage}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>${baseStyles}</head>
          <body>
            <div class="container">
              <div class="header">
                <h1>📊 StageFlow CRM</h1>
              </div>
              <div class="content">
                <h2>Deal Stage Updated</h2>
                <div class="deal-card">
                  <div class="deal-name">${data.clientName}</div>
                  <div style="color: #6b7280; margin: 8px 0;">
                    <strong>${data.fromStage}</strong> → <strong style="color: #1ABC9C;">${data.toStage}</strong>
                  </div>
                  <div class="deal-value">$${data.value.toLocaleString()}</div>
                </div>
                <a href="${data.dealUrl}" class="button">View Deal</a>
              </div>
              <div class="footer">
                <p>StageFlow CRM - Manage your pipeline with ease</p>
                <p><a href="${data.settingsUrl}" style="color: #1ABC9C;">Manage notification preferences</a></p>
              </div>
            </div>
          </body>
          </html>
        `
      };

    case 'deal_won':
      return {
        subject: `🎉 Deal Won: ${data.clientName} - $${data.value.toLocaleString()}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>${baseStyles}</head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎉 Congratulations!</h1>
              </div>
              <div class="content">
                <h2>Deal Closed Successfully</h2>
                <p>You've won a new deal! 🎊</p>
                <div class="deal-card">
                  <div class="deal-name">${data.clientName}</div>
                  <div class="deal-value">$${data.value.toLocaleString()}</div>
                  <p style="color: #6b7280; margin-top: 12px;">Time to close: ${data.daysToClose} days</p>
                </div>
                <a href="${data.dealUrl}" class="button">View Deal</a>
              </div>
              <div class="footer">
                <p>StageFlow CRM - Manage your pipeline with ease</p>
                <p><a href="${data.settingsUrl}" style="color: #1ABC9C;">Manage notification preferences</a></p>
              </div>
            </div>
          </body>
          </html>
        `
      };

    case 'deal_lost':
      return {
        subject: `Deal Update: ${data.clientName}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>${baseStyles}</head>
          <body>
            <div class="container">
              <div class="header">
                <h1>📊 StageFlow CRM</h1>
              </div>
              <div class="content">
                <h2>Deal Marked as Lost</h2>
                <div class="deal-card">
                  <div class="deal-name">${data.clientName}</div>
                  <div class="deal-value">$${data.value.toLocaleString()}</div>
                  ${data.reason ? `<p style="color: #6b7280; margin-top: 12px;">Reason: ${data.reason}</p>` : ''}
                </div>
                <p>Review this deal to understand what happened and improve future opportunities.</p>
                <a href="${data.dealUrl}" class="button">View Deal</a>
              </div>
              <div class="footer">
                <p>StageFlow CRM - Manage your pipeline with ease</p>
                <p><a href="${data.settingsUrl}" style="color: #1ABC9C;">Manage notification preferences</a></p>
              </div>
            </div>
          </body>
          </html>
        `
      };

    case 'stagnation_alert':
      return {
        subject: `⚠️ Stagnant Deal Alert: ${data.clientName}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>${baseStyles}</head>
          <body>
            <div class="container">
              <div class="header">
                <h1>⚠️ Action Required</h1>
              </div>
              <div class="content">
                <h2>Deal Needs Attention</h2>
                <div class="alert">
                  <strong>This deal has been stagnant for ${data.daysInStage} days</strong>
                </div>
                <div class="deal-card">
                  <div class="deal-name">${data.clientName}</div>
                  <div style="color: #6b7280; margin: 8px 0;">
                    Stage: <strong>${data.stage}</strong> (${data.daysInStage} days)
                  </div>
                  <div class="deal-value">$${data.value.toLocaleString()}</div>
                </div>
                <p>Consider reaching out to move this deal forward or update its status.</p>
                <a href="${data.dealUrl}" class="button">Take Action</a>
              </div>
              <div class="footer">
                <p>StageFlow CRM - Manage your pipeline with ease</p>
                <p><a href="${data.settingsUrl}" style="color: #1ABC9C;">Manage notification preferences</a></p>
              </div>
            </div>
          </body>
          </html>
        `
      };

    case 'weekly_digest':
      return {
        subject: `📊 Weekly Pipeline Report - ${data.weekOf}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>${baseStyles}</head>
          <body>
            <div class="container">
              <div class="header">
                <h1>📊 Weekly Pipeline Report</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 8px 0;">Week of ${data.weekOf}</p>
              </div>
              <div class="content">
                <h2>Pipeline Overview</h2>
                
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 24px 0;">
                  <div style="text-align: center; padding: 16px; background: #f9fafb; border-radius: 12px;">
                    <div style="font-size: 28px; font-weight: bold; color: #1ABC9C;">$${data.totalPipeline.toLocaleString()}</div>
                    <div style="color: #6b7280; font-size: 14px;">Total Pipeline</div>
                  </div>
                  <div style="text-align: center; padding: 16px; background: #f9fafb; border-radius: 12px;">
                    <div style="font-size: 28px; font-weight: bold; color: #1ABC9C;">${data.activeDeals}</div>
                    <div style="color: #6b7280; font-size: 14px;">Active Deals</div>
                  </div>
                  <div style="text-align: center; padding: 16px; background: #f9fafb; border-radius: 12px;">
                    <div style="font-size: 28px; font-weight: bold; color: #1ABC9C;">${data.dealsWon}</div>
                    <div style="color: #6b7280; font-size: 14px;">Deals Won</div>
                  </div>
                </div>

                ${data.stagnantDeals?.length > 0 ? `
                  <div class="alert">
                    <h3 style="margin-top: 0;">⚠️ Stagnant Deals (${data.stagnantDeals.length})</h3>
                    ${data.stagnantDeals.map((deal: any) => `
                      <div style="margin: 12px 0;">
                        <strong>${deal.client}</strong> - ${deal.stage} (${deal.days} days)
                      </div>
                    `).join('')}
                  </div>
                ` : ''}

                <h3>Time Metrics</h3>
                <ul style="line-height: 2;">
                  <li>Average time to close: <strong>${data.avgTimeToClose} days</strong></li>
                  <li>Fastest close this week: <strong>${data.fastestClose} days</strong></li>
                  ${data.slowestStage ? `<li>Slowest stage: <strong>${data.slowestStage} (${data.slowestStageDays} days avg)</strong></li>` : ''}
                </ul>

                <a href="${data.dashboardUrl}" class="button">View Full Dashboard</a>
              </div>
              <div class="footer">
                <p>StageFlow CRM - Manage your pipeline with ease</p>
                <p><a href="${data.settingsUrl}" style="color: #1ABC9C;">Manage notification preferences</a></p>
              </div>
            </div>
          </body>
          </html>
        `
      };

    default:
      return {
        subject: 'StageFlow Notification',
        html: '<p>Notification from StageFlow CRM</p>'
      };
  }
};
