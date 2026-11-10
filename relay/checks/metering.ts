import type { Firestore, Transaction } from "firebase-admin/firestore";

export interface OperationCounts {
	reads: number;
	writes: number;
	deletes: number;
}
function readCount(snapshot: unknown): number {
	const docs = (snapshot as { docs?: unknown[] }).docs;
	return docs ? Math.max(1, docs.length) : 1;
}

/** Meter real emulator SDK operations: count retried reads and committed writes, including minimum empty-query reads. */
export function meterFirestore(firestore: Firestore): { firestore: Firestore; counts: OperationCounts } {
	const counts: OperationCounts = { reads: 0, writes: 0, deletes: 0 };
	function reference<T extends object>(target: T): T {
		return new Proxy(target, {
			get(object, property) {
				const member: unknown = Reflect.get(object, property, object);
				if (typeof member !== "function") return member;
				if (["collection", "doc", "where", "limit", "withConverter"].includes(String(property))) {
					return (...args: unknown[]) => reference(Reflect.apply(member, object, args) as object);
				}
				if (property === "get")
					return async (...args: unknown[]) => {
						const snapshot: unknown = await Reflect.apply(member, object, args);
						counts.reads += readCount(snapshot);
						return snapshot;
					};
				if (["set", "update", "create", "delete"].includes(String(property)))
					return async (...args: unknown[]) => {
						const result: unknown = await Reflect.apply(member, object, args);
						if (property === "delete") counts.deletes++;
						else counts.writes++;
						return result;
					};
				return member.bind(object);
			},
		});
	}
	const measured = new Proxy(firestore, {
		get(target, property) {
			if (property === "collection")
				return (...args: unknown[]) => reference(Reflect.apply(target.collection, target, args));
			if (property === "runTransaction")
				return async (callback: (transaction: Transaction) => Promise<unknown>) => {
					let pendingWrites = 0;
					let pendingDeletes = 0;
					const result = await target.runTransaction(async (transaction) => {
						pendingWrites = 0;
						pendingDeletes = 0;
						const wrapped = new Proxy(transaction, {
							get(tx, name) {
								const method: unknown = Reflect.get(tx, name, tx);
								if (typeof method !== "function") return method;
								if (name === "get")
									return async (...args: unknown[]) => {
										const snapshot: unknown = await Reflect.apply(method, tx, args);
										counts.reads += readCount(snapshot);
										return snapshot;
									};
								if (["set", "update", "create", "delete"].includes(String(name)))
									return (...args: unknown[]) => {
										if (name === "delete") pendingDeletes++;
										else pendingWrites++;
										Reflect.apply(method, tx, args);
										return wrapped;
									};
								return method.bind(tx);
							},
						});
						return callback(wrapped);
					});
					counts.writes += pendingWrites;
					counts.deletes += pendingDeletes;
					return result;
				};
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return { firestore: measured, counts };
}
