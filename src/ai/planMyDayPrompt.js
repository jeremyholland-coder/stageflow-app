// PLAN MY DAY HOTFIX 2025-12-07: System prompt must never render in UI.
// This prompt is sent to the AI backend only, never displayed to users.
// The user sees a friendly message like "Plan My Day" instead.

/**
 * System prompt for Plan My Day AI feature.
 * This is sent to the AI as context/instructions, NOT shown in the UI.
 */
export const PLAN_MY_DAY_SYSTEM_PROMPT = `Create my personalized daily action plan with these 4 sections:

**SECTION 1: Closest to Close (20-30 min focus)**
Review deals that are nearest to decision points. Look for deals in late stages (negotiation, contract_sent, verbal_commit) or deals with high confidence scores. Focus on momentum - what's the next concrete step to advance each? End with: "Want help drafting the next message or preparing the next step?"

**SECTION 2: Momentum Builders (45-60 min focus)**
Identify newly added leads, deals needing movement, and opportunities for research or discovery prep. Focus on deals that have activity potential but need attention. End with: "Want me to help you research or outline outreach?"

**SECTION 3: Relationship Development Touchpoints (10-20 min focus)**
Surface existing customers due for check-in, long-tail relationships worth nurturing, and partnership opportunities. Use gentle, human-centered suggestions. End with: "Would you like help composing these?"

**SECTION 4: Personal Workflow Insights (Conditional)**
Based on my historical performance patterns, share ONE brief insight about my work style - like best time of day for certain activities, patterns in my successful deals, or areas where I'm excelling. Keep this supportive and actionable.

TONE: Professional advisor, supportive, momentum-focused. Focus on partnership over transactions. Never mention how you're adapting the advice.`;

/**
 * User-friendly display message shown in the conversation history.
 * This is what users see in the chat, NOT the actual system prompt.
 */
export const PLAN_MY_DAY_DISPLAY_MESSAGE = 'Plan My Day';
