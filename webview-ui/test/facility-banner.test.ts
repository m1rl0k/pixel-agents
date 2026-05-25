import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('App does not mount the top swarm banner in facility mode', () => {
  const appSource = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

  assert.doesNotMatch(
    appSource,
    /import \{ FacilityBanner \} from '\.\/components\/FacilityBanner\.js';/,
  );
  assert.doesNotMatch(appSource, /<FacilityBanner progress=\{facilityProgress\} \/>/);
});
