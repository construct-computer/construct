import type { Config, Goal } from '../config';
import { AgentLoop } from './loop';
import { Scheduler } from './scheduler';
import { emit, emitThinking, emitError } from '../events/emitter';

/**
 * Select the next goal to work on based on priority and status
 */
function selectNextGoal(goals: Goal[]): Goal | null {
  const activeGoals = goals.filter(g => g.status === 'active');
  if (activeGoals.length === 0) return null;
  
  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  activeGoals.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  return activeGoals[0];
}

/**
 * Calculate sleep duration based on activity
 */
function calculateSleepDuration(hasGoals: boolean, hasSchedules: boolean): number {
  if (hasGoals) {
    // Active goals: short sleep (30 seconds)
    return 30000;
  }
  
  if (hasSchedules) {
    // Only schedules: check every minute
    return 60000;
  }
  
  // Idle: check every 5 minutes
  return 300000;
}

export interface AutonomousLoopOptions {
  config: Config;
  onShutdown?: () => void;
}

/**
 * Run the autonomous agent loop
 * This runs indefinitely, executing goals and scheduled tasks
 */
export async function runAutonomousLoop(options: AutonomousLoopOptions): Promise<never> {
  const { config, onShutdown } = options;
  
  const agentLoop = new AgentLoop({ config });
  const scheduler = new Scheduler(config.schedules);
  
  // Emit startup
  emit({
    type: 'agent:started',
    config: {
      name: config.identity.name,
      model: config.openrouter.model,
    },
  });
  
  let running = true;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;
  
  // Handle shutdown signals
  const shutdown = () => {
    running = false;
    onShutdown?.();
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  while (running) {
    try {
      // 1. Check for scheduled tasks
      const scheduledTask = scheduler.getNextDueTask();
      if (scheduledTask) {
        emit({
          type: 'agent:scheduled_task',
          taskId: scheduledTask.id,
          action: scheduledTask.action,
        });
        
        try {
          await agentLoop.runTask(scheduledTask.action);
          scheduler.markComplete(scheduledTask.id);
          consecutiveErrors = 0;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          emitError(`Scheduled task failed: ${msg}`);
          scheduler.markComplete(scheduledTask.id); // Still mark complete to avoid infinite retry
        }
        
        continue;
      }
      
      // 2. Work on active goals
      const activeGoal = selectNextGoal(config.goals);
      if (activeGoal) {
        emit({
          type: 'agent:goal_started',
          goalId: activeGoal.id,
          description: activeGoal.description,
        });
        
        try {
          await agentLoop.runTask(activeGoal.description, activeGoal.context);
          emit({ type: 'agent:goal_completed', goalId: activeGoal.id });
          consecutiveErrors = 0;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          emitError(`Goal execution failed: ${msg}`);
          consecutiveErrors++;
        }
        
        continue;
      }
      
      // 3. Send heartbeat
      const memorySummary = agentLoop.getMemorySummary();
      emit({
        type: 'agent:heartbeat',
        status: 'idle',
        uptime: process.uptime(),
      });
      
      // 4. Check if we should run a heartbeat prompt
      // (every 10 minutes or so to check if there's anything to do)
      const now = Date.now();
      const lastActivity = memorySummary.lastActivity.getTime();
      const idleTime = now - lastActivity;
      
      if (idleTime > 600000) { // 10 minutes
        emitThinking('Running idle check...');
        try {
          await agentLoop.runHeartbeat();
          consecutiveErrors = 0;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          emitError(`Heartbeat failed: ${msg}`);
          consecutiveErrors++;
        }
      }
      
      // 5. Sleep
      const hasGoals = config.goals.some(g => g.status === 'active');
      const hasSchedules = config.schedules.some(s => s.enabled);
      const sleepTime = calculateSleepDuration(hasGoals, hasSchedules);
      
      // Use shorter sleep if there's an upcoming scheduled task
      const timeUntilNext = scheduler.getTimeUntilNext();
      const actualSleep = Math.min(sleepTime, timeUntilNext);
      
      await Bun.sleep(actualSleep);
      
      // Reset error count on successful iteration
      consecutiveErrors = 0;
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      emitError(`Loop error: ${msg}`);
      consecutiveErrors++;
      
      // Back off on repeated errors
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        emitError(`Too many consecutive errors (${consecutiveErrors}), backing off...`);
        await Bun.sleep(60000); // 1 minute
      } else {
        await Bun.sleep(5000 * consecutiveErrors); // Progressive backoff
      }
    }
  }
  
  // This should never be reached, but TypeScript needs it
  throw new Error('Autonomous loop terminated');
}

/**
 * Run a single interaction (for CLI or API use)
 */
export async function runSingleInteraction(config: Config, message: string): Promise<string> {
  const agentLoop = new AgentLoop({ config });
  
  emit({
    type: 'agent:started',
    config: {
      name: config.identity.name,
      model: config.openrouter.model,
    },
  });
  
  const response = await agentLoop.run(message);
  
  return response;
}
