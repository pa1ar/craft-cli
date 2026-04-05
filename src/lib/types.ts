// hand-written types from craft-do-openapi.json + trial findings.
// keep permissive where the API is inconsistent — prefer optional fields over strict enums.

export type DateInput = string; // "YYYY-MM-DD" | "today" | "yesterday" | "tomorrow"

export interface Block {
  id: string;
  type: string; // "page" | "text" | "image" | "collection" | "whiteboard" | ...
  textStyle?: string;
  markdown?: string;
  url?: string;
  altText?: string;
  font?: string;
  content?: Block[];
  metadata?: BlockMetadata;
}

export interface BlockMetadata {
  createdAt?: string;
  lastModifiedAt?: string;
  createdBy?: string;
  lastModifiedBy?: string;
  comments?: unknown[];
  /** Deeplink to open this block in the Craft app. Present when fetchMetadata=true. */
  clickableLink?: string;
}

/** A link discovered in a block's markdown, either incoming (backlink) or outgoing. */
export interface BlockLink {
  /** block id of the target (for outgoing) or source (for incoming) */
  blockId: string;
  /** the visible anchor text of the link */
  text: string;
  /** block id of the block that CONTAINS the link markdown */
  inBlockId: string;
  /** document id of the block that contains the link */
  inDocumentId: string;
}

export type Position =
  | { position: "start" | "end"; pageId: string }
  | { position: "start" | "end"; date: DateInput };

export interface Document {
  id: string;
  title: string;
  lastModifiedAt?: string;
  createdAt?: string;
  clickableLink?: string;
  dailyNoteDate?: string;
}

export type Location = "unsorted" | "trash" | "templates" | "daily_notes";

export interface Folder {
  id: string;
  name: string;
  documentCount?: number;
  folders?: Folder[];
  parentFolderId?: string;
}

export interface Collection {
  id: string;
  name: string;
  itemCount?: number;
  documentId?: string;
}

export interface CollectionItem {
  id: string;
  title: string;
  properties?: Record<string, unknown>;
  content?: Block[];
}

export type TaskScope = "inbox" | "active" | "upcoming" | "logbook" | "document";
export type TaskState = "todo" | "done" | "canceled";

export interface TaskInfo {
  state?: TaskState;
  scheduleDate?: DateInput;
  deadlineDate?: DateInput;
}

export type TaskLocation =
  | { type: "inbox" }
  | { type: "dailyNote"; date: DateInput }
  | { type: "document"; documentId: string };

export interface Task {
  id: string;
  markdown: string;
  taskInfo?: TaskInfo;
}

export interface ConnectionInfo {
  space: { id: string; name: string; timezone: string; time: string; friendlyDate: string };
  utc: { time: string };
  urlTemplates: { app: string };
}

// wrapper most list responses use
export interface ItemsResponse<T> {
  items: T[];
}

export interface DocumentSearchHit {
  documentId: string;
  markdown: string;
  blockIds: string[];
  blocks?: Block[];
}

export interface BlockSearchHit {
  blockId: string;
  markdown: string;
  pageBlockPath?: { id: string; content: string }[];
  beforeBlocks?: { blockId: string; markdown: string }[];
  afterBlocks?: { blockId: string; markdown: string }[];
}
