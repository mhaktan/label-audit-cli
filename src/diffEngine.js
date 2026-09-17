/**
 * Combines used-key reports from multiple repos (e.g. web + mobile) and diffs
 * them against the backend's full key list. The backend already flags which
 * platform(s) each label belongs to (e.g. isWebLabel/isMobileLabel), so a key
 * is only checked against the usage report(s) of the platform(s) it's flagged
 * for - avoiding false "unused" results for platform-specific labels.
 *
 * @param {object} options
 * @param {{ flagFields: Record<string,string>, keys: Array<{key:string} & Record<string,boolean>> }} options.dbKeys
 *   Output of fetchDbKeys - each record's boolean fields are keyed by platform name (e.g. "web", "mobile").
 * @param {{ exactKeys: string[], dynamicPrefixes: string[], sourceName?: string, platform?: string }[]} options.usedReports
 *   One report per scanned repo (output of extractUsedKeys, plus sourceName/platform tags).
 * @returns {{
 *   unused: string[],
 *   dynamicallyUsed: string[],
 *   missing: { key: string, sources: string[] }[],
 *   summary: { dbKeyCount: number, unusedCount: number, missingCount: number }
 * }}
 */
export function diffLabelUsage({ dbKeys, usedReports }) {
  const platforms = Object.keys(dbKeys.flagFields ?? {});

  // Pre-index each platform's exact keys / dynamic prefixes for fast lookup.
  const byPlatform = new Map();
  for (const report of usedReports) {
    const platform = report.platform;
    if (!platform) continue;
    const entry = byPlatform.get(platform) ?? { exactKeys: new Set(), dynamicPrefixes: new Set() };
    report.exactKeys.forEach((k) => entry.exactKeys.add(k));
    report.dynamicPrefixes.forEach((p) => entry.dynamicPrefixes.add(p));
    byPlatform.set(platform, entry);
  }

  const exactUsedAnyPlatform = new Set();
  const exactKeySources = new Map(); // key -> [sourceName, ...], used for "missing" reporting
  for (const report of usedReports) {
    const sourceName = report.sourceName ?? report.platform ?? "unknown";
    for (const key of report.exactKeys) {
      exactUsedAnyPlatform.add(key);
      const sources = exactKeySources.get(key) ?? [];
      sources.push(sourceName);
      exactKeySources.set(key, sources);
    }
  }

  const unused = [];
  const dynamicallyUsed = [];

  for (const record of dbKeys.keys) {
    const requiredPlatforms = platforms.filter((p) => record[p]);
    // Fall back to checking all platforms if the DB gave no platform flags for this key.
    const targetPlatforms = requiredPlatforms.length > 0 ? requiredPlatforms : platforms;
    const relevantEntries =
      targetPlatforms.length > 0
        ? targetPlatforms.map((p) => byPlatform.get(p)).filter(Boolean)
        : [...byPlatform.values()]; // no platform info at all -> check every scanned repo

    const isExactUsed = relevantEntries.some((entry) => entry.exactKeys.has(record.key));
    const isDynamicallyUsed =
      !isExactUsed &&
      relevantEntries.some((entry) =>
        [...entry.dynamicPrefixes].some((prefix) => record.key.startsWith(prefix))
      );

    if (isExactUsed) continue;
    if (isDynamicallyUsed) {
      dynamicallyUsed.push(record.key);
    } else {
      unused.push(record.key);
    }
  }

  const dbKeySet = new Set(dbKeys.keys.map((r) => r.key));
  const missing = [...exactUsedAnyPlatform]
    .filter((key) => !dbKeySet.has(key))
    .map((key) => ({ key, sources: exactKeySources.get(key) ?? [] }));

  return {
    unused: unused.sort(),
    dynamicallyUsed: dynamicallyUsed.sort(),
    missing: missing.sort((a, b) => a.key.localeCompare(b.key)),
    summary: {
      dbKeyCount: dbKeys.keys.length,
      unusedCount: unused.length,
      missingCount: missing.length,
    },
  };
}
