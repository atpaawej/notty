/**
 * The `notty` executable.
 *
 * Parses argv, opens the XDG vault, runs one command and exits. Kept thin:
 * all behaviour lives behind `NottyClient` and `runCli`.
 */
import { version } from "../../package.json";
import { createProductionNottyClient } from "../modules/client";
import { runCli } from "./run";
import { updateNotty } from "./update";

const exitCode = await runCli(process.argv.slice(2), {
  openClient: () => createProductionNottyClient(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  version,
  updateApp: (options) => updateNotty({ currentVersion: version, ...options }),
});

process.exitCode = exitCode;
