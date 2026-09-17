import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

// @babel/traverse's default export shape differs between ESM/CJS interop.
const traverse = traverseModule.default ?? traverseModule;

const DEFAULT_PARSER_PLUGINS = ["jsx", "typescript", "classProperties", "objectRestSpread"];

/**
 * Scans a set of source files for calls to translation functions (e.g. t("key")),
 * extracting both static keys and dynamic template-literal key patterns.
 *
 * @param {object} options
 * @param {string} options.rootDir - Directory the sourceGlobs are resolved against.
 * @param {string[]} options.sourceGlobs - Glob patterns (relative to rootDir) to scan.
 * @param {string[]} options.translationFnNames - Function/property names treated as translation calls (default: ["t"]).
 * @param {string[]} [options.parserPlugins] - Extra babel parser plugins (jsx/typescript included by default).
 * @returns {{ exactKeys: string[], dynamicPrefixes: string[], nonAnalyzable: {file:string, line:number}[] }}
 */
export function extractUsedKeys({
  rootDir,
  sourceGlobs,
  translationFnNames = ["t"],
  parserPlugins = [],
}) {
  const files = fg.sync(sourceGlobs, { cwd: rootDir, absolute: true });
  const exactKeys = new Set();
  const dynamicPrefixes = new Set();
  const nonAnalyzable = [];

  const plugins = Array.from(new Set([...DEFAULT_PARSER_PLUGINS, ...parserPlugins]));

  for (const file of files) {
    const code = fs.readFileSync(file, "utf8");
    let ast;
    try {
      ast = parse(code, {
        sourceType: "module",
        plugins,
      });
    } catch {
      // Skip files that fail to parse (e.g. non-standard syntax); report for manual review.
      nonAnalyzable.push({ file: path.relative(rootDir, file), line: 0, reason: "parse-error" });
      continue;
    }

    traverse(ast, {
      CallExpression(nodePath) {
        const callee = nodePath.node.callee;
        const calleeName = getCalleeName(callee);
        if (!calleeName || !translationFnNames.includes(calleeName)) return;

        const arg = nodePath.node.arguments[0];
        if (!arg) return;

        if (arg.type === "StringLiteral") {
          exactKeys.add(arg.value);
        } else if (arg.type === "TemplateLiteral") {
          const prefix = arg.quasis[0]?.value?.raw ?? "";
          if (prefix.length > 0) {
            dynamicPrefixes.add(prefix);
          } else {
            nonAnalyzable.push({
              file: path.relative(rootDir, file),
              line: arg.loc?.start.line ?? 0,
              reason: "template-without-static-prefix",
            });
          }
        } else {
          nonAnalyzable.push({
            file: path.relative(rootDir, file),
            line: arg.loc?.start.line ?? 0,
            reason: "non-literal-key",
          });
        }
      },
    });
  }

  return {
    exactKeys: [...exactKeys].sort(),
    dynamicPrefixes: [...dynamicPrefixes].sort(),
    nonAnalyzable,
  };
}

function getCalleeName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
    return callee.property.name;
  }
  return null;
}
