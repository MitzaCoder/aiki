package com.termux.terminal;

import java.util.UUID;

/**
 * A terminal session backed by a remote PTY: the bytes the other end wrote go in through {@link #append}, what the user
 * types goes out through the {@link Sink}.
 * <p>
 * Patched from Termux's {@code TerminalSession}, which forked a local process through JNI. Here there is no process:
 * the owner feeds output with {@link #append(byte[], int, int)} and the session reports typed bytes and size changes to
 * its {@link Sink}. Everything except {@link Sink#send} and {@link Sink#resized} runs on the main thread, like the
 * original (the emulator and the view are not thread safe).
 * <p>
 * NOTE: The session outlives the view; the view re-attaches to it after a rotation.
 */
public final class TerminalSession extends TerminalOutput {

    /** Where typed bytes and size changes go. */
    public interface Sink {
        /** Bytes the user typed (UTF-8 for text). Called on the main thread. */
        void send(byte[] data, int offset, int count);

        /** The emulator's size changed (also called once when it is first sized). Called on the main thread. */
        void resized(int columns, int rows);
    }

    public final String mHandle = UUID.randomUUID().toString();

    TerminalEmulator mEmulator;

    /** Callback which gets notified when the screen changes or the title changes. */
    TerminalSessionClient mClient;

    private final Sink mSink;
    private final Integer mTranscriptRows;
    /** Buffer to write code points into UTF-8 before sending them. */
    private final byte[] mUtf8InputBuffer = new byte[5];
    private boolean mFinished;
    private int mColumns = -1, mRows = -1;

    /** Set by the application for user identification of the session, not by the terminal. */
    public String mSessionName;

    public TerminalSession(Sink sink, Integer transcriptRows, TerminalSessionClient client) {
        this.mSink = sink;
        this.mTranscriptRows = transcriptRows;
        this.mClient = client;
    }

    public void updateTerminalSessionClient(TerminalSessionClient client) {
        mClient = client;
        if (mEmulator != null) mEmulator.updateTerminalSessionClient(client);
    }

    /** Create the emulator at this size, or resize it, and tell the sink when the size is new. */
    public void updateSize(int columns, int rows) {
        if (mEmulator == null) {
            mEmulator = new TerminalEmulator(this, columns, rows, mTranscriptRows, mClient);
        } else if (columns != mColumns || rows != mRows) {
            mEmulator.resize(columns, rows);
        }
        if (columns != mColumns || rows != mRows) {
            mColumns = columns;
            mRows = rows;
            mSink.resized(columns, rows);
        }
    }

    /** The terminal title as set through escape sequences or null if none set. */
    public String getTitle() {
        return (mEmulator == null) ? null : mEmulator.getTitle();
    }

    /** Feed output bytes to the emulator and tell the client the screen changed. Main thread only. */
    public void append(byte[] data, int offset, int count) {
        if (mEmulator == null || count <= 0) return;
        if (offset == 0) {
            mEmulator.append(data, count);
        } else {
            byte[] copy = new byte[count];
            System.arraycopy(data, offset, copy, 0, count);
            mEmulator.append(copy, count);
        }
        notifyScreenUpdate();
    }

    /** Write data to the remote shell. */
    @Override
    public void write(byte[] data, int offset, int count) {
        if (!mFinished) mSink.send(data, offset, count);
    }

    /** Write the Unicode code point to the terminal encoded in UTF-8. */
    public void writeCodePoint(boolean prependEscape, int codePoint) {
        if (codePoint > 1114111 || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
            // 1114111 (= 2**16 + 1024**2 - 1) is the highest code point, [0xD800,0xDFFF] is the surrogate range.
            throw new IllegalArgumentException("Invalid code point: " + codePoint);
        }

        int bufferPosition = 0;
        if (prependEscape) mUtf8InputBuffer[bufferPosition++] = 27;

        if (codePoint <= /* 7 bits */0b1111111) {
            mUtf8InputBuffer[bufferPosition++] = (byte) codePoint;
        } else if (codePoint <= /* 11 bits */0b11111111111) {
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b11000000 | (codePoint >> 6));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | (codePoint & 0b111111));
        } else if (codePoint <= /* 16 bits */0b1111111111111111) {
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b11100000 | (codePoint >> 12));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | ((codePoint >> 6) & 0b111111));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | (codePoint & 0b111111));
        } else {
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b11110000 | (codePoint >> 18));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | ((codePoint >> 12) & 0b111111));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | ((codePoint >> 6) & 0b111111));
            mUtf8InputBuffer[bufferPosition++] = (byte) (0b10000000 | (codePoint & 0b111111));
        }
        write(mUtf8InputBuffer, 0, bufferPosition);
    }

    public TerminalEmulator getEmulator() {
        return mEmulator;
    }

    /** Notify the {@link #mClient} that the screen has changed. */
    protected void notifyScreenUpdate() {
        mClient.onTextChanged(this);
    }

    /** Reset the emulator's state (the next output repaints the screen). */
    public void reset() {
        if (mEmulator == null) return;
        mEmulator.reset();
        notifyScreenUpdate();
    }

    /** The session ended: typing goes nowhere from now on. */
    public void markFinished() {
        mFinished = true;
    }

    public boolean isRunning() {
        return !mFinished;
    }

    @Override
    public void titleChanged(String oldTitle, String newTitle) {
        mClient.onTitleChanged(this);
    }

    @Override
    public void onCopyTextToClipboard(String text) {
        mClient.onCopyTextToClipboard(this, text);
    }

    @Override
    public void onPasteTextFromClipboard() {
        mClient.onPasteTextFromClipboard(this);
    }

    @Override
    public void onBell() {
        mClient.onBell(this);
    }

    @Override
    public void onColorsChanged() {
        mClient.onColorsChanged(this);
    }
}
