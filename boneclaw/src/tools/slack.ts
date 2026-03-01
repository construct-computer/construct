/**
 * Slack tool — interact with the user's connected Slack workspace.
 *
 * Like the Google Drive tool, this sends service requests over WebSocket
 * to the backend, which holds the bot token and calls the Slack Web API.
 */

import type { Tool, ToolResult, ToolContext } from './types';
import { sendServiceRequest } from '../server';

type SlackAction =
  // Core
  | 'status'
  | 'list_channels'
  | 'list_members'
  | 'get_channel_info'
  | 'get_user_info'
  | 'read_history'
  | 'send_message'
  | 'add_reaction'
  | 'upload_file'
  // Message management
  | 'update_message'
  | 'delete_message'
  | 'schedule_message'
  | 'list_scheduled'
  | 'delete_scheduled'
  // Channel management
  | 'create_channel'
  | 'archive_channel'
  | 'invite_to_channel'
  | 'kick_from_channel'
  | 'set_topic'
  | 'set_purpose'
  // Pins
  | 'pin_message'
  | 'unpin_message'
  | 'list_pins'
  // Bookmarks
  | 'add_bookmark'
  | 'list_bookmarks'
  | 'remove_bookmark'
  // User groups
  | 'list_usergroups'
  | 'get_usergroup_members'
  // Canvas
  | 'create_canvas'
  | 'edit_canvas'
  // Search
  | 'search_messages';

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

    case 'update_message':
      return `Message updated successfully.`;

    case 'delete_message':
      return `Message deleted successfully.`;

    case 'schedule_message': {
      const postAt = d.post_at as number | undefined;
      const time = postAt ? new Date(postAt * 1000).toLocaleString() : 'scheduled time';
      const id = d.scheduled_message_id as string | undefined;
      return `Message scheduled for ${time}.${id ? ` (id: ${id})` : ''}`;
    }

    case 'list_scheduled': {
      const msgs = d.scheduled_messages as Array<Record<string, unknown>> | undefined;
      if (!msgs || msgs.length === 0) return 'No scheduled messages.';
      const lines = msgs.map((m) => {
        const postAt = m.post_at as number;
        const time = postAt ? new Date(postAt * 1000).toLocaleString() : '?';
        const text = ((m.text as string) || '').slice(0, 80);
        return `  [${time}] ${text} (id: ${m.id})`;
      });
      return `Scheduled messages (${msgs.length}):\n${lines.join('\n')}`;
    }

    case 'delete_scheduled':
      return `Scheduled message deleted.`;

    case 'create_channel': {
      const ch = d.channel as Record<string, unknown> | undefined;
      return ch ? `Channel #${ch.name} created (id: ${ch.id}).` : 'Channel created.';
    }

    case 'archive_channel':
      return `Channel archived.`;

    case 'invite_to_channel':
      return `User(s) invited to channel.`;

    case 'kick_from_channel':
      return `User removed from channel.`;

    case 'set_topic':
      return `Channel topic updated.`;

    case 'set_purpose':
      return `Channel purpose updated.`;

    case 'pin_message':
      return `Message pinned.`;

    case 'unpin_message':
      return `Message unpinned.`;

    case 'list_pins': {
      const pins = d.items as Array<Record<string, unknown>> | undefined;
      if (!pins || pins.length === 0) return 'No pinned items in this channel.';
      const lines = pins.map((p) => {
        const msg = p.message as Record<string, unknown> | undefined;
        const text = ((msg?.text as string) || '').slice(0, 100);
        const user = msg?.user_name || msg?.user || 'unknown';
        return `  ${user}: ${text}`;
      });
      return `Pinned items (${pins.length}):\n${lines.join('\n')}`;
    }

    case 'add_bookmark':
      return `Bookmark added.`;

    case 'list_bookmarks': {
      const bookmarks = d.bookmarks as Array<Record<string, unknown>> | undefined;
      if (!bookmarks || bookmarks.length === 0) return 'No bookmarks in this channel.';
      const lines = bookmarks.map((b) => `  ${b.title} — ${b.link} (id: ${b.id})`);
      return `Bookmarks (${bookmarks.length}):\n${lines.join('\n')}`;
    }

    case 'remove_bookmark':
      return `Bookmark removed.`;

    case 'list_usergroups': {
      const groups = d.usergroups as Array<Record<string, unknown>> | undefined;
      if (!groups || groups.length === 0) return 'No user groups found.';
      const lines = groups.map((g) => {
        const count = g.user_count !== undefined ? ` [${g.user_count} members]` : '';
        return `  @${g.handle} — ${g.name}${count} (id: ${g.id})`;
      });
      return `User groups (${groups.length}):\n${lines.join('\n')}`;
    }

    case 'get_usergroup_members': {
      const users = d.users as string[] | undefined;
      if (!users || users.length === 0) return 'No members in this user group.';
      return `User group members (${users.length}): ${users.join(', ')}`;
    }

    case 'create_canvas': {
      const canvasId = d.canvas_id as string | undefined;
      return `Canvas created.${canvasId ? ` (id: ${canvasId})` : ''}`;
    }

    case 'edit_canvas':
      return `Canvas edited successfully.`;

    case 'search_messages': {
      const results = d.results as Array<Record<string, unknown>> | undefined;
      if (!results || results.length === 0) return 'No messages found matching the search query.';
      const lines = results.map((m) => {
        const ch = m.channel_name || m.channel || '?';
        const user = m.user_name || m.user || 'unknown';
        const time = m.time || '';
        const text = ((m.text as string) || '').slice(0, 200);
        return `  [#${ch} ${time}] ${user}: ${text}`;
      });
      return `Search results (${results.length}):\n${lines.join('\n')}`;
    }

    case 'add_reaction':
      return `Reaction added successfully.`;

    case 'upload_file':
      return `File uploaded to Slack successfully.`;

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
        'Interact with the user\'s connected Slack workspace. You can manage channels, send/schedule/update/delete messages, ' +
        'read history, search messages, manage pins and bookmarks, create canvases, list user groups, ' +
        'react to messages, tag people, and upload files. Use action "status" to check connectivity first. ' +
        'When sending messages, use <@USER_ID> to mention users and <!subteam^GROUP_ID> to mention user groups. ' +
        'Use "blocks" parameter with Block Kit JSON to send interactive messages with buttons/menus.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'The Slack operation to perform.',
            enum: [
              'status',
              'list_channels', 'list_members', 'get_channel_info', 'get_user_info',
              'read_history', 'search_messages',
              'send_message', 'update_message', 'delete_message',
              'schedule_message', 'list_scheduled', 'delete_scheduled',
              'create_channel', 'archive_channel', 'invite_to_channel', 'kick_from_channel',
              'set_topic', 'set_purpose',
              'add_reaction', 'upload_file',
              'pin_message', 'unpin_message', 'list_pins',
              'add_bookmark', 'list_bookmarks', 'remove_bookmark',
              'list_usergroups', 'get_usergroup_members',
              'create_canvas', 'edit_canvas',
            ],
          },
          channel: {
            type: 'string',
            description:
              'Channel name (without #) or channel ID. Required for most channel-specific actions.',
          },
          text: {
            type: 'string',
            description:
              'Message text. Required for send_message, schedule_message. ' +
              'Use <@USER_ID> to mention users. Supports Slack mrkdwn formatting.',
          },
          blocks: {
            type: 'string',
            description:
              'JSON string of Block Kit blocks for interactive messages (buttons, menus, etc). ' +
              'Used with send_message and update_message. See Slack Block Kit docs for format.',
          },
          thread_ts: {
            type: 'string',
            description: 'Thread timestamp to reply in a thread. For send_message, read_history.',
          },
          timestamp: {
            type: 'string',
            description:
              'Message timestamp. Required for: update_message, delete_message, add_reaction, pin_message, unpin_message.',
          },
          user: {
            type: 'string',
            description: 'User name or user ID. For get_user_info, invite_to_channel, kick_from_channel.',
          },
          users: {
            type: 'string',
            description: 'Comma-separated user IDs. For invite_to_channel (multiple users).',
          },
          emoji: {
            type: 'string',
            description: 'Emoji name without colons (e.g. "thumbsup"). Required for add_reaction.',
          },
          topic: {
            type: 'string',
            description: 'Channel topic text. Required for set_topic.',
          },
          purpose: {
            type: 'string',
            description: 'Channel purpose text. Required for set_purpose.',
          },
          name: {
            type: 'string',
            description:
              'For create_channel: channel name (lowercase, hyphens, underscores, max 80 chars). ' +
              'For add_bookmark: bookmark title.',
          },
          is_private: {
            type: 'boolean',
            description: 'For create_channel: whether to create a private channel.',
          },
          post_at: {
            type: 'number',
            description: 'Unix timestamp for when to send. Required for schedule_message.',
          },
          scheduled_message_id: {
            type: 'string',
            description: 'ID of scheduled message. Required for delete_scheduled.',
          },
          link: {
            type: 'string',
            description: 'URL for add_bookmark.',
          },
          bookmark_id: {
            type: 'string',
            description: 'Bookmark ID for remove_bookmark.',
          },
          usergroup_id: {
            type: 'string',
            description: 'User group ID. Required for get_usergroup_members.',
          },
          title: {
            type: 'string',
            description: 'For create_canvas: canvas title.',
          },
          content: {
            type: 'string',
            description: 'For create_canvas/edit_canvas: markdown content.',
          },
          canvas_id: {
            type: 'string',
            description: 'Canvas ID. Required for edit_canvas.',
          },
          query: {
            type: 'string',
            description: 'Search query text. Required for search_messages.',
          },
          file_path: {
            type: 'string',
            description: 'Absolute path to a file in the container. Required for upload_file.',
          },
          limit: {
            type: 'number',
            description: 'Number of results to return (default varies by action).',
          },
        },
        required: ['action'],
      },
    },
  },
  handler: slackHandler,
};
