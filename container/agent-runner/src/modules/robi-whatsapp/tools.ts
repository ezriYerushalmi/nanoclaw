import { getAgentMailbox } from '../../mailbox/index.js';
import { registerTools } from '../../mcp-tools/server.js';
import { readPolicy } from './policy.js';
import { silenceHumanConversation } from './mailbox.js';
import './health-tools.js';
import './garmin-tools.js';
import './vision/tools.js';
// Scoped registration: unconfigured agent workspaces do not expose this tool.
if (readPolicy())
  registerTools([
    {
      tool: {
        name: 'ignore_human_conversation',
        description:
          'Choose silence only for a conversation between human participants that is not addressed to you. Never use this for an interaction addressed to you.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      async handler() {
        const allowed = silenceHumanConversation(getAgentMailbox().operations);
        return {
          content: [
            { type: 'text', text: allowed ? 'Human conversation outcome recorded.' : 'No scoped turn is active.' },
          ],
          ...(!allowed && { isError: true }),
        };
      },
    },
  ]);
