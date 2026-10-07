/** Optional turn lifecycle policy. Native parsing and retry handling remain authoritative. */
export interface TurnPolicy {
  readonly holdFollowUps: boolean;
  finish(retrying: boolean): Promise<void>;
  abandon(): Promise<void>;
}
type Factory = (messageIds: readonly string[]) => TurnPolicy | undefined;
const factories: Factory[] = [];
export function registerTurnPolicy(factory: Factory): void {
  factories.push(factory);
}
export function policyForTurn(messageIds: readonly string[]): TurnPolicy | undefined {
  const matches = factories.map((factory) => factory(messageIds)).filter((p): p is TurnPolicy => !!p);
  if (matches.length > 1) throw new Error('Multiple turn policies selected the same turn');
  return matches[0];
}
