import { registerEmulatorChecks } from "./support";
registerEmulatorChecks();
await import("./admission.cases");
await import("./router.cases");
await import("./startup.cases");
await import("./enrollment.cases");
await import("./installations.cases");
await import("./routes.cases");
await import("./send.cases");
await import("./delete.cases");
await import("./http.cases");

await import("./budgets.cases");
await import("./lifecycle.cases");
await import("./metering.cases");

await import("./shared-vectors.cases");
