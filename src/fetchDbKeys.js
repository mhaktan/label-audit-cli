/**
 * Fetches label records from the backend label service, preserving the
 * per-platform flags (e.g. isWebLabel/isMobileLabel) the backend already
 * tracks. Generic HTTP GET so it works for both web and mobile configs
 * without hardcoding any project-specific endpoint.
 *
 * @param {object} options
 * @param {string} options.url - Full URL of the label export/list endpoint.
 * @param {Record<string,string>} [options.headers] - e.g. auth token.
 * @param {string} [options.arrayPath] - Dot path to the array of label objects in the response (e.g. "data").
 * @param {string} [options.keyField] - Field name holding the label key (default "key").
 * @param {Record<string,string>} [options.platformFlagFields] - Map of platform name -> field name in the
 *   API response that indicates whether the label belongs to that platform, e.g. { web: "isWebLabel", mobile: "isMobileLabel" }.
 *   When omitted, no platform filtering is possible downstream (every key is treated as platform-agnostic).
 * @returns {Promise<{ flagFields: Record<string,string>, keys: Array<{ key: string } & Record<string, boolean>> }>}
 */
export async function fetchDbKeys({
  url,
  headers = {},
  arrayPath = "",
  keyField = "key",
  platformFlagFields = {},
}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch label keys: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  const list = arrayPath ? getByPath(json, arrayPath) : json;

  if (!Array.isArray(list)) {
    throw new Error(
      `Expected an array of labels at path "${arrayPath || "<root>"}", got ${typeof list}`
    );
  }

  const seen = new Set();
  const keys = [];
  for (const item of list) {
    const key = item[keyField];
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const record = { key };
    for (const [platform, flagField] of Object.entries(platformFlagFields)) {
      record[platform] = Boolean(item[flagField]);
    }
    keys.push(record);
  }

  keys.sort((a, b) => a.key.localeCompare(b.key));
  return { flagFields: platformFlagFields, keys };
}

function getByPath(obj, dotPath) {
  return dotPath.split(".").reduce((acc, segment) => acc?.[segment], obj);
}
