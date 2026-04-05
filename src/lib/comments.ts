import type { CraftClient } from "./client.ts";
import type { ItemsResponse } from "./types.ts";

export interface NewComment {
  blockId: string;
  content: string;
}

export function makeComments(c: CraftClient) {
  return {
    async add(comments: NewComment[]): Promise<ItemsResponse<{ commentId: string }>> {
      return c.request("POST", "/comments", { body: { comments } });
    },
  };
}
