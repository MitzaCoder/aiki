@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package com.mihaisaru.harness.features.chat

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.content.MediaType
import androidx.compose.foundation.content.ReceiveContentListener
import androidx.compose.foundation.content.TransferableContent
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.content.hasMediaType
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import com.mihaisaru.harness.ui.components.JarvisIconButton
import com.mihaisaru.harness.ui.components.Lucide
import com.mihaisaru.harness.ui.theme.Jarvis
import kotlinx.coroutines.launch

/**
 * How a message box takes images: the attach button's picker (several at once) and the receiver for what is pasted from the
 * clipboard or committed by the keyboard (Gboard's images and stickers). Both end in [attach], which is told the files and
 * whatever could not even be read.
 */
@Stable
internal class ImageIntake(val pick: () -> Unit, val receiver: ReceiveContentListener)

/** The files [uris] point at, read now; one that cannot be read is a problem, not an exception. */
private fun readAll(context: android.content.Context, uris: List<Uri>): List<Pair<RawImage?, String?>> = uris.map { uri ->
    try { readRawImage(context.contentResolver, uri) to null } catch (e: ImageProblem) { null to "An image ${e.message}" }
}

@Composable
internal fun rememberImageIntake(attach: suspend (List<Pair<RawImage?, String?>>) -> Unit): ImageIntake {
    val android = LocalContext.current
    val scope = rememberCoroutineScope()
    val latest by rememberUpdatedState(attach)
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isNotEmpty()) scope.launch { latest(kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { readAll(android, uris) }) }
    }
    return remember(android, scope) {
        ImageIntake(
            pick = { picker.launch("image/*") },
            receiver = ReceiveContentListener { content -> receiveImages(content, android) { files -> scope.launch { latest(files) } } },
        )
    }
}

/**
 * What a paste or the keyboard hands over: the images in it are read at once (the keyboard's permission to read them ends
 * with this call) and handed to [attach]; anything else (text) is returned for the field to take as usual.
 */
internal fun receiveImages(content: TransferableContent, context: android.content.Context, attach: (List<Pair<RawImage?, String?>>) -> Unit): TransferableContent? {
    if (!content.hasMediaType(MediaType.Image)) return content
    val uris = mutableListOf<Uri>()
    val rest = content.consume { item ->
        val uri = item.uri
        val image = uri != null && (context.contentResolver.getType(uri)?.startsWith("image/") ?: false)
        if (image && uri != null) uris += uri
        image
    }
    if (uris.isNotEmpty()) attach(readAll(context, uris))
    return rest
}

/** The pictures a message holds, small, each with a × and a tap to see it large. A reference whose bytes are not here yet is a quiet box. */
@Composable
internal fun ImageThumbs(images: List<DraftImage>, onRemove: (String) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf<DraftImage?>(null) }
    FlowRow(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        images.forEach { image ->
            val label = image.ref.name ?: "Image"
            Box(Modifier.padding(top = 6.dp, end = 6.dp)) {
                val shape = RoundedCornerShape(12.dp)
                if (image.bytes != null) AsyncImage(
                    model = image.bytes, contentDescription = "View $label larger", contentScale = ContentScale.Crop,
                    modifier = Modifier.size(64.dp).clip(shape).border(1.dp, Jarvis.colors.border, shape).clickable { open = image },
                ) else Box(Modifier.size(64.dp).clip(shape).background(Jarvis.colors.surface2).border(1.dp, Jarvis.colors.border, shape).semantics { contentDescription = "Loading $label" })
                Box(
                    Modifier.align(Alignment.TopEnd).offset(x = 6.dp, y = (-6).dp).size(24.dp).clip(CircleShape).background(Jarvis.colors.bgElev).border(1.dp, Jarvis.colors.border, CircleShape)
                        .clickable { onRemove(image.ref.id) }.semantics { contentDescription = "Remove $label" },
                    contentAlignment = Alignment.Center,
                ) { com.mihaisaru.harness.ui.components.LucideGlyph(Lucide.X, size = 14.dp) }
            }
        }
    }
    open?.let { image -> ImagePreview(image.bytes, image.ref.name ?: "Image") { open = null } }
}

/** One image over the chat, to see it; a tap or Back closes it. */
@Composable
internal fun ImagePreview(bytes: ByteArray?, label: String, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black.copy(alpha = .92f)).clickable(onClick = onDismiss).padding(12.dp), contentAlignment = Alignment.Center) {
            AsyncImage(model = bytes, contentDescription = label, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
        }
    }
}
