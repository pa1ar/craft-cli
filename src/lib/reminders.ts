import type { CraftClient } from "./client.ts";
import type { ItemsResponse } from "./types.ts";

export type ReminderStatus = "incomplete" | "completed" | "upcoming" | "all";

export interface BlockReminder {
  id: string;
  title: string;
  blockId: string;
  remindAt?: string;
  isCompleted: boolean;
  completedAt?: string;
}

export interface ListRemindersOptions {
  status?: ReminderStatus;
  limit?: number;
  cursor?: string;
}

export interface RemindersListResponse extends ItemsResponse<BlockReminder> {
  pagination?: { cursor: string };
}

export interface NewBlockReminder {
  blockId: string;
  /** ISO 8601 timestamp with a UTC offset. Omit or pass null to Save for later. */
  remindAt?: string | null;
}

export interface BlockReminderUpdate {
  id: string;
  /** Omit to preserve the time; null clears it and keeps Save for later. */
  remindAt?: string | null;
  /** Completing a reminder does not complete a task on the same block. */
  isCompleted?: boolean;
}

export function makeReminders(c: CraftClient) {
  return {
    /** Experimental GET /reminders. Defaults to incomplete reminders. */
    async list(opts: ListRemindersOptions = {}): Promise<RemindersListResponse> {
      return c.request("GET", "/reminders", {
        query: {
          status: opts.status,
          limit: opts.limit,
          cursor: opts.cursor,
        },
      });
    },

    /** Experimental POST /reminders. Sets or replaces reminders on blocks. */
    async create(reminders: NewBlockReminder[]): Promise<ItemsResponse<BlockReminder>> {
      return c.request("POST", "/reminders", { body: { reminders } });
    },

    /** Experimental PUT /reminders. Only provided fields are changed. */
    async update(remindersToUpdate: BlockReminderUpdate[]): Promise<ItemsResponse<BlockReminder>> {
      return c.request("PUT", "/reminders", { body: { remindersToUpdate } });
    },

    /** Experimental DELETE /reminders. The attached blocks are not deleted. */
    async delete(idsToDelete: string[]): Promise<ItemsResponse<string>> {
      return c.request("DELETE", "/reminders", { body: { idsToDelete } });
    },
  };
}
