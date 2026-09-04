// hand-written types from craft-do-openapi.json + trial findings.
// keep permissive where the API is inconsistent — prefer optional fields over strict enums.

export type DateInput = string; // "YYYY-MM-DD" | "today" | "yesterday" | "tomorrow"

export type SeparatorStyle = "line" | "doodle" | "washi" | `washi(${string})`;

export interface PageCoverImage {
  url: string;
  aspectRatio?: number;
  backgroundColor?: string;
  width?: number;
  hasTransparency?: boolean;
  unsplashAttribution?: string;
  cropMask?: { x?: number; y?: number; width?: number; height?: number };
}

export interface PageStyling {
  coverImage?: PageCoverImage;
  pageWidth?: string;
  fontFamily?: "system" | "system-serif" | "system-rounded" | "system-mono" | string;
  textColor?: string;
  backgroundColor?: string;
  backdrop?: string;
  themeId?: string;
  separatorStyle?: SeparatorStyle;
  themeColor?: string;
}

export interface Block {
  id: string;
  type: string; // "page" | "text" | "image" | "collection" | "whiteboard" | ...
  textStyle?: string;
  markdown?: string;
  url?: string;
  altText?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  size?: string;
  width?: number;
  aspectRatio?: number;
  font?: string;
  styling?: PageStyling;
  separatorStyle?: SeparatorStyle;
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

export type TaskScope = "all" | "inbox" | "active" | "upcoming" | "logbook" | "document";
export type TaskState = "todo" | "done" | "canceled";

export interface TaskInfo {
  state?: TaskState;
  scheduleDate?: DateInput | null;
  deadlineDate?: DateInput | null;
  /** Forward-compatible: the live API does not currently expose task priority. */
  priority?: string | number;
  /** Forward-compatible: current responses nest reminders under repeat. */
  reminder?: TaskReminder;
}

export type TaskLocation =
  | { type: "inbox" }
  | { type: "dailyNote"; date: DateInput }
  | { type: "document"; documentId: string; title?: string };

export interface TaskReminder {
  enabled: boolean;
  dateOffset?: number;
}

export interface TaskRepeat {
  type?: "flexible" | "fixed" | string;
  frequency?: "daily" | "weekly" | "monthly" | "yearly" | string;
  interval?: number;
  startDate?: DateInput;
  reminder?: TaskReminder;
  [key: string]: unknown;
}

export interface Task {
  id: string;
  markdown: string;
  taskInfo?: TaskInfo;
  location?: TaskLocation;
  repeat?: TaskRepeat;
  /** Forward-compatible: current responses nest reminders under repeat. */
  reminder?: TaskReminder;
  /** Forward-compatible: the live API does not currently expose task priority. */
  priority?: string | number;
  completedAt?: string;
  canceledAt?: string;
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
