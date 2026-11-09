# The vendored Termux terminal

`com/termux/terminal` and `com/termux/view` are the Termux `terminal-emulator` and `terminal-view` libraries at v0.118.1
(Apache 2.0, see `apps/android/licenses/APACHE-2.0-termux-terminal.txt`), copied from the sources jars on JitPack
(`com.github.termux.termux-app:terminal-emulator:v0.118.1`, `terminal-view`). They are copied and not depended on because
Termux publishes them only on JitPack, and because `TerminalSession`, the class the view talks to, forks a local process
through JNI: the app's terminal is a remote PTY (a zellij session on a backend), so that class had to change. Why a native
view and not xterm.js in a WebView: `docs/DESIGN.md`, "Terminals" → "Android".

To update: fetch the newer sources jars, diff them against the originals of v0.118.1 (the list below is everything that
differs), and re-apply the changes.

## What differs from upstream

- **Removed:** `JNI.java` and `ByteQueue.java` (the process, its pipes and the native `libtermux.so`, four ABIs of it).
- **`terminal/TerminalSession.java`: rewritten.** No process: output goes in through `append(bytes)`, typed bytes and the
  emulator's size go out through a `Sink` (`send`, `resized`). `markFinished()` replaces the process exit. The rest of the
  API the view uses is kept (`getEmulator`, `write`, `writeCodePoint`, `updateSize`, `reset`, `isRunning`, the
  `TerminalOutput` callbacks). The emulator is created by `updateSize` (the app does it before a view exists, so output that
  arrives early is not lost) and resizes only when the size changed.
- **`terminal/TerminalEmulator.java`:** colour queries (OSC 10/11/12 with `?`) and termcap queries (`DCS + q`) are not
  answered (`REPLY_TO_COLOR_QUERIES`, false). Behind zellij the replies reach the shell as typed text (`11;rgb:…` and `0+r`
  printed at fish's prompt) because the program that asked has stopped reading by the time they arrive; xterm.js, which the
  web uses, does not answer `DCS + q` either.
- **`view/TerminalView.java`:** `getSelectedTextOrNull()` and `getRowText(row)` added (the app's Copy button and link
  detection); a tap while the program has mouse reporting on first goes to the client (`onTapWhileMouseTracking`), which
  shows the keyboard or opens a link, and only an unused tap is sent as a click (zellij turns mouse reporting on, which
  otherwise kept the keyboard from showing).
- **`view/TerminalViewClient.java`:** `onTapWhileMouseTracking(MotionEvent)` added.
- **`view/textselection/TextSelectionCursorController.java`:** `getSelectedText()` added; the "More…" action (it opened a
  context menu the app does not have) is gone; strings come from `res/values/terminal.xml`.
- **`view/textselection/TextSelectionHandleView.java`:** the handle drawables are the app's (`terminal_select_handle_*`, in
  the accent colour); `R` is the app's.
- Not changed: the emulator's parsing, `TerminalBuffer`, `TerminalRow`, `TerminalRenderer`, `KeyHandler`, `WcWidth`,
  `GestureAndScaleRecognizer`, the colour classes (the app paints its theme into `TerminalColors` at run time).
