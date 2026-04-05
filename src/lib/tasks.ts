import type { CraftClient } from "./client.ts";
import type { Task, TaskScope, TaskInfo, TaskLocation, ItemsResponse } from "./types.ts";

export interface NewTask {
  markdown: string;
  taskInfo?: TaskInfo;
  location: TaskLocation;
}

export interface TaskUpdate {
  id: string;
  markdown?: string;
  taskInfo?: TaskInfo;
  location?: TaskLocation;
}

export function makeTasks(c: CraftClient) {
  return {
    async list(scope: TaskScope, documentId?: string): Promise<ItemsResponse<Task>> {
      return c.request("GET", "/tasks", { query: { scope, documentId } });
    },

    async add(tasks: NewTask[]): Promise<ItemsResponse<Task>> {
      return c.request("POST", "/tasks", { body: { tasks } });
    },

    async update(tasksToUpdate: TaskUpdate[]): Promise<ItemsResponse<Task>> {
      return c.request("PUT", "/tasks", { body: { tasksToUpdate } });
    },

    async delete(idsToDelete: string[]): Promise<ItemsResponse<{ id: string }>> {
      return c.request("DELETE", "/tasks", { body: { idsToDelete } });
    },
  };
}
