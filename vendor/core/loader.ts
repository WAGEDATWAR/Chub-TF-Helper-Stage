export class ContentError extends Error {
  readonly path: string | null;
  constructor(message: string, path?: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = "ContentError";
    this.path = path ?? null;
  }
}

export function parseJson(text: string, path?: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ContentError(`invalid JSON - ${(err as Error).message}`, path);
  }
}

export interface LoadResult {
  contentSet: Record<string, unknown>;
  errors: Array<{ path: string; message: string }>;
}

export function loadContentSet(files: Record<string, string>): LoadResult {
  const contentSet: Record<string, unknown> = {};
  const errors: Array<{ path: string; message: string }> = [];
  for (const [name, text] of Object.entries(files)) {
    try {
      contentSet[name] = parseJson(text, name);
    } catch (err) {
      errors.push({ path: name, message: (err as Error).message });
    }
  }
  return { contentSet, errors };
}

export function requireKeys<T extends object>(obj: T, keys: string[], path?: string): T {
  const record = obj as Record<string, unknown>;
  const missing = keys.filter((k) => record[k] === undefined);
  if (missing.length > 0) {
    throw new ContentError(`missing required key(s): ${missing.join(", ")}`, path);
  }
  return obj;
}

export function requireArray(value: unknown, path?: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ContentError("expected an array", path);
  }
  return value;
}

export function indexById<T extends { id: string }>(entries: readonly T[], path?: string): Map<string, T> {
  requireArray(entries, path);
  const index = new Map<string, T>();
  const duplicates: string[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string") {
      throw new ContentError("entry is missing a string id", path);
    }
    if (index.has(entry.id)) {
      duplicates.push(entry.id);
      continue;
    }
    index.set(entry.id, entry);
  }
  if (duplicates.length > 0) {
    throw new ContentError(`duplicate id(s): ${duplicates.join(", ")}`, path);
  }
  return index;
}
