/**
 * Google Drive tool — upload, download, list, and search files on the user's Google Drive.
 *
 * This tool does NOT call the Google Drive API directly. Instead, it sends
 * a service request over the WebSocket to the backend, which has the OAuth
 * tokens and googleapis client. The backend processes the request and sends
 * the result back.
 */

import type { Tool, ToolResult, ToolContext } from './types';
import { sendServiceRequest } from '../server';

type DriveAction = 'status' | 'list' | 'upload' | 'download' | 'search';

async function googleDriveHandler(
  args: Record<string, unknown>,
  _context: ToolContext,
): Promise<ToolResult> {
  const action = args.action as DriveAction;

  if (!action) {
    return { success: false, output: 'Missing required parameter: action' };
  }

  // Build params from the tool arguments (excluding 'action')
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key !== 'action') params[key] = value;
  }

  try {
    const result = await sendServiceRequest('drive', action, params);

    if (!result.success) {
      return {
        success: false,
        output: `Google Drive ${action} failed: ${result.error || 'Unknown error'}`,
      };
    }

    // Format the output for the LLM based on the action
    return {
      success: true,
      output: formatDriveResult(action, result.data),
      data: result.data,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: `Google Drive ${action} error: ${message}`,
    };
  }
}

/**
 * Format Drive operation results into human-readable text for the LLM.
 */
function formatDriveResult(action: DriveAction, data: unknown): string {
  if (!data || typeof data !== 'object') {
    return `Google Drive ${action} completed successfully.`;
  }

  const d = data as Record<string, unknown>;

  switch (action) {
    case 'status': {
      const connected = d.connected as boolean;
      if (!connected) {
        return 'Google Drive is NOT connected. The user needs to connect Google Drive in Settings before you can use it.';
      }
      const email = d.email as string | undefined;
      const lastSync = d.lastSync as string | undefined;
      let msg = `Google Drive is connected (${email || 'unknown account'}).`;
      if (lastSync) msg += ` Last sync: ${lastSync}.`;
      return msg;
    }

    case 'list': {
      const files = d.files as Array<Record<string, unknown>> | undefined;
      if (!files || files.length === 0) {
        return 'Google Drive folder is empty.';
      }
      const lines = files.map((f) => {
        const type = f.type === 'directory' ? '[folder]' : `${formatSize(f.size as number)}`;
        return `  ${f.name} ${type} (id: ${f.id})`;
      });
      return `Google Drive files (${files.length} items):\n${lines.join('\n')}`;
    }

    case 'upload': {
      const fileName = d.fileName as string;
      const fileId = d.fileId as string;
      const driveLink = d.driveLink as string;
      return `Successfully uploaded "${fileName}" to Google Drive.\nLink: ${driveLink}\n(file id: ${fileId})`;
    }

    case 'download': {
      const fileName = d.fileName as string;
      const destination = d.destination as string;
      const size = d.size as number;
      return `Successfully downloaded "${fileName}" (${formatSize(size)}) to ${destination}.`;
    }

    case 'search': {
      const files = d.files as Array<Record<string, unknown>> | undefined;
      if (!files || files.length === 0) {
        return 'No files found matching the search query.';
      }
      const lines = files.map((f) => {
        const type = (f.isFolder as boolean) ? '[folder]' : `${formatSize(f.size as number)}`;
        return `  ${f.name} ${type} (id: ${f.id}, path: ${f.path})`;
      });
      return `Found ${files.length} file(s) on Google Drive:\n${lines.join('\n')}`;
    }

    default:
      return `Google Drive ${action} completed successfully.`;
  }
}

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export const googleDriveTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'google_drive',
      description:
        'Upload, download, list, and search files on the user\'s Google Drive. ' +
        'Use action "status" to check if Drive is connected before other operations. ' +
        'Files are stored in the "ConstructWorkspace" folder on Drive.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'The Drive operation to perform.',
            enum: ['status', 'list', 'upload', 'download', 'search'],
          },
          file_path: {
            type: 'string',
            description: 'For "upload": the absolute path to the file in the container (e.g. /home/sandbox/workspace/report.pdf).',
          },
          file_id: {
            type: 'string',
            description: 'For "download": the Google Drive file ID (obtained from "list" or "search" results).',
          },
          destination: {
            type: 'string',
            description: 'For "download": the absolute path where the file should be saved in the container.',
          },
          folder_id: {
            type: 'string',
            description: 'For "list": optional Drive folder ID to list. Defaults to the workspace root folder.',
          },
          drive_folder_id: {
            type: 'string',
            description: 'For "upload": optional Drive folder ID to upload into. Defaults to the workspace root folder.',
          },
          query: {
            type: 'string',
            description: 'For "search": the file name to search for (case-insensitive partial match).',
          },
        },
        required: ['action'],
      },
    },
  },
  handler: googleDriveHandler,
};
