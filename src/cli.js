import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { extractUsedKeys } from "./extractUsedKeys.js";
import { fetchDbKeys } from "./fetchDbKeys.js";
import { diffLabelUsage } from "./diffEngine.js";

export function runCli(argv) {
  const program = new Command();
  program.name("label-audit").description("Detect unused/missing backend label keys across repos");

  program
    .command("scan")
    .description("Scan a repo's source for translation key usage and write a used-keys report")
    .requiredOption("--config <path>", "path to label-audit.config.json")
    .option("--out <path>", "output file", "used-keys.json")
    .action((opts) => {
      const config = readJson(opts.config);
      const rootDir = path.resolve(path.dirname(opts.config), config.rootDir ?? ".");
      const result = extractUsedKeys({
        rootDir,
        sourceGlobs: config.sourceGlobs,
        translationFnNames: config.translationFnNames ?? ["t"],
        parserPlugins: config.parserPlugins ?? [],
      });
      const report = { sourceName: config.sourceName ?? rootDir, platform: config.platform, ...result };
      writeJson(opts.out, report);
      console.log(
        `[scan] ${report.sourceName}: ${result.exactKeys.length} exact keys, ` +
          `${result.dynamicPrefixes.length} dynamic prefixes, ` +
          `${result.nonAnalyzable.length} non-analyzable calls -> ${opts.out}`
      );
    });

  program
    .command("fetch-db")
    .description("Fetch the full label key list from the backend and write it as JSON")
    .requiredOption("--config <path>", "path to label-audit.config.json")
    .option("--out <path>", "output file", "db-keys.json")
    .action(async (opts) => {
      const config = readJson(opts.config);
      if (!config.dbSource) {
        throw new Error(
          'Config is missing "dbSource" (url/headers/arrayPath/keyField/platformFlagFields)'
        );
      }
      const dbKeys = await fetchDbKeys(config.dbSource);
      writeJson(opts.out, dbKeys);
      console.log(`[fetch-db] ${dbKeys.keys.length} keys -> ${opts.out}`);
    });

  program
    .command("diff")
    .description("Diff one or more used-keys reports against a db-keys export")
    .requiredOption("--db <path>", "path to db-keys.json ({ flagFields, keys } from fetch-db)")
    .requiredOption(
      "--used <paths...>",
      "one or more used-keys.json files, each tagged with a platform in its config (e.g. web + mobile)"
    )
    .option("--out <path>", "output file", "label-audit-report.json")
    .action((opts) => {
      const dbKeys = readJson(opts.db);
      const usedReports = opts.used.map((p) => readJson(p));
      const report = diffLabelUsage({ dbKeys, usedReports });
      writeJson(opts.out, report);
      console.log(
        `[diff] db keys: ${report.summary.dbKeyCount}, ` +
          `unused candidates: ${report.summary.unusedCount}, ` +
          `missing (used but not in db): ${report.summary.missingCount} -> ${opts.out}`
      );
      console.log("NOTE: 'unused' is a candidate list for manual review, not a delete list.");
    });

  program.parseAsync(argv);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}
