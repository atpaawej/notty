/**
 * In-memory watcher adapter for tests and non-Tauri runtimes.
 *
 * Nothing touches the OS: a test calls `emit` or `emitPath` and the subscribed
 * listener receives the same filtered, debounced events the production
 * adapter would produce.
 */
import {
  isWatchedVaultPath,
  mergeVaultChange,
  vaultRelativePath,
  type VaultChangeEvent,
  type VaultChangeKind,
  type VaultChangeListener,
  type VaultWatcher,
} from "./watch";

export interface MemoryVaultWatcher extends VaultWatcher {
  /** Emit an already vault-relative change. */
  readonly emit: (event: VaultChangeEvent) => void;
  /**
   * Emit a path as the OS would. Absolute paths are made relative to the
   * watched root; relative paths pass through. Filtering applies.
   */
  readonly emitPath: (
    path: string,
    kind?: VaultChangeKind,
    isDirectory?: boolean,
  ) => void;
}

export interface MemoryVaultWatcherOptions {
  /**
   * Trailing debounce in milliseconds. Defaults to `0` so tests are fully
   * synchronous; set it to model a real burst.
   */
  readonly debounceMs?: number;
}

interface Subscription {
  readonly root: string;
  readonly listener: VaultChangeListener;
}

export const createMemoryVaultWatcher = (
  options: MemoryVaultWatcherOptions = {},
): MemoryVaultWatcher => {
  const debounceMs = options.debounceMs ?? 0;
  const subscriptions = new Set<Subscription>();
  const pending = new Map<string, VaultChangeEvent>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dispatch = (events: ReadonlyArray<VaultChangeEvent>): void => {
    for (const event of events) {
      for (const subscription of subscriptions) {
        try {
          void Promise.resolve(subscription.listener(event)).catch(
            (cause: unknown) => {
              console.warn("Notty could not reconcile a vault change", cause);
            },
          );
        } catch (cause) {
          console.warn("Notty could not reconcile a vault change", cause);
        }
      }
    }
  };

  const flush = (): void => {
    timer = null;
    const events = [...pending.values()];
    pending.clear();
    dispatch(events);
  };

  const queue = (event: VaultChangeEvent): void => {
    pending.set(event.path, mergeVaultChange(pending.get(event.path), event));
    if (debounceMs <= 0) {
      flush();
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  return {
    watch: async (vaultRoot, listener) => {
      const subscription: Subscription = { root: vaultRoot, listener };
      subscriptions.add(subscription);
      return () => {
        subscriptions.delete(subscription);
      };
    },
    emit: (event) => {
      if (!isWatchedVaultPath(event.path, event.isDirectory === true)) return;
      queue(event);
    },
    emitPath: (path, kind = "update", isDirectory = false) => {
      // A relative path is measured against every subscription's root; the
      // filter is structural, so any matching root accepts it.
      const roots = [...subscriptions].map((subscription) => subscription.root);
      if (roots.length === 0) {
        const relative = path.replace(/^\/+/, "");
        if (!isWatchedVaultPath(relative, isDirectory)) return;
        queue({ kind, path: relative, ...(isDirectory ? { isDirectory: true } : {}) });
        return;
      }
      for (const root of roots) {
        const relative = vaultRelativePath(root, path);
        if (relative === null) continue;
        if (!isWatchedVaultPath(relative, isDirectory)) continue;
        queue({
          kind,
          path: relative,
          ...(isDirectory ? { isDirectory: true } : {}),
        });
      }
    },
  };
};
