import { loadTimelineOrder, saveTimelineOrder } from './task-timeline.js';
const storage = typeof localStorage === 'undefined' ? undefined : localStorage;
/** One reading direction for every task in this browser. */
class TimelineOrderPreference {
	order = $state(loadTimelineOrder(storage));
	toggle(): void {
		this.order = this.order === 'newest' ? 'oldest' : 'newest';
		saveTimelineOrder(storage, this.order);
	}
}
export const timelineOrder = new TimelineOrderPreference();
