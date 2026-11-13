import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyStoragePrefix } from '../vite-legacy-storage.ts';
import { findPublishedBackendsSource } from '../vite-plugin-published-backends.ts';

test('build settings prefer process values, then Kemiri spelling within each source', () => {
 const root = mkdtempSync(join(tmpdir(), 'kemiri-web-env-'));
 try {
  const file = join(root, 'web.env');
  writeFileSync(file, 'AIKI_LEGACY_STORAGE_PREFIX=old-file\nKEMIRI_LEGACY_STORAGE_PREFIX=new-file\n');
  expect(legacyStoragePrefix({ KEMIRI_WEB_ENV_FILE: file })).toBe('new-file');
  expect(legacyStoragePrefix({ AIKI_WEB_ENV_FILE: file, AIKI_LEGACY_STORAGE_PREFIX: 'old-process' })).toBe('old-process');
  expect(legacyStoragePrefix({ KEMIRI_WEB_ENV_FILE: file, AIKI_WEB_ENV_FILE: '/missing', KEMIRI_LEGACY_STORAGE_PREFIX: '', AIKI_LEGACY_STORAGE_PREFIX: 'old-process' })).toBe('');
  expect(() => legacyStoragePrefix({ KEMIRI_LEGACY_STORAGE_PREFIX: '../invalid' })).toThrow();
  writeFileSync(file, 'AIKI_LEGACY_STORAGE_PREFIX=old-file\n');
  expect(legacyStoragePrefix({ AIKI_WEB_ENV_FILE: file })).toBe('old-file');
  const published = join(root, 'backends.json'); writeFileSync(published, '[]');
  expect(findPublishedBackendsSource({ KEMIRI_PUBLISHED_BACKENDS_FILE: published, AIKI_PUBLISHED_BACKENDS_FILE: '/missing' }, root)).toBe(published);
  expect(findPublishedBackendsSource({ AIKI_PUBLISHED_BACKENDS_FILE: published }, root)).toBe(published);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
