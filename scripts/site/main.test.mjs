import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const MAIN = pathToFileURL(join(import.meta.dirname, 'main.mjs')).href;

describe('isMain', () => {
  let dir;
  // what node prints running a script
  const run = (file) => execFileSync(process.execPath, [file], { encoding: 'utf8' }).trim();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'site-main-'));
    writeFileSync(
      join(dir, 'script.mjs'),
      `import { isMain } from ${JSON.stringify(MAIN)};\nconsole.log(isMain(import.meta));\n`
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is true in the script node runs', () => {
    assert.equal(run(join(dir, 'script.mjs')), 'true');
  });

  it('is true in a script called by a link to it', () => {
    symlinkSync(join(dir, 'script.mjs'), join(dir, 'link.mjs'));
    assert.equal(run(join(dir, 'link.mjs')), 'true');
  });

  it('is true in a script under a linked folder', () => {
    const linked = `${dir}-link`;
    symlinkSync(dir, linked);
    try {
      assert.equal(run(join(linked, 'script.mjs')), 'true');
    } finally {
      rmSync(linked);
    }
  });

  it('is false in a module another script imports', () => {
    writeFileSync(join(dir, 'outer.mjs'), `import './script.mjs';\n`);
    assert.equal(run(join(dir, 'outer.mjs')), 'false');
  });
});
