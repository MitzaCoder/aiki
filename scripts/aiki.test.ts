import { expect, test } from "bun:test";
import { serviceDefinition } from "./aiki.ts";
const installation = { root: "/tmp/aiki test", config: "/tmp/config", data: "/tmp/data", launcher: '/tmp/aiki test/quote"%$/aiki', version: "v0.1.0" };
test("user systemd unit quotes paths and never names the hosted deployment", () => {
 const unit = serviceDefinition(installation, "linux", "/usr/bin:/tmp/tools");
 expect(unit).toContain('quote\\"%%$$/aiki" start');
 expect(unit).toContain('Environment="PATH=/usr/bin:/tmp/tools"');
 expect(unit).toContain("WantedBy=default.target");
 expect(unit).not.toContain("aiki-deploy");
});
test("launchd plist uses an argv array and XML escapes", () => {
 const plist = serviceDefinition(installation, "darwin", "/tmp/a&b:/usr/bin");
 expect(plist).toContain("<string>start</string>");
 expect(plist).toContain("quote&quot;%$");
 expect(plist).toContain("/tmp/a&amp;b:/usr/bin");
 expect(plist).toContain("<key>RunAtLoad</key><true/>");
});
test("service definitions refuse control characters", () => {
 expect(() => serviceDefinition({ ...installation, launcher: "/tmp/a\nEnvironment=X" }, "linux", "/usr/bin")).toThrow();
});
