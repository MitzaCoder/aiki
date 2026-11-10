import { defineInt, defineString } from "firebase-functions/params";
import { DEFAULT_DATABASE_ID } from "./database";

// Resolve options as expressions at deployment, never by calling .value() during discovery.
export const relayRegion = defineString("RELAY_REGION", {
	description: "Reviewed Functions region near the selected Firestore database (operator supplied).",
	input: { text: { validationRegex: "^[a-z]+-[a-z]+[0-9]+$", validationErrorMessage: "Choose a Functions region." } },
});
export const runtimeServiceAccount = defineString("RELAY_RUNTIME_SERVICE_ACCOUNT", {
	description: "Dedicated runtime service account email, shared by HTTPS and reconciliation; no key file.",
	input: {
		text: {
			validationRegex: "^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\\.iam\\.gserviceaccount\\.com$",
			validationErrorMessage: "Use a dedicated project service account email.",
		},
	},
});
export const relayDatabase = defineString("RELAY_DATABASE_ID", {
	default: DEFAULT_DATABASE_ID,
	description: "Firestore database ID, identical to the database in the private deploy configuration.",
	input: {
		text: {
			validationRegex: "^(\\(default\\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$",
			validationErrorMessage: "Use (default) or a named Firestore database ID.",
		},
	},
});
export const relayMaxInstances = defineInt("RELAY_MAX_INSTANCES", {
	default: 2,
	description: "HTTPS maximum instances (positive integer); reconciliation stays bounded at one instance.",
	input: { text: { validationRegex: "^[1-9][0-9]*$", validationErrorMessage: "Use a positive instance ceiling." } },
});
