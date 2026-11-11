/** Synthetic task-sheet stress case; no host accounts or real project data. */
export const TASK_SHEET_TITLE = "Prepare the example release across the sample client, service and documentation, including migration checks and a safe staged rollout";
export const TASK_SHEET_REFS = Array.from({ length: 12 }, (_, index) => {
	const number = index + 101;
	const pull = index < 8;
	return {
		ref: `https://github.com/example/demo/${pull ? 'pull' : 'issues'}/${number}`,
		node: index === 11 ? null : {
			__typename: pull ? 'PullRequest' : 'Issue',
			title: ['Check the sample migration', 'Update the example client', 'Document the staged release', 'Verify rollback safety'][index % 4],
			url: `https://github.com/example/demo/${pull ? 'pull' : 'issues'}/${number}`,
			state: index === 3 || index === 4 ? 'MERGED' : index === 6 || index === 9 ? 'CLOSED' : 'OPEN',
			isDraft: index === 5,
			commits: { nodes: [{ commit: { statusCheckRollup: { state: index < 2 ? 'FAILURE' : index === 2 ? 'PENDING' : 'SUCCESS' } } }] },
		},
	};
});
