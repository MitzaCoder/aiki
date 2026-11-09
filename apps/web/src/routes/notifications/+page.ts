import { redirect } from '@sveltejs/kit';

// The old address of the notifications page: it is a section of General settings now.
export function load(): never {
	redirect(307, '/settings/notifications');
}
