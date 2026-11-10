import { expect, test } from "bun:test";
import { createRelay } from "../src/core";
import { deleteAccount } from "../src/accounts";
import { meterFirestore } from "./metering";
import {
	fixture,
	db,
	auth,
	checkDependencies,
	random,
	enroll,
	route,
	payload,
	emailUser,
	capturedChallenge,
} from "./support";

test("meter actual SDK reads and committed writes/deletes for send, full enrollment and whole-account erasure", async () => {
	const user = await emailUser();
	const phone = await enroll(random(), undefined, user.idToken);
	const credentials = await route(phone.installationId, user.idToken);
	const sendMeter = meterFirestore(db);
	const handler = createRelay(checkDependencies({ firestore: sendMeter.firestore }));
	const sent = await handler({
		method: "POST",
		path: "/v1/send",
		authorization: "Bearer " + credentials.send,
		body: JSON.stringify(payload(credentials.routeId)),
		clientIp: "127.0.0.1",
		contentType: "application/octet-stream",
	});
	expect(sent.body?.state).toBe("accepted");
	const newUser = await emailUser();
	const enrollmentMeter = meterFirestore(db);
	const enrollment = createRelay(checkDependencies({ firestore: enrollmentMeter.firestore }));
	const installationId = random();
	const operationId = random();
	const post = (path: string, body: unknown) =>
		enrollment({
			method: "POST",
			path: "/v1/" + path,
			authorization: "Bearer " + newUser.idToken,
			body: JSON.stringify(body),
			contentType: "application/octet-stream",
			clientIp: "127.0.0.1",
		});
	expect(
		(await post("installations/begin", { installationId, operationId, token: "synthetic-meter-token" })).status,
	).toBe(200);
	const challenge = capturedChallenge(fixture.captures.at(-1)!);
	expect(
		(
			await post("installations/confirm", {
				installationId,
				operationId,
				challengeId: challenge.challengeId,
				nonce: challenge.nonce,
			})
		).status,
	).toBe(200);
	const deletionMeter = meterFirestore(db);
	const deleted = await deleteAccount(
		checkDependencies({ firestore: deletionMeter.firestore }),
		await auth.verifyIdToken(user.idToken, true),
		{ operationId: random() },
	);
	expect(deleted.body.state).toBe("deleted");
	const report = { send: sendMeter.counts, enrollment: enrollmentMeter.counts, deletion: deletionMeter.counts };
	console.info("operation_counts", JSON.stringify(report));
	expect(report).toEqual({
		send: { reads: 20, writes: 10, deletes: 0 },
		enrollment: { reads: 31, writes: 21, deletes: 1 },
		deletion: { reads: 33, writes: 13, deletes: 9 },
	});
	for (const count of Object.values(report)) expect(count.reads).toBeGreaterThan(0);
}, 30_000);
