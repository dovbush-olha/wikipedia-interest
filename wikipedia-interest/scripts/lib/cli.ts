import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

// A failure the agent can fix by changing its input; the message always says how.
export class UserError extends Error {}

export function parseCliArgs<T extends ParseArgsOptionsConfig>(options: T, usage: string) {
  try {
    return parseArgs({ options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new UserError(`${(error as Error).message}\nUsage: ${usage}`);
  }
}

export async function runMain(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    if (error instanceof UserError) {
      process.stderr.write(`Error: ${error.message}\n`);
    } else {
      process.stderr.write(`Error: unexpected failure, this is a bug in the skill.\n${(error as Error).stack}\n`);
    }
    process.exitCode = 1;
  }
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
