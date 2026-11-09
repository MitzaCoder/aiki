// Subset of Lucide (@lucide/svelte 1.64.0), ISC license; see LUCIDE-LICENSE.txt.
package com.mihaisaru.harness.features.refs

import com.mihaisaru.harness.ui.components.LucideIcon

/** The icons a ref card's heading wears (web `RefCard.svelte`). */
internal object RefIcons {
    val GitPullRequest = LucideIcon("git-pull-request", "M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M13 6h3a2 2 0 0 1 2 2v7", "M6 9L6 21")
    val GitMerge = LucideIcon("git-merge", "M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M6 21V9a9 9 0 0 0 9 9")
    val GitPullRequestClosed = LucideIcon("git-pull-request-closed", "m15.5 3.5 5 5", "m15.5 8.5 5-5", "M18 11.62V15", "M6 9v12", "M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0")
    val GitPullRequestDraft = LucideIcon("git-pull-request-draft", "M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M18 6V5", "M18 11v-1", "M6 9L6 21")
    val Ticket = LucideIcon("ticket", "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z", "M13 5v2", "M13 17v2", "M13 11v2")
    val CircleDot = LucideIcon("circle-dot", "M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0")
}
