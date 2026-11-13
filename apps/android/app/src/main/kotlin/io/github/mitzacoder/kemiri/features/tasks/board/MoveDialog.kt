package io.github.mitzacoder.kemiri.features.tasks.board

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.protocol.BoardTask

/** A move waiting on the user's words: why it goes back from review, or what it waits on in Blocked. */
data class MoveRequest(val task: BoardTask, val target: String, val beforeId: String?, val placed: Boolean, val question: MoveQuestion)

/**
 * What a move asks before it goes (web `TaskMoveDialog.svelte`): why a task goes back from review to Working
 * (required; the agents get it with the move), or what a task moved to Blocked waits on (optional; it becomes the
 * task's blocked reason).
 */
@Composable
fun MoveDialog(request: MoveRequest, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by rememberSaveable(request.task.id, request.target) { mutableStateOf("") }
    val required = request.question == MoveQuestion.Reason
    val ready = !required || text.isNotBlank()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (required) "Send ${request.task.id} back to work" else "Move ${request.task.id} to Blocked") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    if (required) "Say what still needs doing. The agents get this with the task, “${request.task.title}”."
                    else "What is it waiting on? The agents see this on the task. You can leave it empty.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                OutlinedTextField(
                    text,
                    { text = it.take(2000) },
                    Modifier.fillMaxWidth().focusRequester(focus),
                    label = { Text(if (required) "What still needs doing" else "Waiting on (optional)") },
                    placeholder = { Text(if (required) "The login still fails on Safari." else "The API key from the platform team.") },
                    minLines = 3,
                )
            }
        },
        confirmButton = {
            Button(enabled = ready, onClick = { onConfirm(text.trim()) }) { Text(if (required) "Send back to Working" else "Move to Blocked") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
