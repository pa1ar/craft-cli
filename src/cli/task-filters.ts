import type { Task, TaskLocation, TaskState } from "../lib/types.ts";

export type YesNo = "yes" | "no";

export interface TaskFilters {
  state?: TaskState;
  documentId?: string;
  documentTitle?: string;
  location?: TaskLocation["type"];
  text?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  scheduled?: string | "none";
  scheduledFrom?: string;
  scheduledTo?: string;
  deadline?: string | "none";
  deadlineFrom?: string;
  deadlineTo?: string;
  priority?: string;
  repeat?: YesNo;
  reminder?: YesNo;
  overdue?: boolean;
}

const TASK_STATES = new Set<TaskState>(["todo", "done", "canceled"]);

export function parseTaskState(value: unknown): TaskState | undefined {
  if (value === undefined) return undefined;
  const state = String(value).trim().toLowerCase() as TaskState;
  if (!TASK_STATES.has(state)) throw new Error("--state must be todo|done|canceled");
  return state;
}

export function parseTaskLocation(value: unknown): TaskLocation["type"] | undefined {
  if (value === undefined) return undefined;
  const location = String(value).trim().toLowerCase();
  if (location === "daily" || location === "daily-note" || location === "dailynote") return "dailyNote";
  if (location === "document" || location === "doc") return "document";
  if (location === "inbox") return "inbox";
  throw new Error("--location must be inbox|document|daily");
}

export function parseYesNo(value: unknown, flag: string): YesNo | undefined {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (["yes", "true", "on", "enabled", "1"].includes(normalized)) return "yes";
  if (["no", "false", "off", "disabled", "0"].includes(normalized)) return "no";
  throw new Error(`${flag} must be yes|no`);
}

export function resolveTaskDate(value: string, today = localIsoDate()): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "today") return today;
  if (normalized === "yesterday") return shiftIsoDate(today, -1);
  if (normalized === "tomorrow") return shiftIsoDate(today, 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !isRealIsoDate(normalized)) {
    throw new Error(`invalid date: ${value} (use YYYY-MM-DD, today, yesterday, or tomorrow)`);
  }
  return normalized;
}

export function getTaskPriority(task: Task): string | undefined {
  const value = task.priority ?? task.taskInfo?.priority;
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

export function filterTasks(tasks: Task[], filters: TaskFilters, today = localIsoDate()): Task[] {
  const date = filters.date ? resolveTaskDate(filters.date, today) : undefined;
  const dateFrom = filters.dateFrom ? resolveTaskDate(filters.dateFrom, today) : undefined;
  const dateTo = filters.dateTo ? resolveTaskDate(filters.dateTo, today) : undefined;
  const scheduledInput = filters.scheduled?.trim().toLowerCase();
  const scheduled = scheduledInput && scheduledInput !== "none"
    ? resolveTaskDate(scheduledInput, today)
    : scheduledInput;
  const scheduledFrom = filters.scheduledFrom ? resolveTaskDate(filters.scheduledFrom, today) : undefined;
  const scheduledTo = filters.scheduledTo ? resolveTaskDate(filters.scheduledTo, today) : undefined;
  const deadlineInput = filters.deadline?.trim().toLowerCase();
  const deadline = deadlineInput && deadlineInput !== "none"
    ? resolveTaskDate(deadlineInput, today)
    : deadlineInput;
  const deadlineFrom = filters.deadlineFrom ? resolveTaskDate(filters.deadlineFrom, today) : undefined;
  const deadlineTo = filters.deadlineTo ? resolveTaskDate(filters.deadlineTo, today) : undefined;
  const documentTitle = filters.documentTitle?.trim().toLowerCase();
  const text = filters.text?.trim().toLowerCase();
  const priority = filters.priority?.trim().toLowerCase();
  assertDateRange(dateFrom, dateTo, "--date-from", "--date-to");
  assertDateRange(scheduledFrom, scheduledTo, "--scheduled-from", "--scheduled-to");
  assertDateRange(deadlineFrom, deadlineTo, "--deadline-from", "--deadline-to");

  return tasks.filter((task) => {
    if (filters.state && task.taskInfo?.state !== filters.state) return false;
    if (filters.documentId && (task.location?.type !== "document" || task.location.documentId !== filters.documentId)) return false;
    if (documentTitle && (task.location?.type !== "document" || !task.location.title?.toLowerCase().includes(documentTitle))) return false;
    if (filters.location && task.location?.type !== filters.location) return false;
    if (text && !task.markdown.toLowerCase().includes(text)) return false;

    const taskDates = [
      task.taskInfo?.scheduleDate,
      task.taskInfo?.deadlineDate,
      task.location?.type === "dailyNote" ? task.location.date : undefined,
    ].filter((value): value is string => typeof value === "string");
    if (date && !taskDates.includes(date)) return false;
    if ((dateFrom || dateTo) && !taskDates.some((value) =>
      (!dateFrom || value >= dateFrom) && (!dateTo || value <= dateTo)
    )) return false;

    const scheduleDate = task.taskInfo?.scheduleDate ?? undefined;
    if (scheduled === "none" && scheduleDate) return false;
    if (scheduled && scheduled !== "none" && scheduleDate !== scheduled) return false;
    if (scheduledFrom && (!scheduleDate || scheduleDate < scheduledFrom)) return false;
    if (scheduledTo && (!scheduleDate || scheduleDate > scheduledTo)) return false;

    const deadlineDate = task.taskInfo?.deadlineDate ?? undefined;
    if (deadline === "none" && deadlineDate) return false;
    if (deadline && deadline !== "none" && deadlineDate !== deadline) return false;
    if (deadlineFrom && (!deadlineDate || deadlineDate < deadlineFrom)) return false;
    if (deadlineTo && (!deadlineDate || deadlineDate > deadlineTo)) return false;

    const taskPriority = getTaskPriority(task)?.toLowerCase();
    if (priority === "none" && taskPriority) return false;
    if (priority && priority !== "none" && taskPriority !== priority) return false;

    const hasRepeat = task.repeat !== undefined && task.repeat !== null;
    if (filters.repeat === "yes" && !hasRepeat) return false;
    if (filters.repeat === "no" && hasRepeat) return false;

    const hasReminder = task.reminder?.enabled === true
      || task.taskInfo?.reminder?.enabled === true
      || task.repeat?.reminder?.enabled === true;
    if (filters.reminder === "yes" && !hasReminder) return false;
    if (filters.reminder === "no" && hasReminder) return false;

    if (filters.overdue && (task.taskInfo?.state !== "todo" || !deadlineDate || deadlineDate >= today)) return false;
    return true;
  });
}

function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftIsoDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

function isRealIsoDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

function assertDateRange(from: string | undefined, to: string | undefined, fromFlag: string, toFlag: string): void {
  if (from && to && from > to) throw new Error(`${fromFlag} must be on or before ${toFlag}`);
}
