/// <reference lib="webworker" />
import { installPushEvents } from "./push-events.ts";
// Push only: no fetch, resource caches, activate handler or clients.claim.
installPushEvents(self as unknown as ServiceWorkerGlobalScope);
