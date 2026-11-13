import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyStoragePrefix } from '../vite-legacy-storage.ts';
import { findPublishedBackendsSource } from '../vite-plugin-published-backends.ts';

test('build settings ignore AIKI aliases; process values override file values', () => {
 const root = mkdtempSync(join(tmpdir(), 'kemiri-web-env-'));
 try {
  const file = join(root, 'web.env');
  writeFileSync(file, 'AIKI_LEGACY_STORAGE_PREFIX=ignored\nKEMIRI_LEGACY_STORAGE_PREFIX=saved\n');
  expect(legacyStoragePrefix({ KEMIRI_WEB_ENV_FILE: file, AIKI_LEGACY_STORAGE_PREFIX:'ignored' })).toBe('saved');
  expect(legacyStoragePrefix({ KEMIRI_WEB_ENV_FILE: file, KEMIRI_LEGACY_STORAGE_PREFIX: '' })).toBe('');
  expect(legacyStoragePrefix({ AIKI_WEB_ENV_FILE:file },root)).toBe('');
  expect(() => legacyStoragePrefix({ KEMIRI_LEGACY_STORAGE_PREFIX: '../invalid' })).toThrow();
  writeFileSync(file, 'AIKI_LEGACY_STORAGE_PREFIX=ignored\n');
  expect(legacyStoragePrefix({ KEMIRI_WEB_ENV_FILE: file })).toBe('');
  const published = join(root, 'backends.json'); writeFileSync(published, '[]');
  expect(findPublishedBackendsSource({ KEMIRI_PUBLISHED_BACKENDS_FILE: published, AIKI_PUBLISHED_BACKENDS_FILE: '/missing' }, root)).toBe(published);
  expect(findPublishedBackendsSource({ AIKI_PUBLISHED_BACKENDS_FILE: published }, root)).toBeUndefined();
 } finally { rmSync(root, { recursive: true, force: true }); }
});
