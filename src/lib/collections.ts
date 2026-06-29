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

export type CollectionViewType = "table" | "gallery" | "kanban" | string;

export interface CollectionViewPropertyRef {
  propertyId?: string;
  propertyKey?: string;
  propertyName?: string;
  property?: string;
}

export interface CollectionViewSort extends CollectionViewPropertyRef {
  ascending: boolean;
}

export interface CollectionViewFilter extends CollectionViewPropertyRef {
  filterType: string;
  filterValue?: unknown;
}

export interface CollectionViewCalculation extends CollectionViewPropertyRef {
  type: string;
  value?: unknown;
}

export interface CollectionView {
  id?: string;
  name?: string;
  type?: CollectionViewType;
  filters?: CollectionViewFilter[];
  sortBy?: CollectionViewSort[];
  groupBy?: CollectionViewSort[];
  hiddenProperties?: CollectionViewPropertyRef[];
  customPropertyOrder?: CollectionViewPropertyRef[];
  fields?: {
    order?: string[];
    hidden?: string[];
    widths?: Record<string, string>;
  };
  columnWidth?: Record<string, string>;
  calculations?: Record<string, string | CollectionViewCalculation>;
  isCalculationsRowVisible?: boolean;
  gallery?: Record<string, unknown>;
  kanban?: Record<string, unknown>;
  isActive?: boolean;
}

export interface CollectionViewsResponse {
  collectionBlockId: string;
  activeViewId?: string;
  views: CollectionView[];
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

    async listViews(collectionId: string): Promise<CollectionViewsResponse> {
      return c.request("GET", `/collections/${collectionId}/views`);
    },

    async createView(collectionId: string, view: Partial<CollectionView>): Promise<CollectionView> {
      return c.request("POST", `/collections/${collectionId}/views`, { body: { view } });
    },

    async updateView(
      collectionId: string,
      viewId: string,
      view: Partial<CollectionView>
    ): Promise<CollectionView> {
      return c.request("PUT", `/collections/${collectionId}/views/${viewId}`, { body: { view } });
    },

    async deleteView(
      collectionId: string,
      viewId: string
    ): Promise<{ deletedViewId: string; activeViewId?: string }> {
      return c.request("DELETE", `/collections/${collectionId}/views/${viewId}`);
    },

    async setActiveView(collectionId: string, viewId: string): Promise<CollectionView> {
      return c.request("PUT", `/collections/${collectionId}/active-view`, { body: { viewId } });
    },
  };
}
