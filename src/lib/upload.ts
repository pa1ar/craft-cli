import type { CraftClient } from "./client.ts";

export type UploadTarget =
  | { position: "start" | "end"; pageId: string }
  | { position: "start" | "end"; date: string }
  | { position: "before" | "after"; siblingId: string };

export interface UploadResult {
  blockId: string;
  assetUrl: string;
}

export function makeUpload(c: CraftClient) {
  return {
    /** POST /upload with raw binary body. Trial 09 confirmed both image/png and
     * application/octet-stream work. Default to octet-stream unless caller knows. */
    async file(
      bytes: Uint8Array,
      target: UploadTarget,
      contentType: string = "application/octet-stream"
    ): Promise<UploadResult> {
      const query: Record<string, string> = { position: target.position };
      if ("pageId" in target) query.pageId = target.pageId;
      if ("date" in target) query.date = target.date;
      if ("siblingId" in target) query.siblingId = target.siblingId;

      return c.request("POST", "/upload", {
        query,
        rawBody: bytes,
        contentType,
      });
    },
  };
}
