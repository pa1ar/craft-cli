import type { CraftClient } from "./client.ts";
import type { Folder, ItemsResponse } from "./types.ts";

export interface NewFolder {
  name: string;
  parentFolderId?: string;
}

export type FolderDestination = "root" | { parentFolderId: string };

export function makeFolders(c: CraftClient) {
  return {
    async list(): Promise<ItemsResponse<Folder>> {
      return c.request("GET", "/folders");
    },

    async create(folders: NewFolder[]): Promise<ItemsResponse<Folder>> {
      return c.request("POST", "/folders", { body: { folders } });
    },

    async delete(folderIds: string[]): Promise<{ items: string[] }> {
      return c.request("DELETE", "/folders", { body: { folderIds } });
    },

    async move(
      folderIds: string[],
      destination: FolderDestination
    ): Promise<ItemsResponse<{ id: string; destination: FolderDestination }>> {
      return c.request("PUT", "/folders/move", { body: { folderIds, destination } });
    },
  };
}
