/**
 * Module boundary enforcement.
 *
 * Every module exposes exactly one public interface: its `index.ts`.
 * Everything else in the module folder is private. These rules make
 * importing past an interface fail CI, not code review.
 */
const MODULES = [
  "vault",
  "note-file",
  "note-index",
  "client",
  "editor",
  "workspace",
  "hotkey",
  "updater",
];

const boundaryRules = MODULES.map((mod) => ({
  name: `no-cross-module-internals-${mod}`,
  severity: "error",
  comment: `Files in modules/${mod} may import other modules only through their index.ts.`,
  from: { path: `^src/modules/${mod}/` },
  to: {
    path: `^src/modules/(?!${mod}/)[^/]+/.+`,
    pathNot: `^src/modules/(?!${mod}/)[^/]+/index\\.ts$`,
  },
}));

module.exports = {
  forbidden: [
    // Files outside the module tree may import a module's index.ts only.
    {
      name: "no-import-past-module-interface",
      severity: "error",
      comment: "Import only a module's index.ts — never its private files.",
      from: { pathNot: "^src/modules/[^/]+/" },
      to: {
        path: "^src/modules/[^/]+/.+",
        pathNot: "^src/modules/[^/]+/index\\.ts$",
      },
    },
    ...boundaryRules,
    // no-unresolvable intentionally omitted: dependency-cruiser 18 cannot
    // resolve effect v4's `exports` map, and the compiler already guarantees
    // imports resolve. The boundary rules below are the point.
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make modules unverifiable in isolation.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: [
        "npm",
        "npm-dev",
        "npm-optional",
        "npm-peer",
        "npm-bundled",
        "npm-no-pkg",
      ],
    },
    exclude: { path: "\\.test\\.ts$" },
    tsPreCompilationDeps: true,
  },
};
