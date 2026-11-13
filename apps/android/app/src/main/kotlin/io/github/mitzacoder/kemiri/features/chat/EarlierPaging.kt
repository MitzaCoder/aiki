package io.github.mitzacoder.kemiri.features.chat

/** Stay a few rows ahead; also fill short viewports without requiring a gesture. Errors need an explicit Retry. */
fun shouldPrefetchEarlier(
    firstVisibleItemIndex: Int,
    viewportReady: Boolean,
    canLoadEarlier: Boolean,
    loadingEarlier: Boolean,
    failed: Boolean,
    following: Boolean,
    canScrollForward: Boolean,
    highlighting: Boolean,
): Boolean = viewportReady && firstVisibleItemIndex <= 6 && canLoadEarlier && !loadingEarlier && !failed &&
    (!following || !canScrollForward) && !highlighting
