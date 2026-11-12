import type { ImageProcessor } from "@earendil-works/pi-durable/tools";
import { Worker } from "node:worker_threads";
import { packagedResources } from "./packaged-resources.ts";

/** A bounded, disposable thread per image: no large decode or WASM heap remains on the coordinator thread. */
export function createPackagedPhotonImages(): ImageProcessor {
	let preparing: Promise<unknown> = Promise.resolve();
	return {
		prepare(bytes, mimeType, limits) {
			// Bound decoder concurrency and release the previous WASM heap before the next image.
			const result = preparing.then(() => prepareInThread(bytes, mimeType, limits));
			preparing = result.catch(() => undefined);
			return result;
		},
	};
}

async function prepareInThread(...[bytes, mimeType, limits]: Parameters<ImageProcessor["prepare"]>): ReturnType<ImageProcessor["prepare"]> {
	if (!packagedResources.photonWorker || !packagedResources.photonWasm) throw new Error("Missing packaged Photon resources");
	const worker = new Worker(packagedResources.photonWorker, {
		workerData: { bytes, mimeType, limits, wasm: packagedResources.photonWasm },
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await new Promise<Awaited<ReturnType<ImageProcessor["prepare"]>>>((resolve, reject) => {
			timer = setTimeout(() => reject(new Error("Image preparation timed out")), 30_000);
			worker.once("message", (reply) => {
				if (reply.error) reject(new Error(reply.error));
				else resolve(reply.result);
			});
			worker.once("error", reject);
			worker.once("exit", (code) => reject(new Error(`Image worker exited before replying (${code})`)));
		});
	} finally {
		clearTimeout(timer);
		await worker.terminate();
	}
}
