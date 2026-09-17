/**
 * Fetches label records from the backend label service, preserving the
 * per-platform flags (e.g. forUI/forMobile) the backend already tracks.
 * Generic HTTP GET so it works for both web and mobile configs without
 * hardcoding any project-specific endpoint.
 *
 * Some label list endpoints are paginated and don't support filtering by
 * platform server-side - the full set has to be paged through and filtered
 * client-side using each record's platform flag fields. Set `pagination` to
 * enable that.
 *
 * @param {object} options
 * @param {string} options.url - Full URL of the label export/list endpoint.
 * @param {Record<string,string>} [options.headers] - e.g. auth token.
 * @param {string} [options.arrayPath] - Dot path to the array of label objects in the response (e.g. "data").
 * @param {string} [options.keyField] - Field name holding the label key (default "key").
 * @param {Record<string,string>} [options.platformFlagFields] - Map of platform name -> field name in the
 *   API response that indicates whether the label belongs to that platform, e.g. { web: "forUI", mobile: "forMobile" }.
 *   When omitted, no platform filtering is possible downstream (every key is treated as platform-agnostic).
 * @param {object} [options.pagination] - Enables paging through a paginated list endpoint.
 * @param {string} [options.pagination.pageParam] - Query param name for the page number (default "Page").
 * @param {string} [options.pagination.pageSizeParam] - Query param name for the page size (default "PageSize").
 * @param {number} [options.pagination.pageSize] - Page size to request (default 500).
 * @param {string} [options.pagination.totalCountPath] - Dot path to the total record count in the response (default "totalCount").
 * @returns {Promise<{ flagFields: Record<string,string>, keys: Array<{ key: string } & Record<string, boolean>> }>}
 */
export async function fetchDbKeys({
  url,
  headers = {},
  arrayPath = "",
  keyField = "key",
  platformFlagFields = {},
  pagination = null,
}) {
  const list = pagination
    ? await fetchAllPages({ url, headers, arrayPath, pagination })
    : await fetchSinglePage({ url, headers, arrayPath });

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

async function fetchSinglePage({ url, headers, arrayPath }) {
  const json = await fetchJson(url, headers);
  const list = arrayPath ? getByPath(json, arrayPath) : json;
  assertArray(list, arrayPath);
  return list;
}

async function fetchAllPages({ url, headers, arrayPath, pagination }) {
  const {
    pageParam = "Page",
    pageSizeParam = "PageSize",
    pageSize = 500,
    totalCountPath = "totalCount",
  } = pagination;

  const all = [];
  let page = 1;
  let totalCount = Infinity;

  while (all.length < totalCount) {
    const pageUrl = new URL(url);
    pageUrl.searchParams.set(pageParam, String(page));
    pageUrl.searchParams.set(pageSizeParam, String(pageSize));

    const json = await fetchJson(pageUrl.toString(), headers);
    const list = arrayPath ? getByPath(json, arrayPath) : json;
    assertArray(list, arrayPath);

    all.push(...list);
    totalCount = getByPath(json, totalCountPath) ?? all.length;

    if (list.length === 0) break; // safety net against infinite loop on unexpected responses
    page += 1;
  }

  return all;
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch label keys: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function assertArray(list, arrayPath) {
  if (!Array.isArray(list)) {
    throw new Error(
      `Expected an array of labels at path "${arrayPath || "<root>"}", got ${typeof list}`
    );
  }
}

function getByPath(obj, dotPath) {
  return dotPath.split(".").reduce((acc, segment) => acc?.[segment], obj);
}
