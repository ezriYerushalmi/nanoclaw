/** Singular mailbox composition slot: native storage with an opt-in interaction decorator. */
import { registerAgentMailbox } from './index.js';
import { SqliteAgentMailbox } from './sqlite/index.js';
import { robiMailbox } from '../modules/robi-whatsapp/mailbox.js';
registerAgentMailbox(() => robiMailbox(new SqliteAgentMailbox()));
