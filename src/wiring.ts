/**
 * Production wiring (Node side of the app): the composed Layer for real
 * runtime code. The browser entry does not import this file — the webview
 * has no Node builtins; Tauri commands own OS-level facts there.
 *
 * Tests compose `vaultMemoryLayer` instead — no module code changes.
 * The browser bundle will fail the build if this file is ever pulled in.
 */
import { vaultProductionLayer } from "./modules/vault";

// A single service today; more adapters join this composition as the
// later modules land.
export const appLayer = vaultProductionLayer;
