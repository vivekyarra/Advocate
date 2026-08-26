export const DEMO_NOW = '2026-08-26T10:30:00.000Z';

export function createSeedState() {
  return {
    schemaVersion: 1,
    account: {
      id: 'acct-demo-4821',
      customerName: 'Jordan Lee',
      last4: '4821',
      status: 'good_standing'
    },
    plan: {
      id: 'fiber-500',
      name: 'Fiber 500',
      speedMbps: 500,
      monthlyCents: 8400,
      promoEndedOn: '2026-08-01'
    },
    planOptions: [
      {
        id: 'fiber-500-flex',
        name: 'Fiber 500 Flex',
        speedMbps: 500,
        monthlyCents: 6700,
        data: 'Unlimited',
        contract: 'Month-to-month',
        equivalentToCurrent: true
      },
      {
        id: 'fiber-gig',
        name: 'Fiber Gig',
        speedMbps: 1000,
        monthlyCents: 7900,
        data: 'Unlimited',
        contract: 'Month-to-month',
        equivalentToCurrent: false
      }
    ],
    bills: [
      {
        id: 'bill-2026-08',
        period: 'August 2026',
        issuedOn: '2026-08-25',
        dueOn: '2026-09-05',
        status: 'due',
        originalAmountCents: 9437,
        charges: [
          { id: 'service-2026-08', label: 'Fiber 500 monthly service', category: 'service', amountCents: 8400, valid: true },
          { id: 'install-fee-2026-08', label: 'Installation fee', category: 'one_time_fee', amountCents: 1037, valid: false, invalidReason: 'No installation or equipment activation occurred this billing period.' }
        ]
      },
      {
        id: 'bill-2026-07',
        period: 'July 2026',
        issuedOn: '2026-07-25',
        dueOn: '2026-08-05',
        status: 'paid',
        originalAmountCents: 5900,
        charges: [
          { id: 'service-2026-07', label: 'Fiber 500 monthly service', category: 'service', amountCents: 8400, valid: true },
          { id: 'promo-2026-07', label: '12-month promotional discount', category: 'discount', amountCents: -2500, valid: true }
        ]
      }
    ],
    outages: [
      {
        id: 'outage-2026-08-22',
        startedAt: '2026-08-22T03:38:00.000Z',
        endedAt: '2026-08-22T10:20:00.000Z',
        durationMinutes: 402,
        confirmed: true,
        reason: 'Network interruption',
        creditEligible: true,
        creditCents: 1280,
        policy: 'Reliability credit — confirmed outage over four hours'
      }
    ],
    ledger: [],
    case: {
      id: 'ADV-2026-0826-001',
      status: 'idle',
      openedAt: null,
      resolvedAt: null,
      discoveries: {
        comparedBills: false,
        outageReviewed: false,
        creditChecked: false,
        chargeChecked: false,
        plansReviewed: false
      },
      approval: {
        billFixes: false,
        planId: null,
        grantedAt: null
      },
      actions: {
        outageCreditApplied: false,
        invalidChargeRefunded: false,
        planChanged: false
      }
    },
    auditLog: []
  };
}
