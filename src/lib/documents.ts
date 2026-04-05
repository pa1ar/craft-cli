import type { CraftClient } from "./client.ts";
import type {
  Document,
  Location,
  ItemsResponse,
  DocumentSearchHit,
  DateInput,
} from "./types.ts";

export interface ListDocsOptions {
  location?: Location;
  folderId?: string;
  fetchMetadata?: boolean;
  createdDateGte?: DateInput;
  createdDateLte?: DateInput;
  lastModifiedDateGte?: DateInput;
  lastModifiedDateLte?: DateInput;
  dailyNoteDateGte?: DateInput;
  dailyNoteDateLte?: DateInput;
}

export interface SearchDocsOptions {
  include?: string | string[];
  /** Prefer `regexps` over `include`: trial 05 found `include` silently misses
   * tokens with underscores, while regexps works. See CAVEATS.md. */
  regexps?: string | string[];
  documentIds?: string | string[];
  fetchBlocks?: boolean;
  location?: Location;
  folderIds?: string | string[];
  createdDateGte?: DateInput;
  createdDateLte?: DateInput;
  lastModifiedDateGte?: DateInput;
  lastModifiedDateLte?: DateInput;
  dailyNoteDateGte?: DateInput;
  dailyNoteDateLte?: DateInput;
}

export type DocDestination =
  | { folderId: string }
  | { destination: "unsorted" | "templates" };

export interface NewDocument {
  title: string;
}

export function makeDocuments(c: CraftClient) {
  return {
    async list(opts: ListDocsOptions = {}): Promise<ItemsResponse<Document>> {
      return c.request("GET", "/documents", { query: opts as any });
    },

    async search(opts: SearchDocsOptions): Promise<ItemsResponse<DocumentSearchHit>> {
      return c.request("GET", "/documents/search", { query: opts as any });
    },

    async create(
      docs: NewDocument[],
      destination?: DocDestination
    ): Promise<ItemsResponse<Document>> {
      return c.request("POST", "/documents", {
        body: { documents: docs, destination },
      });
    },

    async delete(documentIds: string[]): Promise<{ items: string[] }> {
      return c.request("DELETE", "/documents", { body: { documentIds } });
    },

    async move(
      documentIds: string[],
      destination: DocDestination
    ): Promise<ItemsResponse<{ id: string; destination: DocDestination }>> {
      return c.request("PUT", "/documents/move", {
        body: { documentIds, destination },
      });
    },
  };
}
