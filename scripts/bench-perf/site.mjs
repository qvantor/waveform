// what the browsers load: the perf build of the app (the test hook in it), the onset probe, the tables of the
// cases, served on localhost (a secure context) with the functions of the wavetables mocked and no presets API
// (the app starts at Init)
import fs from 'fs';
import http from 'http';
import path from 'path';
import { downloadTables as download, fileName } from '../bench-common.mjs';
import { exec, out, require, root, siteDir, sourceStamp, tablesDir } from './util.mjs';

const probeFile = path.join(out, 'perf/probe.js');
const stampFile = path.join(out, 'site-stamp.txt');

// the tables of the cases, once; those bench-osc has downloaded are copied
export const downloadTables = (keys) =>
  download(keys, tablesDir, { cacheDirs: [path.join(root, 'tmp/bench-osc/tables')] });

// the perf build (`npm run build:perf`), again only when the app, the libs or the dependencies changed
export const buildSite = async ({ force = false } = {}) => {
  const stamp = await sourceStamp();
  const built = fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp;
  if (force || !built || !fs.existsSync(path.join(siteDir, 'index.html'))) {
    console.log('building the perf build of the app (npm run build:perf)…');
    await exec('npm', ['run', 'build:perf'], { cwd: root });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(stampFile, stamp);
  }
  const esbuild = require('esbuild');
  await esbuild.build({
    entryPoints: [path.join(root, 'apps/waveform/src/app/perf/probe.worklet.ts')],
    bundle: true,
    format: 'esm',
    logLevel: 'warning',
    // code of the perf build (apps/waveform/src/globals.d.ts)
    define: { __PERF__: 'true' },
    outfile: probeFile,
  });
  return siteDir;
};

const TYPES = {
  '.js': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

// the tree of the wavetables list (get-wavetables-list) of the served tables
const tableTree = (keys) => {
  const roots = [];
  for (const key of keys) {
    const folders = key.split('/').slice(0, -1);
    let level = roots;
    for (const name of folders) {
      let folder = level.find((item) => item.name === name);
      if (!folder) level.push((folder = { name, children: [] }));
      level = folder.children;
    }
    const file = path.join(tablesDir, fileName(key));
    level.push({ Key: key, Size: fs.existsSync(file) ? fs.statSync(file).size : 0 });
  }
  return roots;
};

// cross-origin isolated: performance.now() steps by 1 ms in WebKit otherwise (20 µs isolated), too coarse for the
// latency of a note; the app works isolated (no cross-origin resource but the fonts, which the runner blocks)
const HEADERS = {
  'cache-control': 'no-store',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};

// the server of a run, on a free port of localhost: a perf build (`site`: the one of the working tree, or of the
// reference of an A/B run), the probe and the tables
export const serve = ({ keys, site = siteDir }) =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const send = (status, body = '', type = 'text/plain') => {
        res.writeHead(status, { ...HEADERS, 'content-type': type });
        res.end(body);
      };
      if (url.pathname.startsWith('/api/')) return send(404);
      if (url.pathname === '/.netlify/functions/get-wavetables-list')
        return send(200, JSON.stringify(tableTree(keys)), TYPES['.json']);
      if (url.pathname === '/.netlify/functions/get-wavetable') {
        const id = url.searchParams.get('id') ?? '';
        return id ? send(200, `/tables/${encodeURIComponent(fileName(id))}`) : send(400);
      }
      // a malformed path is a bad request, not an exception of the server
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return send(400);
      }
      const file =
        pathname === '/perf/probe.js'
          ? probeFile
          : pathname.startsWith('/tables/')
          ? path.join(tablesDir, pathname.slice('/tables/'.length))
          : path.join(site, pathname);
      // within one of the served folders, not a sibling of one (waveform-perf-old)
      const inside = [site, tablesDir, path.dirname(probeFile)].some(
        (dir) => file === dir || file.startsWith(dir + path.sep)
      );
      if (!inside) return send(404);
      // the app's routes are its index (a file that isn't there and has no extension)
      const target =
        fs.existsSync(file) && fs.statSync(file).isFile()
          ? file
          : path.extname(file)
          ? null
          : path.join(site, 'index.html');
      if (!target) return send(404);
      res.writeHead(200, {
        ...HEADERS,
        'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream',
      });
      fs.createReadStream(target).pipe(res);
    });
    server.listen(0, 'localhost', () => {
      const { port: listening } = server.address();
      resolve({ server, port: listening });
    });
  });
