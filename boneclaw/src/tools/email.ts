/**
 * Email tool — send, receive, and manage emails via AgentMail.
 *
 * Uses the official `agentmail` SDK to communicate directly with the
 * AgentMail REST API. The API key and inbox username come from
 * /etc/boneclaw/config.yaml (set by the user in Settings).
 *
 * On first use the tool auto-creates an inbox if one doesn't already exist,
 * and caches the inbox ID for subsequent calls.
 */

import { AgentMailClient, AgentMailError } from 'agentmail';
import type { Tool, ToolResult, ToolContext } from './types';
import { loadConfig } from '../config';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

type EmailAction = 'status' | 'send' | 'reply' | 'inbox' | 'thread' | 'search';

const INBOX_CACHE_PATH = '/etc/boneclaw/agentmail-inbox.json';

// Module-level cache so we don't re-create the client on every call
let cachedClient: AgentMailClient | null = null;
let cachedApiKey = '';
let cachedInboxId = '';
let cachedInboxEmail = '';

/**
 * Get or create the AgentMail client.
 */
function getClient(apiKey: string): AgentMailClient {
  if (cachedClient && cachedApiKey === apiKey) return cachedClient;
  cachedClient = new AgentMailClient({ apiKey });
  cachedApiKey = apiKey;
  return cachedClient;
}

/**
 * Load cached inbox ID from disk.
 */
