import type { Tool, ToolResult, ToolContext } from './types';

/**
 * notify — send a desktop notification to the user.
 *
 * The tool emits a `notification` event via the event bus.  The backend
 * relays it over the agent WebSocket to the frontend, which shows a
 * toast banner and adds an entry to the notification center.
 */
export const notifyTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'notify',
      description:
        'Send a desktop notification to the user. Use this to alert the user when a long-running task finishes, ' +
        'an important event occurs, or you need their attention. The notification appears as a toast banner.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short headline for the notification (required)',
          },
          body: {
            type: 'string',
            description: 'Optional longer description or details',
          },
          variant: {
            type: 'string',
            description: 'Visual style of the notification',
            enum: ['info', 'success', 'error'],
            default: 'info',
          },
        },
        required: ['title'],
      },
    },
  },

  handler: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const title = (args.title as string) || 'Notification';
    const body = (args.body as string) || undefined;
    const variant = (args.variant as string) || 'info';

    // Emit through the event bus → WS → frontend
    context.emit({
      type: 'notification',
      title,
      body,
      variant,
      source: 'Construct Agent',
    });

    return {
      success: true,
      output: `Notification sent: "${title}"`,
    };
  },
};
