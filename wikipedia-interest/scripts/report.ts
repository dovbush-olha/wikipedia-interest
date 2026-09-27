// Step 3: analysis.json → report.pdf on one page.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readAnalysis } from "./lib/analysis.ts";
import { parseCliArgs, printJson, runMain, UserError } from "./lib/cli.ts";
import { today } from "./lib/env.ts";
import { renderReport } from "./lib/pdf.ts";

const USAGE = "node report.ts --run-dir <path, the --out-dir of analyze.ts>";

await runMain(async () => {
  const args = parseCliArgs({ "run-dir": { type: "string" } }, USAGE);
  if (!args["run-dir"]) throw new UserError(`--run-dir is required.\nUsage: ${USAGE}`);
  const runDir = resolve(args["run-dir"]);

  const pdf = await renderReport(readAnalysis(runDir), today());
  const reportFile = join(runDir, "report.pdf");
  writeFileSync(reportFile, pdf);
  printJson({ status: "ok", files: { report: reportFile } });
});
