type Part = { text: string } | { value: unknown };

export interface Query {
  // whitespace collapsed, values replaced with $1, $2...
  text: string;
  values: unknown[];
  transaction: boolean;
}

type Result = unknown[] | Error | ((query: Query) => unknown[] | Error);

// what `sql.json(value)` puts into the query values
export interface JsonValue {
  json: unknown;
}

// a query or a fragment: awaiting it runs the query
class Fragment implements PromiseLike<unknown[]> {
  constructor(readonly parts: Part[], private readonly run: (fragment: Fragment) => Promise<unknown[]>) {}

  then<A = unknown[], B = never>(
    onFulfilled?: ((rows: unknown[]) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ) {
    return this.run(this).then(onFulfilled, onRejected);
  }
}

const render = (parts: Part[]) => {
  const values: unknown[] = [];
  const text = parts
    .map((part) => {
      if ('text' in part) return part.text;
      values.push(part.value);
      return `$${values.length}`;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, values };
};

// fake of the `postgres` tag: records queries and answers them with rows registered by `respond`
export const createFakeSql = () => {
  const queries: Query[] = [];
  let handlers: { matcher: RegExp; result: Result }[] = [];

  const run = async (fragment: Fragment, transaction: boolean) => {
    const query = { ...render(fragment.parts), transaction };
    queries.push(query);
    const handler = handlers.find(({ matcher }) => matcher.test(query.text));
    const result = typeof handler?.result === 'function' ? handler.result(query) : handler?.result ?? [];
    if (result instanceof Error) throw result;
    return result;
  };

  // queries of the tag passed to `begin` callbacks are marked as transactional, those of the outer tag are not
  const createTag = (transaction: boolean) => {
    const runQuery = (fragment: Fragment) => run(fragment, transaction);
    return (stringsOrIdentifier: TemplateStringsArray | string, ...values: unknown[]) => {
      // sql('table') is an escaped identifier
      if (typeof stringsOrIdentifier === 'string')
        return new Fragment([{ text: `"${stringsOrIdentifier}"` }], runQuery);
      const parts: Part[] = [];
      stringsOrIdentifier.forEach((text, i) => {
        parts.push({ text });
        if (i >= values.length) return;
        const value = values[i];
        if (value instanceof Fragment) parts.push(...value.parts);
        else parts.push({ value });
      });
      return new Fragment(parts, runQuery);
    };
  };

  const json = (json: unknown): JsonValue => ({ json });
  const tx = Object.assign(createTag(true), { json });
  const sql = Object.assign(createTag(false), {
    json,
    begin: <T>(callback: (sql: typeof tx) => Promise<T>) => callback(tx),
  });

  return {
    sql,
    queries,
    // the last registered matcher wins (tests override beforeEach defaults), unmatched queries return no rows
    respond: (matcher: RegExp, result: Result) => {
      handlers.unshift({ matcher, result });
    },
    find: (matcher: RegExp) => queries.filter(({ text }) => matcher.test(text)),
    reset: () => {
      queries.length = 0;
      handlers = [];
    },
  };
};

export const pgError = (code: string, constraintName: string) =>
  Object.assign(new Error(`${code} ${constraintName}`), { code, constraint_name: constraintName });
