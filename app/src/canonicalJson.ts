// canonicalJson — JSON with object keys sorted at every level (pure; no DOM,
// no Node). Two copies of the same content compare equal however their keys
// were ordered on the way. Shared by the homework sync's content hash
// (devData/homeworkSync.ts, which the server imports too) and the sandbox
// workbook's saved-content key (workbookFile.ts).

/** JSON with object keys sorted at every level, so two copies of the same
 *  content compare equal however their keys were ordered on the way. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
