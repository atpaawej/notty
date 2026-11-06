/**
 * The Agent Skill: the Markdown that teaches a local agent to use `notty`.
 *
 * It is bundled into the CLI so `notty skill print` works from `/usr/bin`
 * without the repository present.
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import skillText from "../../skills/notty/SKILL.md?raw";

export const SKILL_TEXT = skillText;
export const SKILL_REPOSITORY = "atpaawej/notty";
export const SKILL_PATH = ".agents/skills/notty/SKILL.md";

export interface SkillRunResult {
  readonly status: number | null;
  readonly error?: Error;
}

export interface InstallSkillOptions {
  /** Defaults to `$HOME` (the system home directory as a fallback). */
  readonly home?: string;
  /** The `skills` executable. Defaults to `skills`. */
  readonly command?: string;
  /** Test seam for running the `skills` CLI. */
  readonly run?: (command: string, args: ReadonlyArray<string>) => SkillRunResult;
  /** Skill contents to write in the fallback path. */
  readonly text?: string;
}

export interface SkillInstallResult {
  readonly method: "skills" | "file";
  /** Present when the direct-placement fallback ran. */
  readonly path?: string;
}

const runSkillsCli = (
  command: string,
  args: ReadonlyArray<string>,
): SkillRunResult => {
  const result = spawnSync(command, [...args], { stdio: "inherit" });
  return {
    status: result.status,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
};

/**
 * Register the skill with every agent the `skills` CLI knows about. When that
 * executable is unavailable, place `SKILL.md` where agents already scan.
 */
export const installSkill = async (
  options: InstallSkillOptions = {},
): Promise<SkillInstallResult> => {
  const command = options.command ?? "skills";
  const run = options.run ?? runSkillsCli;
  const result = run(command, ["add", SKILL_REPOSITORY, "-g", "-y"]);

  if (result.error === undefined && result.status === 0) {
    return { method: "skills" };
  }

  const home = options.home ?? process.env.HOME ?? homedir();
  const path = join(home, SKILL_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, options.text ?? SKILL_TEXT, "utf8");
  return { method: "file", path };
};
