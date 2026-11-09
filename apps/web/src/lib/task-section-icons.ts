import ActivityIcon from '@lucide/svelte/icons/activity';
import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
import MessageSquareIcon from '@lucide/svelte/icons/message-square';
import ImagesIcon from '@lucide/svelte/icons/images';
import UsersIcon from '@lucide/svelte/icons/users';
import GitBranchIcon from '@lucide/svelte/icons/git-branch';
import ScaleIcon from '@lucide/svelte/icons/scale';
import HistoryIcon from '@lucide/svelte/icons/history';
import ListTreeIcon from '@lucide/svelte/icons/list-tree';
import FileTextIcon from '@lucide/svelte/icons/file-text';

export const taskSectionIcons = {
	report: ActivityIcon,
	questions: CircleHelpIcon,
	feedback: MessageSquareIcon,
	files: ImagesIcon,
	workers: UsersIcon,
	related: GitBranchIcon,
	decisions: ScaleIcon,
	timeline: ListTreeIcon,
	history: HistoryIcon,
	brief: FileTextIcon
};
