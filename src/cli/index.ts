/**
 * cli — the `notty` executable adapter.
 *
 * Public interface: argument parsing, output formatting and `runCli`. The
 * executable entry point lives in `main.ts`.
 */
export { HELP_TEXT, CliUsageError, parseArgv } from "./args";
export type { CliCommand } from "./args";
export { runCli } from "./run";
export type { CliHooks } from "./run";
export { installSkill, SKILL_TEXT, SKILL_REPOSITORY } from "./skill";
export type { SkillInstallResult } from "./skill";
export { json, noteJson, noteMarkdown, summaryJson, summaryLine } from "./format";
