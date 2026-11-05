/**
 * Private: the Vault service definition and pure path resolution.
 * Imported by the adapters and re-exported by ./index — never import this
 * file from outside the module.
 *
 * This file must stay dependency-free and I/O-free: it is shared by the
 * browser bundle, the test suite and (later) any Node tooling.
 */
import { Context, type Effect } from "effect";

export interface VaultPaths {
  readonly root: string;
  readonly attachments: string;
  readonly internal: string;
}

/** POSIX join without node:path, so this module is bundle-safe. */
const joinPath = (base: string, ...segments: string[]): string =>
  [base.replace(/\/+$/, ""), ...segments].join("/").replace(/\/{2,}/g, "/");

/** Pure path resolution, exposed for tests. No I/O happens here. */
export const resolveVaultPaths = (
  xdgDataHome: string | undefined,
  home: string,
): VaultPaths => {
  const base =
    xdgDataHome && xdgDataHome.trim().length > 0
      ? xdgDataHome
      : joinPath(home, ".local", "share");
  const root = joinPath(base, "notty", "vault");
  return {
    root,
    attachments: joinPath(root, "attachments"),
    internal: joinPath(root, ".notty"),
  };
};

export interface VaultShape {
  readonly location: () => Effect.Effect<VaultPaths>;
}

export class Vault extends Context.Service<Vault, VaultShape>()("notty/Vault") {}
