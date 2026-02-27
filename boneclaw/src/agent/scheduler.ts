import type { Schedule } from '../config';

// Simple cron expression parser
// Supports: minute hour day month weekday
// Values: *, numbers, intervals like */5
function parseCronField(field: string, min: number, max: number): number[] {
  const values: number[] = [];
  
  if (field === '*') {
    for (let i = min; i <= max; i++) values.push(i);
    return values;
  }
  
  // Handle */interval
  if (field.startsWith('*/')) {
    const interval = parseInt(field.slice(2), 10);
    for (let i = min; i <= max; i += interval) values.push(i);
    return values;
  }
  
  // Handle comma-separated values
  const parts = field.split(',');
  for (const part of parts) {
    // Handle ranges
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n, 10));
      for (let i = start; i <= end; i++) values.push(i);
    } else {
      values.push(parseInt(part, 10));
    }
  }
  
  return values.filter(v => v >= min && v <= max);
}

/**
 * Check if a date matches a cron expression
 */
function matchesCron(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  
  const [minute, hour, day, month, weekday] = parts;
  
  const minutes = parseCronField(minute, 0, 59);
  const hours = parseCronField(hour, 0, 23);
  const days = parseCronField(day, 1, 31);
  const months = parseCronField(month, 1, 12);
  const weekdays = parseCronField(weekday, 0, 6);
  
  return (
    minutes.includes(date.getMinutes()) &&
    hours.includes(date.getHours()) &&
    days.includes(date.getDate()) &&
    months.includes(date.getMonth() + 1) &&
    weekdays.includes(date.getDay())
  );
}

/**
 * Get next run time for a cron expression
 */
function getNextRunTime(cron: string, after: Date = new Date()): Date {
  const next = new Date(after);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);
  
  // Search up to 1 year ahead
  const maxIterations = 365 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(cron, next)) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }
  
  throw new Error(`Could not find next run time for cron: ${cron}`);
}

interface ScheduledTask extends Schedule {
  nextRun: Date;
  lastRun?: Date;
}

export class Scheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private completedThisMinute: Set<string> = new Set();
  private lastMinute: number = -1;

  constructor(schedules: Schedule[]) {
    for (const schedule of schedules) {
      if (schedule.enabled) {
        this.tasks.set(schedule.id, {
          ...schedule,
          nextRun: getNextRunTime(schedule.cron),
        });
      }
    }
  }

  /**
   * Add or update a schedule
   */
  addSchedule(schedule: Schedule): void {
    if (schedule.enabled) {
      this.tasks.set(schedule.id, {
        ...schedule,
        nextRun: getNextRunTime(schedule.cron),
      });
    } else {
      this.tasks.delete(schedule.id);
    }
  }

  /**
   * Remove a schedule
   */
  removeSchedule(id: string): void {
    this.tasks.delete(id);
  }

  /**
   * Get the next task that's due to run
   */
  getNextDueTask(): ScheduledTask | null {
    const now = new Date();
    const currentMinute = now.getMinutes();
    
    // Reset completed set on new minute
    if (currentMinute !== this.lastMinute) {
      this.completedThisMinute.clear();
      this.lastMinute = currentMinute;
    }
    
    for (const [id, task] of this.tasks) {
      // Skip if already run this minute
      if (this.completedThisMinute.has(id)) continue;
      
      // Check if task is due
      if (task.nextRun <= now) {
        return task;
      }
    }
    
    return null;
  }

  /**
   * Mark a task as completed
   */
  markComplete(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      this.completedThisMinute.add(id);
      task.lastRun = new Date();
      task.nextRun = getNextRunTime(task.cron);
    }
  }

  /**
   * Get time until next scheduled task
   */
  getTimeUntilNext(): number {
    let minTime = Infinity;
    const now = Date.now();
    
    for (const [, task] of this.tasks) {
      const timeUntil = task.nextRun.getTime() - now;
      if (timeUntil > 0 && timeUntil < minTime) {
        minTime = timeUntil;
      }
    }
    
    return minTime === Infinity ? 60000 : minTime;
  }

  /**
   * Get all scheduled tasks
   */
  getAllTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }
}
