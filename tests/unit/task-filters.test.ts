import { describe, expect, test } from "bun:test";
import type { Task } from "../../src/lib/types.ts";
import {
  filterTasks,
  getTaskPriority,
  parseTaskLocation,
  parseTaskState,
  parseYesNo,
  resolveTaskDate,
} from "../../src/cli/task-filters.ts";

const tasks: Task[] = [
  {
    id: "inbox",
    markdown: "- [ ] Buy milk",
    taskInfo: { state: "todo" },
    location: { type: "inbox" },
  },
  {
    id: "project",
    markdown: "- [ ] Ship task explorer",
    taskInfo: { state: "todo", scheduleDate: "2026-07-18", deadlineDate: "2026-07-20" },
    location: { type: "document", documentId: "doc-1", title: "Craft CLI" },
  },
  {
    id: "overdue",
    markdown: "- [ ] File report",
    taskInfo: { state: "todo", deadlineDate: "2026-07-17", priority: "High" },
    location: { type: "dailyNote", date: "2026-07-16" },
    repeat: {
      type: "flexible",
      frequency: "monthly",
      reminder: { enabled: true, dateOffset: 540 },
    },
  },
  {
    id: "done",
    markdown: "- [x] Old task",
    taskInfo: { state: "done", scheduleDate: "2026-07-10" },
    location: { type: "document", documentId: "doc-2", title: "Archive" },
    reminder: { enabled: true },
  },
];

describe("task filter parsing", () => {
  test("normalizes state, location, and yes/no values", () => {
    expect(parseTaskState("TODO")).toBe("todo");
    expect(parseTaskLocation("daily-note")).toBe("dailyNote");
    expect(parseYesNo("enabled", "--reminder")).toBe("yes");
    expect(parseYesNo("0", "--repeat")).toBe("no");
  });

  test("rejects invalid filter values", () => {
    expect(() => parseTaskState("open")).toThrow("todo|done|canceled");
    expect(() => parseTaskLocation("calendar")).toThrow("inbox|document|daily");
    expect(() => parseYesNo("maybe", "--repeat")).toThrow("yes|no");
  });

  test("resolves relative dates and validates calendar dates", () => {
    expect(resolveTaskDate("today", "2026-07-18")).toBe("2026-07-18");
    expect(resolveTaskDate("yesterday", "2026-07-18")).toBe("2026-07-17");
    expect(resolveTaskDate("tomorrow", "2026-07-18")).toBe("2026-07-19");
    expect(() => resolveTaskDate("2026-02-30", "2026-07-18")).toThrow("invalid date");
  });
});

describe("filterTasks", () => {
  test("composes state, document, location, and text filters", () => {
    expect(filterTasks(tasks, { state: "todo" }).map((task) => task.id)).toEqual(["inbox", "project", "overdue"]);
    expect(filterTasks(tasks, { documentId: "doc-1" }).map((task) => task.id)).toEqual(["project"]);
    expect(filterTasks(tasks, { documentTitle: "craft" }).map((task) => task.id)).toEqual(["project"]);
    expect(filterTasks(tasks, { location: "inbox", text: "milk" }).map((task) => task.id)).toEqual(["inbox"]);
  });

  test("filters exact and ranged task dates", () => {
    expect(filterTasks(tasks, { date: "2026-07-16" }).map((task) => task.id)).toEqual(["overdue"]);
    expect(filterTasks(tasks, { scheduled: "today" }, "2026-07-18").map((task) => task.id)).toEqual(["project"]);
    expect(filterTasks(tasks, { scheduled: "NONE" }).map((task) => task.id)).toEqual(["inbox", "overdue"]);
    expect(filterTasks(tasks, { deadlineFrom: "2026-07-18", deadlineTo: "2026-07-21" }).map((task) => task.id)).toEqual(["project"]);
    expect(filterTasks(tasks, { dateFrom: "2026-07-19", dateTo: "2026-07-19" })).toEqual([]);
    expect(() => filterTasks(tasks, { dateFrom: "2026-07-20", dateTo: "2026-07-18" })).toThrow("on or before");
  });

  test("filters repeat, reminder, overdue, and forward-compatible priority", () => {
    expect(filterTasks(tasks, { repeat: "yes" }).map((task) => task.id)).toEqual(["overdue"]);
    expect(filterTasks(tasks, { reminder: "yes" }).map((task) => task.id)).toEqual(["overdue", "done"]);
    expect(filterTasks(tasks, { overdue: true }, "2026-07-18").map((task) => task.id)).toEqual(["overdue"]);
    expect(filterTasks(tasks, { priority: "high" }).map((task) => task.id)).toEqual(["overdue"]);
    expect(filterTasks(tasks, { priority: "none" }).map((task) => task.id)).toEqual(["inbox", "project", "done"]);
    expect(getTaskPriority(tasks[2]!)).toBe("High");
  });
});
