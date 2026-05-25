import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type FurnitureAsset,
  loadDefaultLayout,
  type LoadedAssets,
  loadFurnitureAssets,
  mergeLoadedAssets,
} from '../src/assetLoader.js';
import { LAYOUT_REVISION_KEY } from '../src/constants.js';

function createAsset(id: string, label = id): FurnitureAsset {
  return {
    id,
    name: label,
    label,
    category: 'chairs',
    file: `${id}.png`,
    width: 1,
    height: 1,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
    canPlaceOnWalls: false,
    canPlaceOnSurfaces: false,
    backgroundTiles: 0,
    groupId: id,
  };
}

describe('assetLoader', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-asset-loader-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('merges loaded assets with later catalog and sprite entries winning duplicate ids', () => {
    const first: LoadedAssets = {
      catalog: [createAsset('chair'), createAsset('shared', 'old shared')],
      sprites: new Map([
        ['chair', [['chair']]],
        ['shared', [['old']]],
      ]),
    };
    const second: LoadedAssets = {
      catalog: [createAsset('shared', 'new shared'), createAsset('table')],
      sprites: new Map([
        ['shared', [['new']]],
        ['table', [['table']]],
      ]),
    };

    const merged = mergeLoadedAssets(first, second);

    expect(merged.catalog.map((asset) => asset.id)).toEqual(['chair', 'shared', 'table']);
    expect(merged.catalog.find((asset) => asset.id === 'shared')?.label).toBe('new shared');
    expect(merged.sprites.get('shared')).toEqual([['new']]);
  });

  it('loads the highest revision default layout and fills in a missing revision key', () => {
    const assetsDir = path.join(tempRoot, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'default-layout.json'), JSON.stringify({ cols: 1 }));
    fs.writeFileSync(path.join(assetsDir, 'default-layout-2.json'), JSON.stringify({ cols: 2 }));
    fs.writeFileSync(
      path.join(assetsDir, 'default-layout-10.json'),
      JSON.stringify({ cols: 10, rows: 8 }),
    );

    const layout = loadDefaultLayout(tempRoot);

    expect(layout).toMatchObject({ cols: 10, rows: 8 });
    expect(layout?.[LAYOUT_REVISION_KEY]).toBe(10);
  });

  it('returns null when the furniture directory is missing', async () => {
    await expect(loadFurnitureAssets(tempRoot)).resolves.toBeNull();
  });
});
