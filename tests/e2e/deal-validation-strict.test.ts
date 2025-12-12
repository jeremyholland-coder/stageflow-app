import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestUserAuth, getAuthHeaders } from './utils/auth';
import { post, logResponse } from './utils/api';

describe('Deals API - Strict Validation & Status Rules', () => {
  let accessToken: string;
  let organizationId: string;
  const createdDealIds: string[] = [];

  const headers = () => getAuthHeaders(accessToken);

  const createDeal = async (overrides: Record<string, any> = {}) => {
    const response = await post('create-deal', {
      dealData: {
        client: `Strict Test ${Date.now()}`,
        email: 'strict@test.com',
        value: 100,
        stage: 'lead',
        ...overrides
      },
      organizationId
    }, headers());
    if (response.data?.deal?.id) {
      createdDealIds.push(response.data.deal.id);
    }
    return response;
  };

  beforeAll(async () => {
    const auth = await getTestUserAuth();
    accessToken = auth.accessToken;
    organizationId = auth.organizationId;
  });

  afterAll(async () => {
    for (const dealId of createdDealIds) {
      try {
        await post('delete-deal', { dealId, organizationId }, headers());
      } catch (err) {
        console.warn('[cleanup] Failed to delete deal', dealId, err);
      }
    }
  });

  it('should reject create-deal missing email/value/stage', async () => {
    const res = await post('create-deal', {
      dealData: { client: 'Missing Fields' },
      organizationId
    }, headers());

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('INVALID_PAYLOAD_REQUIRED_FIELD_MISSING');
    expect(res.data.details).toBeDefined();
  });

  it('should reject invalid email and value range', async () => {
    const res = await post('create-deal', {
      dealData: {
        client: 'Bad Email',
        email: 'not-an-email',
        value: -5,
        stage: 'lead'
      },
      organizationId
    }, headers());

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('INVALID_PAYLOAD_REQUIRED_FIELD_MISSING');
    const fieldCodes = (res.data.details || []).map((d: any) => d.code);
    expect(fieldCodes).toContain('INVALID_EMAIL_FORMAT');
    expect(fieldCodes).toContain('INVALID_VALUE_RANGE');
  });

  it('should map retention_renewal stage to won status', async () => {
    const createRes = await createDeal();
    expect(createRes.status).toBe(200);
    const dealId = createRes.data.deal.id;

    const updateRes = await post('update-deal', {
      dealId,
      updates: { stage: 'retention_renewal' },
      organizationId
    }, headers());

    logResponse('update-deal retention_renewal', updateRes);
    expect(updateRes.status).toBe(200);
    expect(updateRes.data.deal.status).toBe('won');
  });

  it('should map passed stage to lost status', async () => {
    const createRes = await createDeal();
    expect(createRes.status).toBe(200);
    const dealId = createRes.data.deal.id;

    const updateRes = await post('update-deal', {
      dealId,
      updates: { stage: 'passed' },
      organizationId
    }, headers());

    logResponse('update-deal passed', updateRes);
    expect(updateRes.status).toBe(200);
    expect(updateRes.data.deal.status).toBe('lost');
  });

  it('should require disqualification category and backfill snapshot', async () => {
    const createRes = await createDeal();
    expect(createRes.status).toBe(200);
    const dealId = createRes.data.deal.id;

    const missingCat = await post('update-deal', {
      dealId,
      updates: { status: 'disqualified' },
      organizationId
    }, headers());
    expect(missingCat.status).toBe(400);
    expect(missingCat.data.code).toBe('INVALID_PAYLOAD_REQUIRED_FIELD_MISSING');

    const disqualify = await post('update-deal', {
      dealId,
      updates: {
        status: 'disqualified',
        disqualified_reason_category: 'no_budget'
      },
      organizationId
    }, headers());

    logResponse('update-deal disqualify', disqualify);
    expect(disqualify.status).toBe(200);
    expect(disqualify.data.deal.status).toBe('disqualified');
    expect(disqualify.data.deal.stage_at_disqualification).toBeDefined();
    expect(disqualify.data.deal.disqualified_at).toBeDefined();
  });

  it('should reject won to lost transition without reactivation', async () => {
    const createRes = await createDeal();
    expect(createRes.status).toBe(200);
    const dealId = createRes.data.deal.id;

    const winRes = await post('update-deal', {
      dealId,
      updates: { stage: 'deal_won' },
      organizationId
    }, headers());
    expect(winRes.status).toBe(200);
    expect(winRes.data.deal.status).toBe('won');

    const invalidTransition = await post('update-deal', {
      dealId,
      updates: { status: 'lost' },
      organizationId
    }, headers());

    expect(invalidTransition.status).toBe(400);
    expect(invalidTransition.data.code).toBe('INVALID_STATUS_TRANSITION');
  });
});
