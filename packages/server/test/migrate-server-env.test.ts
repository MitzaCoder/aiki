import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { loadServerEnv } from "../src/server-env.ts";
import { migrateServerEnv } from "../src/migrate-server-env.ts";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(source: string) { const root = mkdtempSync(join(tmpdir(), "kemiri-migrate-")); roots.push(root); const file = join(root,"server.env"); writeFileSync(file, source, {mode:0o600}); return file; }

test("migration keeps values, comments, multiline strings, empty settings and private mode; backup is exact", () => {
 const source = '# local\r\nAIKI_PORT=8123\r\nexport AIKI_ALLOWED_ORIGINS="https://example.invalid,https://example.test"\nAIKI_EMPTY=\nAIKI_TEXT="first\nAIKI_NOT_A_KEY=value\nlast"\n';
 const file = fixture(source), logs: string[] = [];
 const migrated = migrateServerEnv(file, source, line => logs.push(line));
 expect(parseEnv(migrated)).toEqual({ KEMIRI_PORT:"8123", KEMIRI_ALLOWED_ORIGINS:"https://example.invalid,https://example.test", KEMIRI_EMPTY:"", KEMIRI_TEXT:"first\nAIKI_NOT_A_KEY=value\nlast" });
 expect(migrated).toStartWith('# local\r\n');
 expect(readFileSync(file+'.bak','utf8')).toBe(source);
 expect(statSync(file).mode & 0o777).toBe(0o600);
 const before = statSync(file).mtimeMs;
 expect(migrateServerEnv(file, undefined, line=>logs.push(line))).toBe(migrated);
 expect(statSync(file).mtimeMs).toBe(before); expect(logs).toHaveLength(1);
 expect(logs.join()).not.toContain('8123');
});

test("canonical wins in either order including empty values; legacy assignment removed and logged", () => {
 for (const source of ['AIKI_PORT=8001\nKEMIRI_PORT=\n', 'KEMIRI_PORT=9000\nAIKI_PORT=8001\n']) {
  const file=fixture(source), logs:string[]=[];
  const rewritten=migrateServerEnv(file,source,line=>logs.push(line));
  expect(parseEnv(rewritten)).toEqual({KEMIRI_PORT:parseEnv(source).KEMIRI_PORT!});
  expect(rewritten).not.toContain('AIKI_PORT=');
  expect(logs.join()).toContain('Dropped AIKI_PORT: KEMIRI_PORT wins');
  expect(readFileSync(file+'.bak','utf8')).toBe(source);
 }
});

test("no old keys leaves bytes, timestamps and backup untouched", () => {
 const file=fixture('# retained\nKEMIRI_PORT=8123\n'), before=statSync(file).mtimeMs;
 migrateServerEnv(file); expect(statSync(file).mtimeMs).toBe(before); expect(existsSync(file+'.bak')).toBe(false);
});

test("startup migrates its selected file, ignores process AIKI keys and keeps process precedence", () => {
 const file=fixture('AIKI_PORT=8123\nAIKI_HOST=localhost\n');
 expect(loadServerEnv({KEMIRI_ENV_FILE:file,AIKI_PORT:'9000',KEMIRI_HOST:'127.0.0.1'})).toMatchObject({KEMIRI_PORT:'8123',KEMIRI_HOST:'127.0.0.1'});
 expect(readFileSync(file,'utf8')).toContain('KEMIRI_PORT=8123'); expect(existsSync(file+'.bak')).toBe(true);
});

test("an existing original backup is never replaced", () => {
 const file=fixture('AIKI_PORT=8123\n'); writeFileSync(file+'.bak','original');
 migrateServerEnv(file); expect(readFileSync(file+'.bak','utf8')).toBe('original');
});
