// local-media.ts - read-only resolution of Craft's on-device media assets.
// CLI-only module. Craft owns these files; callers must never edit them in place.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const CONTAINER_IDS = [
  "com.lukilabs.lukiapp",
  "com.lukilabs.lukiapp-setapp",
] as const;

export type LocalMediaVariant = "full" | "preview" | "external" | "unknown";

export interface LocalMediaAsset {
  blockId: string;
  spaceId: string;
  assetId: string;
  path: string;
  url: string;
  fileName?: string;
  size?: number;
  variant: LocalMediaVariant;
  indexPath: string;
}

interface OnDeviceAssetEntry {
  assetId?: string;
  blockIds?: string[];
  size?: number;
  url?: string;
}

interface OnDeviceAssetIndex {
  onDeviceAssetsByUrl?: Record<string, OnDeviceAssetEntry>;
}

export interface FindLocalMediaOptions {
  roots?: string[];
}

export function findLocalMediaAssets(
  blockId: string,
  options: FindLocalMediaOptions = {},
): LocalMediaAsset[] {
  const matches: LocalMediaAsset[] = [];
  for (const indexPath of discoverAssetIndexes(options.roots)) {
    const index = readAssetIndex(indexPath);
    if (!index?.onDeviceAssetsByUrl) continue;
    const assetDir = dirname(indexPath);
    const spaceId = basename(assetDir);

    for (const [urlKey, entry] of Object.entries(index.onDeviceAssetsByUrl)) {
      if (!entry.blockIds?.some((id) => id.toLowerCase() === blockId.toLowerCase())) continue;
      if (!entry.assetId) continue;
      const path = join(assetDir, entry.assetId);
      if (!existsSync(path)) continue;
      const url = entry.url ?? urlKey;
      matches.push({
        blockId,
        spaceId,
        assetId: entry.assetId,
        path,
        url,
        fileName: fileNameFromUrl(url),
        size: entry.size,
        variant: variantFromUrl(url),
        indexPath,
      });
    }
  }

  return matches.sort(compareAssets);
}

export function preferredLocalMediaAsset(
  blockId: string,
  options: FindLocalMediaOptions = {},
): LocalMediaAsset | null {
  return findLocalMediaAssets(blockId, options)[0] ?? null;
}

export function discoverAssetIndexes(roots?: string[]): string[] {
  const candidates = roots ?? defaultAssetRoots();
  const indexes = new Set<string>();
  for (const candidate of candidates) {
    if (basename(candidate) === "index.json" && existsSync(candidate)) {
      indexes.add(candidate);
      continue;
    }
    const direct = join(candidate, "index.json");
    if (existsSync(direct)) indexes.add(direct);
    if (!existsSync(candidate)) continue;
    try {
      for (const entry of readdirSync(candidate, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const indexPath = join(candidate, entry.name, "index.json");
        if (existsSync(indexPath)) indexes.add(indexPath);
      }
    } catch {
      // An unavailable Craft container is equivalent to no local media.
    }
  }
  return Array.from(indexes);
}

function defaultAssetRoots(): string[] {
  const explicit = process.env.CRAFT_ON_DEVICE_ASSETS_PATH;
  if (explicit) return [explicit];

  const roots: string[] = [];
  const localPath = process.env.CRAFT_LOCAL_PATH;
  if (localPath) roots.push(join(dirname(localPath), "OnDeviceAssets"));
  for (const containerId of CONTAINER_IDS) {
    roots.push(join(
      homedir(),
      "Library/Containers",
      containerId,
      "Data/Library/Application Support/OnDeviceAssets",
    ));
  }
  return roots;
}

function readAssetIndex(path: string): OnDeviceAssetIndex | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as OnDeviceAssetIndex;
  } catch {
    return null;
  }
}

function variantFromUrl(url: string): LocalMediaVariant {
  if (url.includes("/user/full/")) return "full";
  if (url.includes("/user/preview/")) return "preview";
  if (/^https?:\/\//.test(url)) return "external";
  return "unknown";
}

function fileNameFromUrl(url: string): string | undefined {
  try {
    const value = decodeURIComponent(basename(new URL(url).pathname));
    return value || undefined;
  } catch {
    return undefined;
  }
}

function compareAssets(a: LocalMediaAsset, b: LocalMediaAsset): number {
  const rank: Record<LocalMediaVariant, number> = {
    full: 0,
    external: 1,
    unknown: 2,
    preview: 3,
  };
  return rank[a.variant] - rank[b.variant]
    || (b.size ?? 0) - (a.size ?? 0)
    || a.path.localeCompare(b.path);
}
