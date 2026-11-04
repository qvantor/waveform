import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { filesOf, merge } from './merge.mjs';

const write = (root, file, text = file) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};

describe('merge', () => {
  let dir;
  let site;
  let synth;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'site-merge-'));
    site = join(dir, 'site');
    synth = join(dir, 'chisper');
    write(synth, 'index.html', 'synth');
    write(synth, 'assets/worklets/limiter.js');
    write(site, 'wavetable-synth/index.html', 'page');
    write(site, 'es/sintetizador-wavetable/index.html');
    write(site, '_astro/fonts/a.woff2');
    write(site, 'sitemap-index.xml');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies every file of the site into the folder of the synth', () => {
    assert.equal(merge(site, synth), 4);
    assert.deepEqual(filesOf(synth).sort(), [
      '_astro/fonts/a.woff2',
      'assets/worklets/limiter.js',
      'es/sintetizador-wavetable/index.html',
      'index.html',
      'sitemap-index.xml',
      'wavetable-synth/index.html',
    ]);
    assert.equal(readFileSync(join(synth, 'index.html'), 'utf8'), 'synth');
    assert.equal(readFileSync(join(synth, 'wavetable-synth/index.html'), 'utf8'), 'page');
  });

  it('merges again over a merge of the same build', () => {
    merge(site, synth);
    assert.equal(merge(site, synth), 4);
    assert.equal(readFileSync(join(synth, 'wavetable-synth/index.html'), 'utf8'), 'page');
  });

  it('fails on a file the synth has with other contents, copying nothing', () => {
    write(site, 'index.html', 'not the synth');
    write(site, 'assets/worklets/limiter.js', 'another limiter');
    assert.throws(
      () => merge(site, synth),
      /the synth has too: (?=.*index\.html)(?=.*assets\/worklets\/limiter\.js)/
    );
    assert.equal(readFileSync(join(synth, 'index.html'), 'utf8'), 'synth');
    assert.deepEqual(filesOf(synth).sort(), ['assets/worklets/limiter.js', 'index.html']);
  });

  it('fails without a build of the synth', () => {
    rmSync(join(synth, 'index.html'));
    assert.throws(() => merge(site, synth), /no build of the synth/);
  });
});
