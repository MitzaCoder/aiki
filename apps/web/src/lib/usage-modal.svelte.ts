/** Whether the subscription usage modal is open; the sidebar and the `/usage` deep link open it, the layout shows it. */
class UsageModal {
	open = $state(false);
}

export const usageModal = new UsageModal();
