/**
 * workspace — owns the three-column shell, selection and auto-save.
 *
 * Public interface: the `Workspace` React shell, the `NoteStore` persistence
 * seam it needs, and the framework-free controller behind it.
 */
export { Workspace } from "./Workspace";
export type { WorkspaceAttachments, WorkspaceProps } from "./Workspace";
export { createWorkspace } from "./workspace";
export type {
  EditorNote,
  NoteStore,
  WorkspaceController,
  WorkspaceOptions,
  WorkspaceState,
} from "./workspace";
