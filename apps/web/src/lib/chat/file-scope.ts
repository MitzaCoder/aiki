import { getContext, setContext } from 'svelte';
import type { ChatFile } from '@kemiri/protocol';
const key = Symbol('chat-file-download');
export function provideFileDownload(download: (file: ChatFile) => Promise<void>): void { setContext(key, download); }
export function fileDownload(): ((file: ChatFile) => Promise<void>) | undefined { return getContext(key); }