function loadCachedInbox(): { inboxId: string; email: string } | null {
  try {
    if (existsSync(INBOX_CACHE_PATH)) {
      const data = JSON.parse(readFileSync(INBOX_CACHE_PATH, 'utf-8'));
      if (data.inboxId) return { inboxId: data.inboxId, email: data.email || '' };
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Save inbox ID to disk cache.
 */
function saveCachedInbox(inboxId: string, email: string): void {
  try {
    const dir = dirname(INBOX_CACHE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(INBOX_CACHE_PATH, JSON.stringify({ inboxId, email }));
  } catch { /* best effort */ }
}

/**
 * Ensure we have a valid inbox ID. Looks up existing inboxes or creates a new one.
 * Returns { inboxId, email }.
 */
async function ensureInbox(
  client: AgentMailClient,
  inboxUsername: string,
): Promise<{ inboxId: string; email: string }> {
  // Check module-level cache first
  if (cachedInboxId) return { inboxId: cachedInboxId, email: cachedInboxEmail };

  // Check disk cache
  const cached = loadCachedInbox();
  if (cached) {
    cachedInboxId = cached.inboxId;
    cachedInboxEmail = cached.email;
    return cached;
  }

  // List existing inboxes to find one we can use
  const response = await client.inboxes.list();
  const inboxes = response.inboxes || [];
  if (inboxes.length > 0) {
    // Use the first existing inbox
    const inbox = inboxes[0];
    const id = inbox.inboxId;
    // The API doesn't return email in the typed Inbox — construct from username
    const email = inboxUsername ? `${inboxUsername}@agentmail.to` : `${id}@agentmail.to`;
    cachedInboxId = id;
    cachedInboxEmail = email;
    saveCachedInbox(id, email);
    return { inboxId: id, email };
  }

  // None found — create a new one
  const newInbox = await client.inboxes.create({
    username: inboxUsername || undefined,
    displayName: 'Construct Agent',
  });
  const newId = newInbox.inboxId;
  const email = inboxUsername ? `${inboxUsername}@agentmail.to` : `${newId}@agentmail.to`;
  cachedInboxId = newId;
  cachedInboxEmail = email;
  saveCachedInbox(newId, email);
  return { inboxId: newId, email };
}

async function emailHandler(
  args: Record<string, unknown>,
  _context: ToolContext,
): Promise<ToolResult> {
  const action = args.action as EmailAction;
  if (!action) {
    return { success: false, output: 'Missing required parameter: action' };
  }

  // Load config to get API key
  const config = loadConfig('/etc/boneclaw/config.yaml');
  const apiKey = config.agentmail?.apiKey;
  const inboxUsername = config.agentmail?.inboxUsername || '';

  if (!apiKey) {
    return {
      success: false,
      output: 'AgentMail is not configured. The user needs to add their AgentMail API key in Settings.',
    };
  }

  const client = getClient(apiKey);

  try {
    switch (action) {
      case 'status': {
        try {
          const { inboxId, email } = await ensureInbox(client, inboxUsername);
          return {
            success: true,
            output: `AgentMail is configured and ready.\nYour email address: ${email}\nInbox ID: ${inboxId}`,
          };
        } catch (err) {
          if (err instanceof AgentMailError && err.statusCode === 401) {
            return { success: false, output: 'AgentMail API key is invalid. Ask the user to update it in Settings.' };
          }
          throw err;
        }
      }

      case 'send': {
        const to = args.to as string;
        const subject = args.subject as string;
        const body = args.body as string;
        const cc = args.cc as string | undefined;

        if (!to) return { success: false, output: 'Missing required parameter: to' };
        if (!subject) return { success: false, output: 'Missing required parameter: subject' };
        if (!body) return { success: false, output: 'Missing required parameter: body' };

        const { inboxId } = await ensureInbox(client, inboxUsername);

        const sendParams: {
          to: string[];
          subject: string;
          text: string;
          cc?: string[];
          attachments?: Array<{ filename: string; content: string; contentType: string }>;
        } = {
          to: [to],
          subject,
          text: body,
        };
        if (cc) sendParams.cc = [cc];

        // Handle file attachment if provided
        const attachmentPath = args.attachment_path as string | undefined;
        if (attachmentPath) {
          try {
            const fileContent = readFileSync(attachmentPath);
            const fileName = attachmentPath.split('/').pop() || 'attachment';
            sendParams.attachments = [{
              filename: fileName,
              content: fileContent.toString('base64'),
              contentType: 'application/octet-stream',
            }];
          } catch {
            return { success: false, output: `Could not read attachment file: ${attachmentPath}` };
          }
        }

        const result = await client.inboxes.messages.send(inboxId, sendParams as any);
        return {
          success: true,
          output: `Email sent successfully to ${to}.\nSubject: ${subject}\nMessage ID: ${result.messageId}\nThread ID: ${result.threadId}`,
        };
      }

      case 'reply': {
        const messageId = args.message_id as string;
        const body = args.body as string;

        if (!messageId) return { success: false, output: 'Missing required parameter: message_id' };
        if (!body) return { success: false, output: 'Missing required parameter: body' };

        const { inboxId } = await ensureInbox(client, inboxUsername);

        const replyParams: {
          text: string;
          attachments?: Array<{ filename: string; content: string; contentType: string }>;
        } = {
          text: body,
        };

        // Handle file attachment
        const attachmentPath = args.attachment_path as string | undefined;
        if (attachmentPath) {
          try {
            const fileContent = readFileSync(attachmentPath);
            const fileName = attachmentPath.split('/').pop() || 'attachment';
            replyParams.attachments = [{
              filename: fileName,
              content: fileContent.toString('base64'),
              contentType: 'application/octet-stream',
            }];
          } catch {
            return { success: false, output: `Could not read attachment file: ${attachmentPath}` };
          }
        }

        const result = await client.inboxes.messages.reply(inboxId, messageId, replyParams as any);
        return {
          success: true,
          output: `Reply sent successfully.\nMessage ID: ${result.messageId}\nThread ID: ${result.threadId}`,
        };
      }

      case 'inbox': {
        const { inboxId } = await ensureInbox(client, inboxUsername);
        const response = await client.inboxes.messages.list(inboxId, { limit: 20 });
        const messages = response.messages || [];

        if (messages.length === 0) {
          return { success: true, output: 'Inbox is empty. No messages yet.' };
        }

        const lines = messages.map((m) => {
          const from = m.from || 'unknown';
          const subject = m.subject || '(no subject)';
          const date = m.createdAt || '';
          const labels = m.labels || [];
          const labelStr = labels.length > 0 ? ` [${labels.join(', ')}]` : '';
          return `  ${m.messageId} | From: ${from} | ${subject}${labelStr} | ${date}`;
        });

        return {
          success: true,
          output: `Inbox (${messages.length} messages):\n${lines.join('\n')}`,
        };
      }

      case 'thread': {
        const threadId = args.thread_id as string;
        if (!threadId) return { success: false, output: 'Missing required parameter: thread_id' };

        const { inboxId } = await ensureInbox(client, inboxUsername);
        const thread = await client.inboxes.threads.get(inboxId, threadId);
        const messages = thread.messages || [];

        if (messages.length === 0) {
          return { success: true, output: `Thread ${threadId} is empty.` };
        }

        const lines = messages.map((m) => {
          const from = m.from || 'unknown';
          const toStr = Array.isArray(m.to) ? m.to.join(', ') : (m.to || '');
          const subject = m.subject || '';
          const body = (m.text || '').slice(0, 500);
          const date = m.createdAt || '';
          return `--- Message ${m.messageId} ---\nFrom: ${from}\nTo: ${toStr}\nSubject: ${subject}\nDate: ${date}\n\n${body}`;
        });

        return {
          success: true,
          output: `Thread ${threadId} (${messages.length} messages):\n\n${lines.join('\n\n')}`,
        };
      }

      case 'search': {
        const query = args.query as string;
        if (!query) return { success: false, output: 'Missing required parameter: query' };

        const { inboxId } = await ensureInbox(client, inboxUsername);
        const response = await client.inboxes.threads.list(inboxId, { limit: 20 });
        const threads = response.threads || [];

        // Client-side filter by subject/sender
        const lowerQuery = query.toLowerCase();
        const matches = threads.filter((t) => {
          const subject = (t.subject || '').toLowerCase();
          const senders = (t.senders || []).join(' ').toLowerCase();
          return subject.includes(lowerQuery) || senders.includes(lowerQuery);
        });

        if (matches.length === 0) {
          return { success: true, output: `No threads found matching "${query}".` };
        }

        const lines = matches.map((t) => {
          const subject = t.subject || '(no subject)';
          return `  ${t.threadId} | ${subject} (${t.messageCount} messages)`;
        });

        return {
          success: true,
          output: `Found ${matches.length} thread(s) matching "${query}":\n${lines.join('\n')}`,
        };
      }

      default:
        return { success: false, output: `Unknown email action: ${action}. Use: status, send, reply, inbox, thread, search.` };
    }
  } catch (err) {
    if (err instanceof AgentMailError) {
      return {
        success: false,
        output: `AgentMail API error (${err.statusCode}): ${err.message}`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: `Email error: ${message}` };
  }
}

export const emailTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'email',
      description:
        'Send, receive, and manage emails via AgentMail. ' +
        'Use action "status" to check if email is configured and get your inbox address. ' +
        'Use action "send" to compose and send a new email. ' +
        'Use action "inbox" to list recent messages. ' +
        'Use action "thread" to read a full conversation. ' +
        'Use action "reply" to reply to a message. ' +
        'Use action "search" to find threads by subject or sender.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'The email operation to perform.',
            enum: ['status', 'send', 'reply', 'inbox', 'thread', 'search'],
          },
          to: {
            type: 'string',
            description: 'For "send": the recipient email address.',
          },
          subject: {
            type: 'string',
            description: 'For "send": the email subject line.',
          },
          body: {
            type: 'string',
            description: 'For "send" and "reply": the email body text.',
          },
          cc: {
            type: 'string',
            description: 'For "send": optional CC recipient email address.',
          },
          attachment_path: {
            type: 'string',
            description: 'For "send" and "reply": optional path to a file in the container to attach.',
          },
          message_id: {
            type: 'string',
            description: 'For "reply": the ID of the message to reply to (from "inbox" or "thread" results).',
          },
          thread_id: {
            type: 'string',
            description: 'For "thread": the thread ID to retrieve (from "inbox" or "search" results).',
          },
          query: {
            type: 'string',
            description: 'For "search": search term to filter threads by subject or sender.',
          },
        },
        required: ['action'],
      },
    },
  },
  handler: emailHandler,
};
