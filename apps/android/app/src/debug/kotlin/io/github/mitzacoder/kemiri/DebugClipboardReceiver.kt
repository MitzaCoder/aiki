package io.github.mitzacoder.kemiri

import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.provider.MediaStore
import android.util.Log

/**
 * Puts a picture on the system clipboard, from adb (debug builds only), so pasting images can be tried on an emulator, which has
 * no way to copy one:
 *
 *     adb shell am broadcast -a io.github.mitzacoder.aiki.DEBUG_COPY_IMAGE -p io.github.mitzacoder.aiki --es label "Login bug" --ei width 1200 --ei height 700
 *     adb shell input keyevent KEYCODE_PASTE        # with a message box focused
 *
 * The image is drawn here and saved in the media store (this app's own picture), and the clip points at its content URI, as
 * a screenshot's or a gallery's "copy" does.
 */
class DebugClipboardReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val label = intent.getStringExtra("label") ?: "Pasted image"
        val width = intent.getIntExtra("width", 1000).coerceIn(16, 6000)
        val height = intent.getIntExtra("height", 600).coerceIn(16, 6000)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.shader = LinearGradient(0f, 0f, width.toFloat(), height.toFloat(), Color.parseColor("#6d5dfc"), Color.parseColor("#12c2e9"), Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        paint.shader = null
        paint.color = Color.WHITE
        paint.textSize = height / 6f
        paint.isFakeBoldText = true
        canvas.drawText(label, width / 12f, height / 2f, paint)
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "harness-debug-${System.currentTimeMillis()}.png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/harness-debug")
        }
        val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        if (uri == null) { Log.w("HarnessClipboard", "debug copy: could not create the picture"); return }
        context.contentResolver.openOutputStream(uri)?.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        clipboard.setPrimaryClip(ClipData.newUri(context.contentResolver, label, uri))
        Log.i("HarnessClipboard", "debug copy: $label ${width}x$height -> $uri")
    }
}
