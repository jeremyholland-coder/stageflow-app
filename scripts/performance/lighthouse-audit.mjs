#!/usr/bin/env node
/**
 * Lighthouse Performance Audit Script
 *
 * Runs Lighthouse audits against StageFlow pages and generates reports.
 *
 * Usage:
 *   node scripts/performance/lighthouse-audit.mjs
 *   node scripts/performance/lighthouse-audit.mjs --url=http://localhost:3000
 *
 * Requirements:
 *   npm install -g lighthouse
 *   or: npx lighthouse
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'https://stageflow.startupstage.com';
const OUTPUT_DIR = path.join(__dirname, '../../test-results/lighthouse');

// Pages to audit
const PAGES = [
  { name: 'login', path: '/', description: 'Login Page' },
  // Note: Dashboard requires auth - use puppeteer/lighthouse programmatic API for auth
  // { name: 'dashboard', path: '/', description: 'Dashboard' },
  // { name: 'settings', path: '/?view=settings', description: 'Settings Page' },
];

// Lighthouse configuration
const LIGHTHOUSE_FLAGS = [
  '--output=json',
  '--output=html',
  '--chrome-flags="--headless"',
  '--throttling-method=simulate',
  '--preset=desktop',
];

async function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

async function runLighthouse(url, outputPath, flags = []) {
  return new Promise((resolve, reject) => {
    const args = [
      url,
      `--output-path=${outputPath}`,
      ...LIGHTHOUSE_FLAGS,
      ...flags,
    ];

    console.log(`Running: npx lighthouse ${args.join(' ')}`);

    const lighthouse = spawn('npx', ['lighthouse', ...args], {
      stdio: 'inherit',
      shell: true,
    });

    lighthouse.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Lighthouse exited with code ${code}`));
      }
    });

    lighthouse.on('error', (err) => {
      reject(err);
    });
  });
}

function parseResults(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    console.warn(`Results file not found: ${jsonPath}`);
    return null;
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  return {
    performance: Math.round(data.categories.performance.score * 100),
    accessibility: Math.round(data.categories.accessibility.score * 100),
    bestPractices: Math.round(data.categories['best-practices'].score * 100),
    seo: Math.round(data.categories.seo.score * 100),
    metrics: {
      firstContentfulPaint: data.audits['first-contentful-paint'].displayValue,
      largestContentfulPaint: data.audits['largest-contentful-paint'].displayValue,
      totalBlockingTime: data.audits['total-blocking-time'].displayValue,
      cumulativeLayoutShift: data.audits['cumulative-layout-shift'].displayValue,
      speedIndex: data.audits['speed-index'].displayValue,
      timeToInteractive: data.audits['interactive'].displayValue,
    },
    opportunities: data.audits
      ? Object.values(data.audits)
          .filter((audit) => audit.details?.type === 'opportunity' && audit.score < 1)
          .map((audit) => ({
            title: audit.title,
            description: audit.description,
            savings: audit.details?.overallSavingsMs,
          }))
          .sort((a, b) => (b.savings || 0) - (a.savings || 0))
          .slice(0, 5)
      : [],
  };
}

function generateReport(results) {
  const timestamp = new Date().toISOString();

  let report = `
# StageFlow Lighthouse Performance Report
Generated: ${timestamp}
Base URL: ${BASE_URL}

## Summary

| Page | Performance | Accessibility | Best Practices | SEO |
|------|-------------|---------------|----------------|-----|
`;

  for (const [pageName, data] of Object.entries(results)) {
    if (data) {
      report += `| ${pageName} | ${data.performance} | ${data.accessibility} | ${data.bestPractices} | ${data.seo} |\n`;
    }
  }

  report += `\n## Detailed Metrics\n`;

  for (const [pageName, data] of Object.entries(results)) {
    if (data) {
      report += `
### ${pageName}

| Metric | Value |
|--------|-------|
| First Contentful Paint | ${data.metrics.firstContentfulPaint} |
| Largest Contentful Paint | ${data.metrics.largestContentfulPaint} |
| Total Blocking Time | ${data.metrics.totalBlockingTime} |
| Cumulative Layout Shift | ${data.metrics.cumulativeLayoutShift} |
| Speed Index | ${data.metrics.speedIndex} |
| Time to Interactive | ${data.metrics.timeToInteractive} |

#### Top Improvement Opportunities

`;
      if (data.opportunities.length > 0) {
        for (const opp of data.opportunities) {
          const savings = opp.savings ? ` (~${Math.round(opp.savings)}ms)` : '';
          report += `- **${opp.title}**${savings}\n`;
        }
      } else {
        report += `- No significant opportunities found.\n`;
      }
    }
  }

  return report;
}

async function main() {
  console.log('=== StageFlow Lighthouse Audit ===\n');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  await ensureOutputDir();

  const results = {};

  for (const page of PAGES) {
    const url = `${BASE_URL}${page.path}`;
    const outputPath = path.join(OUTPUT_DIR, page.name);

    console.log(`\nAuditing: ${page.description} (${url})`);

    try {
      await runLighthouse(url, outputPath);

      // Parse JSON results
      const jsonPath = `${outputPath}.report.json`;
      results[page.name] = parseResults(jsonPath);

      if (results[page.name]) {
        console.log(`  Performance: ${results[page.name].performance}`);
        console.log(`  Accessibility: ${results[page.name].accessibility}`);
      }
    } catch (error) {
      console.error(`  Error: ${error.message}`);
      results[page.name] = null;
    }
  }

  // Generate summary report
  const report = generateReport(results);
  const reportPath = path.join(OUTPUT_DIR, 'lighthouse-report.md');
  fs.writeFileSync(reportPath, report);

  console.log(`\n=== Audit Complete ===`);
  console.log(`Report: ${reportPath}`);
  console.log(`HTML reports in: ${OUTPUT_DIR}`);
}

// Run if called directly
main().catch((err) => {
  console.error('Lighthouse audit failed:', err);
  process.exit(1);
});
