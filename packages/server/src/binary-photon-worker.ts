import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { createPhotonImages } from "@earendil-works/pi-durable/images";

if (!parentPort) throw new Error("Image worker needs a parent thread");
try {
	const images = createPhotonImages(readFileSync(workerData.wasm));
	const result = await images.prepare(workerData.bytes, workerData.mimeType, workerData.limits);
	parentPort.postMessage({ result });
} catch (error) {
	parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
