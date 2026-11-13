package io.github.mitzacoder.kemiri.features.chat

internal data class ComposerControlLayout(val model: Float, val effort: Float, val worker: Float, val stackCoordinator: Boolean) {
    val coordinatorWidth: Float get() = if(stackCoordinator) maxOf(model,effort) else model + effort + 8f
}
/** Applied to the measured remaining space, after attachment/stop controls and composer insets.
 * Labels are width-bounded with full accessibility text; FlowRow wraps whole controls, never clips a scroller.
 */
internal fun composerControlLayout(availableDp: Float, fontScale: Float = 1f): ComposerControlLayout {
    val width = availableDp.coerceAtLeast(48f)
    val scale = fontScale.coerceAtLeast(1f)
    if(width < 208f * scale) return ComposerControlLayout(width,width,width,true)
    val effort = (104f * scale).coerceAtMost(width - 128f)
    val model = (192f * scale).coerceAtMost(width - effort - 8f)
    val desiredWorker = 232f * scale
    val worker = if(model + effort + desiredWorker + 16f <= width) desiredWorker else width
    return ComposerControlLayout(model,effort,worker,false)
}
internal fun composerControlDescription(label: String, provider: String?, modelId: String?, worker: Boolean, thinking: String?): String =
    "${if(worker) "Worker" else "Coordinator"} model: $label" +
        (if(modelId == null) "; using defaults" else "; ${provider.orEmpty()}/$modelId") +
        "; thinking: ${thinking ?: "model default"}"
/** Below this the controls sit in one row: the model chip shows its whole name or its icon, and the thinking and worker chips are icons (web's phone composer). */
internal fun composerControlsCompact(availableDp: Float, fontScale: Float = 1f): Boolean = availableDp < 440f * fontScale.coerceAtLeast(1f)
/** A compact model chip's padding, icon and gaps around its name (Material's assist chip without a trailing icon). */
internal const val COMPACT_MODEL_CHIP_CHROME_DP = 44f
/** Whether the phone's model chip shows its whole name in [availableDp], or turns into its icon. */
internal fun compactChipShowsLabel(availableDp: Float, labelDp: Float): Boolean = labelDp + COMPACT_MODEL_CHIP_CHROME_DP <= availableDp
