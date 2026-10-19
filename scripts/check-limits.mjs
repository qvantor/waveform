// Checks presets API limits against a running deployment.
// Run against a dev/staging database only: it creates presets and stays.
//
//   BASE_URL=http://localhost:8888 node scripts/check-limits.mjs [--reports]
//
// The server must use Turnstile test keys (see .env.example), they accept the dummy token below.
// --reports also checks the "20 reports per hour per IP" limit by reporting 21 existing presets
// (one report each, presets get hidden only if they already have REPORT_HIDE_THRESHOLD - 1 reports).

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8888';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const checkReports = process.argv.includes('--reports');

let failed = 0;
const check = (name, ok, details) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(details)}`}`);
  if (!ok) failed++;
};

const api = async (path, init) => {
  const response = await fetch(BASE_URL + path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const run = Date.now();
const save = (i) =>
  api('/api/presets', {
    method: 'POST',
    body: JSON.stringify({
      name: `limits check ${i}`,
      // unique sound per run (values survive rounding to 4 significant digits), otherwise saves are deduplicated
      data: {
        osc1: { w: i },
        filter: { cut: 100 + (run % 900) },
        env: { e1: { attack: (run % 997) / 1000 } },
      },
      turnstileToken: TOKEN,
    }),
  });

// saving: 5 per hour per IP
const saves = [];
for (let i = 0; i < 6; i++) saves.push(await save(i));
const created = saves.filter((r) => r.status === 201);
check(
  'save rate limit: 6th save in an hour is 429',
  saves.at(-1).status === 429,
  saves.map((r) => r.status)
);
if (created.length < 5)
  console.log(
    `     note: only ${created.length} saves succeeded, this IP already saved presets during the last hour`
  );

check(
  'body larger than 20 KB is rejected',
  (await api('/api/presets', { method: 'POST', body: 'x'.repeat(21 * 1024) })).status === 413
);

// usage
const presetId = created[0]?.body.id ?? (await api('/api/presets?sort=new')).body.items[0]?.id;
if (!presetId) {
  console.log('no presets to check /usage, skipping');
} else {
  const usage = (body) => api('/api/usage', { method: 'POST', body: JSON.stringify(body) });
  const turnstileToken = TOKEN;
  check(
    'usage listen is accepted',
    (await usage({ presetId, event: 'listen', turnstileToken })).status === 204
  );
  check('usage stay is accepted', (await usage({ presetId, event: 'stay', turnstileToken })).status === 204);
  check('usage without an event is 400', (await usage({ presetId, turnstileToken })).status === 400);
  check('usage without a captcha token is 400', (await usage({ presetId, event: 'stay' })).status === 400);
  check(
    'usage batch of seconds of older clients is 400',
    (await usage({ clientId: 'check-1', items: [{ presetId, seconds: 60 }] })).status === 400
  );
  console.log(`     verify in the database, expected no row if this IP saved the preset, otherwise one heard and stayed today:
       SELECT heard, stayed FROM listens WHERE preset_id = '${presetId}';`);
}

if (checkReports) {
  const { items } = (await api('/api/presets?sort=new')).body;
  const more = (await api(`/api/presets?sort=name`)).body.items;
  const ids = [...new Set([...items, ...more].map(({ id }) => id))].slice(0, 21);
  if (ids.length < 21) console.log(`     need 21 presets to check reports limit, found ${ids.length}`);
  const statuses = [];
  for (const id of ids) statuses.push((await api(`/api/presets/${id}/report`, { method: 'POST' })).status);
  check('report rate limit: 21st report in an hour is 429', statuses.at(-1) === 429, statuses);
}

process.exit(failed ? 1 : 0);
