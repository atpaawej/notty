/**
 * Production watcher adapter for the Tauri WebView.
 *
 * Uses the official `tauri-plugin-fs` recursive watcher, which maps to Linux
 * inotify. The raw OS events are filtered and debounced here before they reach
 * the workspace; no custom Rust code is involved.
 */
import {
  watchImmediate,
  type WatchEvent,
  type WatchEventKind,
} from "@tauri-apps/plugin-fs";
import {
  isWatchedVaultPath,
  mergeVaultChange,
  vaultRelativePath,
  WATCH_DEBOUNCE_MS,
  type VaultChangeEvent,
  type VaultChangeKind,
  type VaultWatcher,
} from "./watch";

interface ClassifiedChange {
  readonly kind: VaultChangeKind;
  readonly isDirectory: boolean;
}

const classify = (type: WatchEventKind): ClassifiedChange => {
  if (typeof type === "string") {
    // "any" and "other" carry no direction; let the index's stat decide
    // whether the note still exists.
    return { kind: "update", isDirectory: false };
  }
  if ("create" in type) {
    return { kind: "create", isDirectory: type.create.kind === "folder" };
  }
  if ("remove" in type) {
    return { kind: "remove", isDirectory: type.remove.kind === "folder" };
  }
  return { kind: "update", isDirectory: false };
};

/** Map one native event path to a vault change, or `null` when ignored. */
export const vaultChangeFromWatch = (
  vaultRoot: string,
  type: WatchEventKind,
  path: string,
): VaultChangeEvent | null => {
  const relative = vaultRelativePath(vaultRoot, path);
  if (relative === null) return null;

  const { kind, isDirectory } = classify(type);
  if (!isWatchedVaultPath(relative, isDirectory)) return null;

  return {
    kind,
    path: relative,
    ...(isDirectory ? { isDirectory: true } : {}),
  };
};

/**
 * Watch the vault root recursively. Events are grouped into a trailing 50 ms
 * window, so a burst from `git checkout` or an agent touching twenty notes
 * costs one reconcile per path instead of twenty render passes.
 */
export const watchVault: VaultWatcher["watch"] = async (
  vaultRoot,
  onChange,
) => {
  const pending = new Map<string, VaultChangeEvent>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    const events = [...pending.values()];
    pending.clear();
    for (const event of events) {
      try {
        void Promise.resolve(onChange(event)).catch((cause: unknown) => {
          console.warn("Notty could not reconcile a vault change", cause);
        });
      } catch (cause) {
        console.warn("Notty could not reconcile a vault change", cause);
      }
    }
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, WATCH_DEBOUNCE_MS);
  };

  const unwatch = await watchImmediate(
    vaultRoot,
    (event: WatchEvent) => {
      for (const path of event.paths) {
        const change = vaultChangeFromWatch(vaultRoot, event.type, path);
        if (change === null) continue;
        pending.set(change.path, mergeVaultChange(pending.get(change.path), change));
      }
      if (pending.size > 0) schedule();
    },
    { recursive: true },
  );

  return () => {
    unwatch();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending.clear();
  };
};
