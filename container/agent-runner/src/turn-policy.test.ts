import { expect, it } from 'bun:test';
import { policyForTurn, registerTurnPolicy } from './turn-policy.js';
it('is opt-in and exposes only generic lifecycle controls', async () => {
  let finishes = 0;
  registerTurnPolicy((ids) =>
    ids.includes('selected')
      ? {
          holdFollowUps: true,
          async finish(retrying) {
            if (!retrying) finishes++;
          },
          async abandon() {
            finishes++;
          },
        }
      : undefined,
  );
  expect(policyForTurn(['native'])).toBeUndefined();
  const policy = policyForTurn(['selected'])!;
  expect(policy.holdFollowUps).toBe(true);
  await policy.finish(true);
  expect(finishes).toBe(0);
  await policy.finish(false);
  expect(finishes).toBe(1);
  await policy.abandon();
  expect(finishes).toBe(2);
});
