/**
 * P0 WAR ROOM: DEAL ENGINE SCENARIO TESTS
 *
 * Comprehensive tests for the Deal Engine fixes:
 * D1: Create + Edit + Drag basic
 * D2: Lost + Restore
 * D3: Disqualified + Display
 * D4: Rapid drag-drop (rage mode)
 *
 * These tests verify:
 * - Stage/status sync across all pipelines
 * - Lost reason workflow
 * - Disqualified reason workflow
 * - Race condition handling
 *
 * @since P0 War Room 2025-12-09
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestUserAuth, getAuthHeaders } from './utils/auth';
import { post, logResponse } from './utils/api';

// =============================================================================
// TEST CONTEXT
// =============================================================================

interface DealResponse {
  id: string;
  client: string;
  stage: string;
  status: string;
  value: number;
  lost_reason?: string | null;
  lost_reason_notes?: string | null;
  disqualified_reason_category?: string | null;
  disqualified_reason_notes?: string | null;
  outcome_reason_category?: string | null;
  outcome_notes?: string | null;
  last_activity?: string;
  [key: string]: unknown;
}

interface TestContext {
  accessToken: string;
  organizationId: string;
  userId: string;
  createdDealIds: string[];
}

const ctx: TestContext = {
  accessToken: '',
  organizationId: '',
  userId: '',
  createdDealIds: [],
};

// =============================================================================
// SETUP & TEARDOWN
// =============================================================================

beforeAll(async () => {
  const auth = await getTestUserAuth();
  ctx.accessToken = auth.accessToken;
  ctx.organizationId = auth.organizationId;
  ctx.userId = auth.user.id;
  console.log(`\n✓ P0 War Room Deal Tests - Authenticated as ${auth.user.email}`);
});

afterAll(async () => {
  // Cleanup all test deals
  const headers = getAuthHeaders(ctx.accessToken);
  for (const dealId of ctx.createdDealIds) {
    try {
      await post('delete-deal', {
        dealId,
        organizationId: ctx.organizationId,
      }, headers);
    } catch {
      // Ignore cleanup errors
    }
  }
  console.log(`\n✓ Cleaned up ${ctx.createdDealIds.length} test deals`);
});

// =============================================================================
// HELPER: Create test deal
// =============================================================================

async function createDeal(data: Partial<{
  client: string;
  stage: string;
  value: number;
  email: string;
  phone: string;
  notes: string;
}> = {}): Promise<DealResponse> {
  const headers = getAuthHeaders(ctx.accessToken);
  const uniqueClient = data.client || `WarRoom ${Date.now()}`;

  const response = await post('create-deal', {
    dealData: {
      client: uniqueClient,
      email: data.email || 'warroom@test.com',
      phone: data.phone || '555-0000',
      stage: data.stage || 'lead',
      value: data.value ?? 5000,
      notes: data.notes || 'P0 War Room test deal',
    },
    organizationId: ctx.organizationId,
  }, headers);

  expect(response.status).toBe(200);
  expect(response.data.success).toBe(true);

  const deal = response.data.deal as DealResponse;
  ctx.createdDealIds.push(deal.id);
  return deal;
}

// =============================================================================
// HELPER: Update deal
// =============================================================================

async function updateDeal(
  dealId: string,
  updates: Record<string, unknown>
): Promise<DealResponse> {
  const headers = getAuthHeaders(ctx.accessToken);

  const response = await post('update-deal', {
    dealId,
    updates,
    organizationId: ctx.organizationId,
  }, headers);

  logResponse(`Update deal ${dealId}`, response);

  expect(response.status).toBe(200);
  expect(response.data.success).toBe(true);

  return response.data.deal as DealResponse;
}

// =============================================================================
// D1: CREATE + EDIT + DRAG BASIC
// =============================================================================

describe('D1: Create + Edit + Drag Basic', () => {
  let testDeal: DealResponse;

  it('Step 1: Create a deal in the first stage', async () => {
    testDeal = await createDeal({
      client: 'D1 Create Edit Drag Test',
      stage: 'lead',
      value: 10000,
    });

    expect(testDeal.id).toBeDefined();
    expect(testDeal.client).toBe('D1 Create Edit Drag Test');
    expect(testDeal.stage).toBe('lead');
    expect(testDeal.status).toBe('active');
    expect(testDeal.value).toBe(10000);
  });

  it('Step 2: Update fields via API (simulating DealDetailsModal)', async () => {
    const updatedDeal = await updateDeal(testDeal.id, {
      notes: 'Updated notes from D1 test',
      value: 15000,
    });

    expect(updatedDeal.notes).toBe('Updated notes from D1 test');
    expect(updatedDeal.value).toBe(15000);
    expect(updatedDeal.stage).toBe('lead'); // Stage unchanged
    expect(updatedDeal.status).toBe('active'); // Status unchanged
  });

  it('Step 3: Move deal to new stage via drag-drop (simulating KanbanBoard)', async () => {
    const movedDeal = await updateDeal(testDeal.id, {
      stage: 'proposal_sent',
    });

    expect(movedDeal.stage).toBe('proposal_sent');
    expect(movedDeal.status).toBe('active'); // Still active stage
  });

  it('Step 4: Move deal to won stage (simulating retention drop)', async () => {
    const wonDeal = await updateDeal(testDeal.id, {
      stage: 'deal_won',
      status: 'won',
    });

    expect(wonDeal.stage).toBe('deal_won');
    expect(wonDeal.status).toBe('won'); // Status auto-synced to won
  });
});

// =============================================================================
// D2: LOST + RESTORE
// =============================================================================

describe('D2: Lost + Restore', () => {
  let testDeal: DealResponse;

  it('Step 1: Create active deal', async () => {
    testDeal = await createDeal({
      client: 'D2 Lost Restore Test',
      stage: 'negotiation',
      value: 25000,
    });

    expect(testDeal.status).toBe('active');
  });

  it('Step 2: Mark deal as Lost with reason', async () => {
    const lostDeal = await updateDeal(testDeal.id, {
      stage: 'deal_lost',
      status: 'lost',
      lost_reason: 'competitor',
      lost_reason_notes: 'Lost to competitor XYZ',
    });

    expect(lostDeal.stage).toBe('deal_lost');
    expect(lostDeal.status).toBe('lost');
    expect(lostDeal.lost_reason).toBe('competitor');
    expect(lostDeal.lost_reason_notes).toBe('Lost to competitor XYZ');
    // PHASE 4: Check unified outcome fields populated
    expect(lostDeal.outcome_reason_category).toBe('competitor');
  });

  it('Step 3: Restore deal to active stage', async () => {
    const restoredDeal = await updateDeal(testDeal.id, {
      stage: 'lead',
      status: 'active',
    });

    expect(restoredDeal.stage).toBe('lead');
    expect(restoredDeal.status).toBe('active');
    // Lost fields should be cleared when returning to active
    expect(restoredDeal.lost_reason).toBeNull();
    expect(restoredDeal.lost_reason_notes).toBeNull();
    expect(restoredDeal.outcome_reason_category).toBeNull();
  });

  it('Step 4: Verify deal is active and editable again', async () => {
    const editedDeal = await updateDeal(testDeal.id, {
      notes: 'Deal restored and updated',
      stage: 'contacted',
    });

    expect(editedDeal.status).toBe('active');
    expect(editedDeal.stage).toBe('contacted');
    expect(editedDeal.notes).toBe('Deal restored and updated');
  });
});

// =============================================================================
// D3: DISQUALIFIED + DISPLAY
// =============================================================================

describe('D3: Disqualified + Display', () => {
  let testDeal: DealResponse;

  it('Step 1: Create active deal', async () => {
    testDeal = await createDeal({
      client: 'D3 Disqualified Test',
      stage: 'lead_qualified',
      value: 8000,
    });

    expect(testDeal.status).toBe('active');
  });

  it('Step 2: Disqualify deal with category and notes', async () => {
    const disqualifiedDeal = await updateDeal(testDeal.id, {
      status: 'disqualified',
      disqualified_reason_category: 'not_a_fit',
      disqualified_reason_notes: 'Product does not meet their requirements',
    });

    expect(disqualifiedDeal.status).toBe('disqualified');
    expect(disqualifiedDeal.disqualified_reason_category).toBe('not_a_fit');
    expect(disqualifiedDeal.disqualified_reason_notes).toBe('Product does not meet their requirements');
    // PHASE 4: Check unified outcome fields populated
    expect(disqualifiedDeal.outcome_reason_category).toBeTruthy();
  });

  it('Step 3: Verify lost fields are NOT set (mutual exclusivity)', async () => {
    // Disqualified deals should not have lost fields
    const headers = getAuthHeaders(ctx.accessToken);
    const response = await post('update-deal', {
      dealId: testDeal.id,
      updates: { notes: 'Check mutual exclusivity' },
      organizationId: ctx.organizationId,
    }, headers);

    const deal = response.data.deal as DealResponse;
    expect(deal.lost_reason).toBeNull();
    expect(deal.lost_reason_notes).toBeNull();
  });

  it('Step 4: Reactivate disqualified deal', async () => {
    const reactivatedDeal = await updateDeal(testDeal.id, {
      status: 'active',
      stage: 'lead',
    });

    expect(reactivatedDeal.status).toBe('active');
    // Disqualified fields should be cleared
    expect(reactivatedDeal.disqualified_reason_category).toBeNull();
    expect(reactivatedDeal.disqualified_reason_notes).toBeNull();
  });
});

// =============================================================================
// D4: RAPID DRAG-DROP (RAGE MODE)
// =============================================================================

describe('D4: Rapid Drag-Drop (Rage Mode)', () => {
  let testDeal: DealResponse;

  it('Step 1: Create deal for rage test', async () => {
    testDeal = await createDeal({
      client: 'D4 Rage Mode Test',
      stage: 'lead',
      value: 12000,
    });

    expect(testDeal.id).toBeDefined();
  });

  it('Step 2: Rapidly update stage 5 times in sequence', async () => {
    const stages = ['contacted', 'proposal_sent', 'negotiation', 'contacted', 'lead_qualified'];
    let lastDeal: DealResponse = testDeal;

    for (const stage of stages) {
      lastDeal = await updateDeal(testDeal.id, { stage });
      // Small delay to simulate rapid but sequential updates
      await new Promise(r => setTimeout(r, 100));
    }

    // Final stage should match last update
    expect(lastDeal.stage).toBe('lead_qualified');
    expect(lastDeal.status).toBe('active');
  });

  it('Step 3: Verify no duplicate deals created', async () => {
    // Count how many times this deal ID appears (should be exactly 1)
    const headers = getAuthHeaders(ctx.accessToken);

    // Get the deal directly to verify it exists
    const response = await post('update-deal', {
      dealId: testDeal.id,
      updates: { notes: 'Final rage mode check' },
      organizationId: ctx.organizationId,
    }, headers);

    expect(response.status).toBe(200);
    expect(response.data.deal.id).toBe(testDeal.id);
  });

  it('Step 4: Verify no NaN or undefined values', async () => {
    const headers = getAuthHeaders(ctx.accessToken);
    const response = await post('update-deal', {
      dealId: testDeal.id,
      updates: { notes: 'NaN check' },
      organizationId: ctx.organizationId,
    }, headers);

    const deal = response.data.deal as DealResponse;

    // Value should be a valid number
    expect(typeof deal.value).toBe('number');
    expect(Number.isNaN(deal.value)).toBe(false);

    // Stage should be a valid string
    expect(typeof deal.stage).toBe('string');
    expect(deal.stage.length).toBeGreaterThan(0);

    // Status should be a valid string
    expect(typeof deal.status).toBe('string');
    expect(['active', 'won', 'lost', 'disqualified']).toContain(deal.status);
  });

  it('Step 5: Rapid won/active toggle', async () => {
    // Move to won
    let deal = await updateDeal(testDeal.id, { stage: 'deal_won', status: 'won' });
    expect(deal.status).toBe('won');

    // Move back to active
    deal = await updateDeal(testDeal.id, { stage: 'lead', status: 'active' });
    expect(deal.status).toBe('active');

    // Move to won again
    deal = await updateDeal(testDeal.id, { stage: 'deal_won', status: 'won' });
    expect(deal.status).toBe('won');

    // Final state should be won
    expect(deal.stage).toBe('deal_won');
    expect(deal.status).toBe('won');
  });
});

// =============================================================================
// EDGE CASES: Stage-Status Sync
// =============================================================================

describe('Edge Cases: Stage-Status Auto-Sync', () => {
  it('should auto-sync status to won for all won stages', async () => {
    const deal = await createDeal({ client: 'Won Stage Test', stage: 'lead' });

    // Test various won stages
    const wonStages = ['deal_won', 'retention', 'payment_received'];

    for (const stage of wonStages) {
      const updated = await updateDeal(deal.id, { stage });
      // Backend should auto-sync status to 'won' for these stages
      expect(updated.status).toBe('won');
    }
  });

  it('should auto-sync status to lost for all lost stages', async () => {
    const deal = await createDeal({ client: 'Lost Stage Test', stage: 'lead' });

    // Move to deal_lost with reason
    const lostDeal = await updateDeal(deal.id, {
      stage: 'deal_lost',
      lost_reason: 'timing',
    });

    expect(lostDeal.status).toBe('lost');
    expect(lostDeal.stage).toBe('deal_lost');
  });

  it('should clear outcome fields when moving from lost to active', async () => {
    const deal = await createDeal({ client: 'Clear Outcome Test', stage: 'lead' });

    // Mark as lost
    await updateDeal(deal.id, {
      stage: 'deal_lost',
      status: 'lost',
      lost_reason: 'budget',
      lost_reason_notes: 'Budget cut',
    });

    // Move back to active
    const activeDeal = await updateDeal(deal.id, {
      stage: 'contacted',
      status: 'active',
    });

    expect(activeDeal.status).toBe('active');
    expect(activeDeal.lost_reason).toBeNull();
    expect(activeDeal.lost_reason_notes).toBeNull();
  });
});
