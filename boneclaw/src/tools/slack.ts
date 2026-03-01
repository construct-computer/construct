/**
 * Slack tool — interact with the user's connected Slack workspace.
 *
 * Like the Google Drive tool, this sends service requests over WebSocket
 * to the backend, which holds the bot token and calls the Slack Web API.
 */

import type { Tool, ToolResult, ToolContext } from './types';
import { sendServiceRequest } from '../server';

type SlackAction =
  | 'status'
  | 'list_channels'
  | 'list_members'
  | 'get_channel_info'
  | 'get_user_info'
  | 'read_history'
  | 'send_message'
  | 'add_reaction'
  | 'upload_file';

async function slackHandler(
  args: Record<string, unknown>,
  _context: ToolContext,
): Promise<ToolResult> {
  const action = args.action as SlackAction;

  if (!action) {
    return { success: false, output: 'Missing required parameter: action' };
  }

  // Build params from tool arguments (excluding 'action')
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key !== 'action') params[key] = value;
  }

  try {
    const result = await sendServiceRequest('slack', action, params);

    if (!result.success) {
      return {
        success: false,
        output: `Slack ${action} failed: ${result.error || 'Unknown error'}`,
      };
    }

    return {
      success: true,
      output: formatSlackResult(action, result.data),
      data: result.data,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: `Slack ${action} error: ${message}`,
    };
  }
}

/**
 * Format Slack operation results into human-readable text for the LLM.
 */
function formatSlackResult(action: SlackAction, data: unknown): string {
  if (!data || typeof data !== 'object') {
    return `Slack ${action} completed successfully.`;
  }

  const d = data as Record<string, unknown>;

  switch (action) {
    case 'status': {
      const connected = d.connected as boolean;
      if (!connected) {
        return 'Slack is NOT connected. The user needs to connect Slack in Settings before you can use it.';
      }
      const teamName = d.teamName as string | undefined;
      return `Slack is connected to workspace "${teamName || 'unknown'}".`;
    }

    case 'list_channels': {
      const channels = d.channels as Array<Record<string, unknown>> | undefined;
      if (!channels || channels.length === 0) {
        return 'No channels found (the bot may not be added to any channels yet).';
      }
      const lines = channels.map((ch) => {
        const prefix = ch.is_private ? '(private)' : '';
        const members = ch.num_members !== undefined ? ` [${ch.num_members} members]` : '';
        const topic = ch.topic ? ` — ${ch.topic}` : '';
        return `  #${ch.name} ${prefix}${members}${topic} (id: ${ch.id})`;
      });
      return `Slack channels (${channels.length}):\n${lines.join('\n')}`;
    }

    case 'list_members': {
      const members = d.members as Array<Record<string, unknown>> | undefined;
      const channelName = d.channel_name as string | undefined;
      if (!members || members.length === 0) {
        return `No members found in ${channelName ? `#${channelName}` : 'this channel'}.`;
      }
      const lines = members.map((m) => {
        const status = m.is_bot ? ' (bot)' : '';
        const title = m.title ? ` — ${m.title}` : '';
        return `  @${m.name} (${m.real_name}${title})${status} (id: ${m.id})`;
      });
      return `Members of ${channelName ? `#${channelName}` : 'channel'} (${members.length}):\n${lines.join('\n')}`;
    }

    case 'get_channel_info': {
      const ch = d.channel as Record<string, unknown> | undefined;
      if (!ch) return 'Channel not found.';
      const topic = ch.topic ? `\nTopic: ${ch.topic}` : '';
      const purpose = ch.purpose ? `\nPurpose: ${ch.purpose}` : '';
      return `#${ch.name} (id: ${ch.id})\nMembers: ${ch.num_members}${topic}${purpose}`;
    }

    case 'get_user_info': {
      const user = d.user as Record<string, unknown> | undefined;
      if (!user) return 'User not found.';
      const title = user.title ? ` — ${user.title}` : '';
      const tz = user.tz ? ` (${user.tz})` : '';
      const status = user.status_text ? `\nStatus: ${user.status_emoji || ''} ${user.status_text}` : '';
      return `@${user.name} (${user.real_name}${title})${tz}\nEmail: ${user.email || 'N/A'}${status} (id: ${user.id})`;
    }

    case 'read_history': {
      const messages = d.messages as Array<Record<string, unknown>> | undefined;
      const channelName = d.channel_name as string | undefined;
      if (!messages || messages.length === 0) {
        return `No recent messages in ${channelName ? `#${channelName}` : 'this channel'}.`;
      }
      const lines = messages.map((m) => {
        const author = m.user_name || m.user || 'unknown';
        const time = m.time || '';
        const text = (m.text as string || '').slice(0, 300);
        return `  [${time}] ${author}: ${text}`;
      });
      return `Recent messages in ${channelName ? `#${channelName}` : 'channel'} (${messages.length}):\n${lines.join('\n')}`;
    }

    case 'send_message': {
      const channel = d.channel as string | undefined;
      const ts = d.ts as string | undefined;
      return `Message sent to ${channel || 'channel'}.${ts ? ` (ts: ${ts})` : ''}`;
    }

    case 'add_reaction': {
      return `Reaction added successfully.`;
    }

    case 'upload_file': {
      return `File uploaded to Slack successfully.`;
    }

    default:
      return `Slack ${action} completed successfully.`;
  }
}

export const slackTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'slack',
      description:
        'Interact with the user\'s connected Slack workspace. You can list channels and members, ' +
        'read message history, send messages, react to messages, tag people, and upload files. ' +
        'Use action "status" to check if Slack is connected before other operations. ' +
        'When sending messages, you can @mention users with <@USER_ID> syntax.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'The Slack operation to perform.',
            enum: [
              'status',
              'list_channels',
              'list_members',
              'get_channel_info',
              'get_user_info',
              'read_history',
              'send_message',
              'add_reaction',
              'upload_file',
            ],
          },
          channel: {
            type: 'string',
            description:
              'Channel name (without #) or channel ID. ' +
              'Required for: list_members, get_channel_info, read_history, send_message, upload_file.',
          },
          text: {
            type: 'string',
            description:
              'Message text. Required for send_message. ' +
              'Use <@USER_ID> to mention users. Supports Slack mrkdwn formatting.',
          },
          thread_ts: {
            type: 'string',
            description:
              'Thread timestamp to reply in a thread. For send_message and read_history.',
          },
          user: {
            type: 'string',
            description:
              'User name or user ID. Required for get_user_info.',
          },
          emoji: {
            type: 'string',
            description:
              'Emoji name without colons (e.g. "thumbsup"). Required for add_reaction.',
          },
          timestamp: {
            type: 'string',
            description:
              'Message timestamp. Required for add_reaction (the message to react to).',
          },
          file_path: {
            type: 'string',
            description:
              'Absolute path to a file in the container to upload. Required for upload_file.',
          },
          limit: {
            type: 'number',
            description:
              'Number of results to return. For read_history (default 20) and list_channels (default 100).',
          },
        },
        required: ['action'],
      },
    },
  },
  handler: slackHandler,
};
