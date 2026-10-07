import { randomUUID } from 'node:crypto';
import type {
  AgentMailbox,
  MailboxOperations,
  InboundMessage,
  OutboundMessage,
  OutboundMessageDraft,
} from '../../mailbox/types.js';
import { registerTurnPolicy } from '../../turn-policy.js';
import { optedIn, readPolicy, selectBurst, sender, type Policy } from './policy.js';
const HELD = 'robi:held';
const ACTIVE = 'robi:active';
const DRAFTS = 'robi:drafts';
const SILENT = 'robi:human-conversation';
interface Active {
  rows: InboundMessage[];
  acknowledge: boolean;
}
/** Decorates the native mailbox; all durable state uses its existing state store. */
export function robiMailbox(base: AgentMailbox, policy: Policy | null = readPolicy(), register = true): AgentMailbox {
  if (!policy) return base;
  const native = base.operations;
  const read = <T>(key: string, fallback: T): T => {
    const value = native.getState(key)?.value;
    return value ? (JSON.parse(value) as T) : fallback;
  };
  let startedTurn = false;
  const active = (): Active | null => read<Active | null>(ACTIVE, null);
  const drafts = (): OutboundMessage[] => read<OutboundMessage[]>(DRAFTS, []);
  const begin = (ids: readonly string[]) => {
    if (!policy || !ids.length) return undefined;
    const held = read<InboundMessage[]>(HELD, []);
    const first = held.find((row) => ids.includes(row.id));
    const prior = active();
    if (!first && !prior?.rows.some((row) => ids.includes(row.id))) return undefined;
    if (!prior) {
      const rows = selectBurst(held, policy);
      if (!rows.some((row) => ids.includes(row.id))) return undefined;
      native.setState(ACTIVE, JSON.stringify({ rows, acknowledge: sender(rows.at(-1)!) === policy.acknowledgeSender }));
      native.deleteState(DRAFTS);
      native.deleteState(SILENT);
    }
    startedTurn = true;
    return { holdFollowUps: true, finish, abandon: () => finish(false) };
  };
  async function finish(retrying: boolean): Promise<void> {
    if (retrying) return;
    const turn = active();
    if (!turn) return;
    const last = turn.rows.at(-1)!;
    const staged = drafts();
    const bodies = [
      ...new Set(
        staged
          .map((row) => {
            const c = JSON.parse(row.content);
            return typeof c.text === 'string' ? c.text.trim() : typeof c.markdown === 'string' ? c.markdown.trim() : '';
          })
          .filter(Boolean),
      ),
    ];
    const reaction = staged
      .map((row) => JSON.parse(row.content))
      .reverse()
      .find((c) => c.operation === 'reaction');
    const human = read<boolean>(SILENT, false);
    const content = bodies.length
      ? { text: bodies.join('\n\n') }
      : human
        ? null
        : reaction || turn.acknowledge
          ? { operation: 'reaction', messageId: last.id, emoji: reaction?.emoji ?? '👀' }
          : null;
    if (content)
      await native.writeMessageOut({
        id: `msg-${randomUUID()}`,
        kind: 'chat',
        platformId: last.platformId,
        channelType: last.channelType,
        threadId: last.threadId,
        inReplyTo: last.id,
        content: JSON.stringify(content),
      });
    const consumed = new Set(turn.rows.map((row) => row.id));
    native.setState(HELD, JSON.stringify(read<InboundMessage[]>(HELD, []).filter((row) => !consumed.has(row.id))));
    native.deleteState(ACTIVE);
    native.deleteState(DRAFTS);
    native.deleteState(SILENT);
    startedTurn = false;
  }
  if (register && policy) registerTurnPolicy(begin);
  const operations: MailboxOperations = new Proxy(native, {
    get(target, property) {
      if (property === 'getPendingMessages')
        return (limit: number, firstPoll: boolean): InboundMessage[] => {
          if (!policy) return native.getPendingMessages(limit, firstPoll);
          if (active() && !startedTurn) {
            native.deleteState(ACTIVE);
            native.deleteState(DRAFTS);
            native.deleteState(SILENT);
          }
          const held = read<InboundMessage[]>(HELD, []);
          const known = new Set(held.map((row) => row.id));
          let ordinary: InboundMessage[] = [];
          // Drain normal-sized native pages into durable held state, without a 10,000-row read.
          // Claims prevent the same page reappearing; no provider invocation occurs until quiet.
          while (true) {
            const page = native.getPendingMessages(limit, firstPoll);
            const selected = page.filter((row) => optedIn(row, policy));
            if (!selected.length && !held.length) return page;
            ordinary = page.filter((row) => !optedIn(row, policy));
            for (const row of selected)
              if (!known.has(row.id)) {
                held.push(row);
                known.add(row.id);
              }
            native.setState(HELD, JSON.stringify(held));
            if (selected.length)
              native.markMessages(
                selected.map((row) => row.id),
                'processing',
              );
            if (ordinary.length || page.length < limit || !selected.length) break;
          }
          // Restart recovery: held rows remain available even if their claims were cleared.
          return ordinary.length ? ordinary : active() ? [] : selectBurst(held, policy);
        };
      if (property === 'markMessages')
        return (ids: string[], status: Parameters<MailboxOperations['markMessages']>[1]) => {
          native.markMessages(ids, status);
          if (
            native.getState(HELD) &&
            (status === 'completed' || status === 'failed' || status === 'script-skip:error')
          ) {
            const consumed = new Set(ids);
            native.setState(
              HELD,
              JSON.stringify(read<InboundMessage[]>(HELD, []).filter((row) => !consumed.has(row.id))),
            );
          }
        };
      if (property === 'writeMessageOut')
        return async (message: OutboundMessageDraft): Promise<number> => {
          const turn = active();
          if (
            !turn ||
            message.kind !== 'chat' ||
            message.channelType !== 'whatsapp' ||
            message.platformId !== turn.rows.at(-1)!.platformId
          )
            return native.writeMessageOut(message);
          const content = JSON.parse(message.content);
          if (
            content.operation !== 'reaction' &&
            typeof content.text !== 'string' &&
            typeof content.markdown !== 'string'
          )
            return native.writeMessageOut(message);
          const current = drafts();
          const sequence =
            Math.max(
              0,
              ...native.getUndeliveredMessages().map((row) => row.sequence ?? 0),
              ...current.map((row) => row.sequence ?? 0),
            ) + 1;
          current.push({
            ...message,
            sequence,
            timestamp: new Date().toISOString(),
            platformId: message.platformId ?? null,
            channelType: message.channelType ?? null,
            threadId: message.threadId ?? null,
            inReplyTo: message.inReplyTo ?? null,
            deliverAfter: message.deliverAfter ?? null,
            recurrence: message.recurrence ?? null,
          } as OutboundMessage);
          native.setState(DRAFTS, JSON.stringify(current));
          return sequence;
        };
      if (property === 'getUndeliveredMessages') return () => [...native.getUndeliveredMessages(), ...drafts()];
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    operations,
    start: (key) => base.start(key),
    run: (action) => base.run(action),
    stop: () => base.stop(),
    shouldRestartAfter: (error) => base.shouldRestartAfter?.(error) ?? false,
  };
}
export function silenceHumanConversation(operations: MailboxOperations): boolean {
  if (!operations.getState(ACTIVE)) return false;
  operations.setState(SILENT, JSON.stringify(true));
  return true;
}
