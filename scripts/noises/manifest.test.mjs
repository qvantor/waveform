import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FOLDERS, readManifest, sampleKey, sampleOrder, sortSounds } from './manifest.mjs';

const sound = (folder, name) => ({ id: `${folder}-${name}`, folder, name });

test('sounds go by folder in FOLDERS order, those of a folder in the order of the list', () => {
  const sounds = [
    sound('Textures', 'Wind'),
    sound('Analog', 'White'),
    sound('Textures', 'Rain'),
    sound('Analog', 'Pink'),
    sound('Analog', 'Band 400'),
    sound('Analog', 'Band 1600'),
  ];
  assert.deepEqual(
    sortSounds(sounds).map((s) => s.name),
    ['White', 'Pink', 'Band 400', 'Band 1600', 'Wind', 'Rain']
  );
  assert.deepEqual(sampleOrder({ sounds }), [
    'Analog/White.wav',
    'Analog/Pink.wav',
    'Analog/Band 400.wav',
    'Analog/Band 1600.wav',
    'Textures/Wind.wav',
    'Textures/Rain.wav',
  ]);
});

test('the manifest is in its order, White first, every sound once', () => {
  const manifest = readManifest();
  assert.deepEqual(sortSounds(manifest.sounds), manifest.sounds);
  const order = sampleOrder(manifest);
  assert.equal(order[0], 'Analog/White.wav');
  assert.equal(new Set(order).size, manifest.sounds.length);
  assert.ok(manifest.sounds.every((s) => FOLDERS.includes(s.folder)));
  assert.equal(sampleKey(manifest.sounds[0]), order[0]);
});
