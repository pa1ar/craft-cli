import type { CraftClient } from "./client.ts";
import type { Position } from "./types.ts";

// experimental per docs — keep permissive shapes
export interface WhiteboardElement {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  points?: number[][];
  [key: string]: unknown;
}

export function makeWhiteboards(c: CraftClient) {
  return {
    async create(position: Position): Promise<{ whiteboardBlockId: string }> {
      return c.request("POST", "/whiteboards", { body: { position } });
    },

    async getElements(whiteboardBlockId: string): Promise<{
      elements: WhiteboardElement[];
      assets?: Record<string, unknown>;
      appState?: Record<string, unknown>;
    }> {
      return c.request("GET", `/whiteboards/${whiteboardBlockId}/elements`);
    },

    async addElements(
      whiteboardBlockId: string,
      elements: WhiteboardElement[]
    ): Promise<{ elements: WhiteboardElement[] }> {
      return c.request("POST", `/whiteboards/${whiteboardBlockId}/elements`, {
        body: { elements },
      });
    },

    async updateElements(
      whiteboardBlockId: string,
      elements: WhiteboardElement[]
    ): Promise<{ elements: WhiteboardElement[] }> {
      return c.request("PUT", `/whiteboards/${whiteboardBlockId}/elements`, {
        body: { elements },
      });
    },

    async deleteElements(
      whiteboardBlockId: string,
      elementIds: string[]
    ): Promise<{ deletedCount: number; remainingCount: number }> {
      return c.request("DELETE", `/whiteboards/${whiteboardBlockId}/elements`, {
        body: { elementIds },
      });
    },
  };
}
