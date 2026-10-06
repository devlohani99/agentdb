type GraphReplyShape = {
  headers?: string[];
  data?: unknown[];
};

export function mapRows<T extends Record<string, unknown>>(
  reply: GraphReplyShape,
): T[] {
  if (!reply.headers?.length || !reply.data?.length) {
    return [];
  }
  const width = reply.headers.length;
  const flat = reply.data as unknown[];
  const rows: T[] = [];
  for (let i = 0; i < flat.length; i += width) {
    const record: Record<string, unknown> = {};
    for (let c = 0; c < width; c++) {
      const key = reply.headers[c];
      if (key) {
        record[key] = flat[i + c];
      }
    }
    rows.push(record as T);
  }
  return rows;
}

export function firstRow<T extends Record<string, unknown>>(
  reply: GraphReplyShape,
): T | undefined {
  return mapRows<T>(reply)[0];
}
