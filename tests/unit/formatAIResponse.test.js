/**
 * Unit tests for format-ai-response utilities
 * @file tests/unit/formatAIResponse.test.js
 */

import { describe, it, expect } from 'vitest';
import { cleanToolCalls } from '../../src/lib/format-ai-response';

describe('formatAIResponse', () => {
  describe('cleanToolCalls', () => {
    it('should remove code blocks with executeToolAndReturnAsAgent', () => {
      const input = `
Some text before

\`\`\`js
executeToolAndReturnAsAgent('test', {})
\`\`\`

Some text after
`;
      const result = cleanToolCalls(input);
      expect(result).not.toContain('executeToolAndReturnAsAgent');
      expect(result).toContain('Some text before');
      expect(result).toContain('Some text after');
    });

    it('should remove standalone tool call patterns', () => {
      const input = 'Before executeToolAndReturnAsAgent(args) after';
      const result = cleanToolCalls(input);
      expect(result).not.toContain('executeToolAndReturnAsAgent');
    });

    it('should remove SECTION markers', () => {
      const input = '**SECTION 1: Closest to Close**\nContent here';
      const result = cleanToolCalls(input);
      expect(result).not.toContain('SECTION 1:');
    });

    it('should remove TONE instructions', () => {
      const input = 'Content here\nTONE: Be professional and supportive.\nMore content';
      const result = cleanToolCalls(input);
      expect(result).not.toContain('TONE:');
    });

    it('should remove time focus markers', () => {
      const input = 'Review deals (20-30 min focus)';
      const result = cleanToolCalls(input);
      expect(result).not.toContain('20-30 min focus');
    });

    it('should remove conditional markers', () => {
      const input = 'Personal workflow insights (Conditional)';
      const result = cleanToolCalls(input);
      expect(result).not.toContain('Conditional');
    });

    it('should clean up extra whitespace', () => {
      const input = 'Line 1\n\n\n\n\nLine 2';
      const result = cleanToolCalls(input);
      // Should have at most 2 newlines in a row
      expect(result).not.toMatch(/\n{3,}/);
    });

    it('should handle empty input', () => {
      expect(cleanToolCalls('')).toBe('');
      expect(cleanToolCalls(null)).toBe('');
      expect(cleanToolCalls(undefined)).toBe('');
    });

    it('should preserve normal content', () => {
      const input = `
# Closest to Close

1. Acme Corp - $50,000 - Ready to sign
2. Tech Inc - $30,000 - Final negotiation

## Momentum Builders

- New lead from marketing campaign
- Follow up with warm prospect
`;
      const result = cleanToolCalls(input);
      expect(result).toContain('Acme Corp');
      expect(result).toContain('$50,000');
      expect(result).toContain('New lead');
    });
  });
});

describe('Plan My Day Response Cleaning', () => {
  it('should handle a full Plan My Day response with prompt leakage', () => {
    const input = `
**SECTION 1: Closest to Close (20-30 min focus)**

Review these priority deals:
- Acme Corp ($50K) - Ready for final call
- Tech Inc ($30K) - Awaiting signature

End with: "Want help drafting the next message?"

**SECTION 2: Momentum Builders (45-60 min focus)**

Check on new leads from webinar.
Marketing qualified lead needs outreach.

TONE: Professional advisor, supportive, momentum-focused.
Never mention how you're adapting the advice.
`;

    const result = cleanToolCalls(input);

    // Should NOT contain prompt leakage
    expect(result).not.toContain('SECTION 1:');
    expect(result).not.toContain('SECTION 2:');
    expect(result).not.toContain('20-30 min focus');
    expect(result).not.toContain('45-60 min focus');
    expect(result).not.toContain('TONE:');
    expect(result).not.toContain('Never mention');

    // SHOULD contain meaningful content
    expect(result).toContain('Acme Corp');
    expect(result).toContain('$50K');
    expect(result).toContain('new leads');
    expect(result).toContain('Marketing qualified');
  });
});
