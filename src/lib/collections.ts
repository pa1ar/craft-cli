import type { CraftClient } from "./client.ts";
import type { Collection, CollectionItem, ItemsResponse, Position } from "./types.ts";

// collection schema shapes are experimental per Craft docs — keep permissive.
export interface CollectionSchema {
  key?: string;
  name: string;
  contentPropDetails?: { key?: string; name: string };
  properties: CollectionProperty[];
  propertyDetails?: unknown[];
}

export interface CollectionProperty {
  key?: string;
  name: string;
  type: string; // "singleSelect" | "date" | "text" | "number" | "select" | ...
  options?: { name: string; color?: string }[];
}

export interface NewCollectionItem {
  title: string;
  properties?: Record<string, unknown>;
}

export interface UpdateCollectionItem {
  id: string;
  title?: string;
  properties?: Record<string, unknown>;
}

export function makeCollections(c: CraftClient) {
  return {
    async list(documentIds?: string | string[]): Promise<ItemsResponse<Collection>> {
      return c.request("GET", "/collections", { query: { documentIds } });
    },

    async create(schema: Partial<CollectionSchema>, position: Position): Promise<{
      collectionBlockId: string;
      name?: string;
      schema?: CollectionSchema;
    }> {
      return c.request("POST", "/collections", { body: { schema, position } });
    },

    async getSchema(
      collectionId: string,
      format: "schema" | "json-schema-items" = "json-schema-items"
    ): Promise<any> {
      return c.request("GET", `/collections/${collectionId}/schema`, { query: { format } });
    },

    async updateSchema(collectionId: string, schema: Partial<CollectionSchema>): Promise<any> {
      return c.request("PUT", `/collections/${collectionId}/schema`, { body: { schema } });
    },

    async getItems(
      collectionId: string,
      maxDepth?: number
    ): Promise<ItemsResponse<CollectionItem>> {
      return c.request("GET", `/collections/${collectionId}/items`, { query: { maxDepth } });
    },

    async addItems(
      collectionId: string,
      items: NewCollectionItem[]
    ): Promise<ItemsResponse<CollectionItem>> {
      return c.request("POST", `/collections/${collectionId}/items`, { body: { items } });
    },

    async updateItems(
      collectionId: string,
      itemsToUpdate: UpdateCollectionItem[]
    ): Promise<ItemsResponse<CollectionItem>> {
      return c.request("PUT", `/collections/${collectionId}/items`, { body: { itemsToUpdate } });
    },

    async deleteItems(
      collectionId: string,
      idsToDelete: string[]
    ): Promise<ItemsResponse<{ id: string }>> {
      return c.request("DELETE", `/collections/${collectionId}/items`, {
        body: { idsToDelete },
      });
    },
  };
}
