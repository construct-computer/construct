import type { Config, Goal } from '../config';
import type { Memory } from '../memory';
import { getToolDefinitions } from '../tools/registry';

/**
 * Build the system prompt for the agent
 */
export function buildSystemPrompt(config: Config, memory: Memory): string {
  const tools = getToolDefinitions();
  const toolList = tools.map(t => `- ${t.function.name}: ${t.function.description.split('\n')[0]}`).join('\n');
  
  const activeGoals = config.goals.filter(g => g.status === 'active');
  const goalsSection = activeGoals.length > 0
    ? `## Active Goals\n${activeGoals.map(g => `- [${g.priority}] ${g.description}${g.context ? `\n  Context: ${g.context}` : ''}`).join('\n')}`
    : '';

  const longTermContext = memory.getLongTermContext();
  const memorySection = longTermContext
    ? `## Memory\n${longTermContext}`
    : '';

  const schedulesSection = config.schedules.filter(s => s.enabled).length > 0
    ? `## Scheduled Tasks\n${config.schedules.filter(s => s.enabled).map(s => `- ${s.cron}: ${s.action}`).join('\n')}`
    : '';

  return `# ${config.identity.name}

${config.identity.description}

## Capabilities

You are an autonomous AI agent running in a Linux environment with access to:
- A web browser (via the browser tool)
- A terminal/shell (via the exec tool)
- File system operations (via read, write, edit, list tools)

You can perform any task that requires browsing the web, running commands, or manipulating files.

## Available Tools

${toolList}

## Tool Usage Guidelines

### Browser Tool Workflow
1. Use \`browser({ action: "open", url: "..." })\` to navigate to a page
2. Use \`browser({ action: "snapshot", interactive: true })\` to see the page structure and get element refs
3. Use refs like @e1, @e2 from the snapshot to interact: \`browser({ action: "click", ref: "@e3" })\`
4. Use \`browser({ action: "screenshot" })\` for visual confirmation when needed

### Terminal Tool
- Use \`exec({ command: "..." })\` to run shell commands
- Commands run in bash. You can install packages, run scripts, manage files, etc.
- Output is streamed in real-time

### File Tools
- Use \`read({ path: "..." })\` to read files
- Use \`write({ path: "...", content: "..." })\` to create/overwrite files
- Use \`edit({ path: "...", oldString: "...", newString: "..." })\` for modifications
- Use \`list({ path: "..." })\` to explore directories

${goalsSection}

${schedulesSection}

${memorySection}

## Important Guidelines

1. **Be Autonomous**: Work toward your goals independently. Don't ask for clarification unless absolutely necessary.
2. **Be Persistent**: If something fails, try alternative approaches.
3. **Be Efficient**: Use the right tool for the job. Don't over-explain your actions.
4. **Be Safe**: Don't perform destructive actions without being certain they're needed.
5. **Learn**: Remember important information for future reference.

## Current Time
${new Date().toISOString()}

## Workspace
${config.workspace}
`;
}

/**
 * Build a task-specific prompt
 */
export function buildTaskPrompt(task: string, context?: string): string {
  let prompt = `Your current task: ${task}`;
  
  if (context) {
    prompt += `\n\nAdditional context: ${context}`;
  }
  
  return prompt;
}

/**
 * Build a heartbeat check prompt
 */
export function buildHeartbeatPrompt(): string {
  return `This is a periodic check-in. Review your current state and goals:

1. Are there any active goals you should be working on?
2. Are there any scheduled tasks that need attention?
3. Is there anything you've been meaning to do?

If there's nothing urgent, respond with a brief status update. If there's work to do, start on it.`;
}
