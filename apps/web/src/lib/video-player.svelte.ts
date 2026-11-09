/**
 * One video element's state for the custom controls, read from the element on its media events (`sync`), and the
 * actions the controls and shortcuts take on it. The speed the reader picks is remembered for every video.
 */
import {
	FRAME_SECONDS,
	clampTime,
	loadVideoMemory,
	saveVideoMemory,
	stepRate,
	videoHasAudio,
	type AudioProbe,
	type PlayerAction,
} from "./video-player.ts";

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitDisplayingFullscreen?: boolean };

export class VideoPlayer {
	video = $state<HTMLVideoElement | null>(null);
	frame = $state<HTMLElement | null>(null);
	paused = $state(true);
	ended = $state(false);
	time = $state(0);
	duration = $state(Number.NaN);
	buffered = $state<{ start: number; end: number }[]>([]);
	rate = $state(loadVideoMemory().rate);
	muted = $state(false);
	volume = $state(1);
	/** Undefined until the browser can tell; the volume control shows only for true. */
	hasAudio = $state<boolean | undefined>(undefined);
	fullscreen = $state(false);
	pictureInPicture = $state(false);

	get canPictureInPicture(): boolean {
		return typeof document !== "undefined" && document.pictureInPictureEnabled === true && this.video?.disablePictureInPicture !== true;
	}

	/** Read the element after one of its media events. */
	sync(): void {
		const video = this.video;
		if (video == null) return;
		this.paused = video.paused;
		this.ended = video.ended;
		this.time = video.currentTime;
		this.duration = video.duration;
		this.muted = video.muted;
		this.volume = video.volume;
		const ranges: { start: number; end: number }[] = [];
		for (let index = 0; index < video.buffered.length; index += 1) ranges.push({ start: video.buffered.start(index), end: video.buffered.end(index) });
		this.buffered = ranges;
		if (this.hasAudio === undefined) this.hasAudio = videoHasAudio(video as HTMLVideoElement & AudioProbe);
	}

	/** Put the remembered speed back: loading a new URL resets the element's. */
	applyRate(): void {
		if (this.video == null) return;
		this.video.defaultPlaybackRate = this.rate;
		this.video.playbackRate = this.rate;
	}

	play(): void {
		void this.video?.play().catch(() => {});
	}

	toggle(): void {
		if (this.video == null) return;
		if (this.video.paused || this.video.ended) this.play();
		else this.video.pause();
	}

	seekTo(seconds: number): void {
		if (this.video == null) return;
		const time = clampTime(seconds, this.video.duration);
		this.video.currentTime = time;
		this.time = time;
	}

	seekBy(seconds: number): void {
		if (this.video != null) this.seekTo(this.video.currentTime + seconds);
	}

	step(frames: 1 | -1): void {
		if (this.video == null) return;
		this.video.pause();
		this.seekBy(frames * FRAME_SECONDS);
	}

	setRate(rate: number): void {
		this.rate = rate;
		this.applyRate();
		saveVideoMemory({ ...loadVideoMemory(), rate });
	}

	toggleMute(): void {
		if (this.video == null) return;
		this.video.muted = !this.video.muted;
		if (!this.video.muted && this.video.volume === 0) this.video.volume = 1;
	}

	setVolume(volume: number): void {
		if (this.video == null) return;
		this.video.volume = Math.min(1, Math.max(0, volume));
		this.video.muted = volume === 0;
	}

	/** The frame goes fullscreen so the controls come along; an iPhone only has the element's own fullscreen player. */
	toggleFullscreen(): void {
		if (typeof document === "undefined") return;
		if (document.fullscreenElement !== null && document.fullscreenElement !== undefined) {
			void document.exitFullscreen().catch(() => {});
			return;
		}
		const video = this.video as FullscreenVideo | null;
		if (this.frame?.requestFullscreen !== undefined && document.fullscreenEnabled) void this.frame.requestFullscreen().catch(() => {});
		else video?.webkitEnterFullscreen?.();
	}

	togglePictureInPicture(): void {
		if (typeof document === "undefined" || this.video == null) return;
		if (document.pictureInPictureElement === this.video) void document.exitPictureInPicture().catch(() => {});
		else if (this.canPictureInPicture) void this.video.requestPictureInPicture().catch(() => {});
	}

	/** Watch the document for the frame entering and leaving fullscreen; returns the cleanup. */
	watchFullscreen(): () => void {
		const update = (): void => {
			this.fullscreen = this.frame != null && document.fullscreenElement === this.frame;
		};
		document.addEventListener("fullscreenchange", update);
		return () => document.removeEventListener("fullscreenchange", update);
	}

	/** Follow `video` in and out of picture in picture; returns the cleanup. */
	watchPictureInPicture(video: HTMLVideoElement | null): (() => void) | undefined {
		if (video == null) return undefined;
		const enter = (): void => {
			this.pictureInPicture = true;
		};
		const leave = (): void => {
			this.pictureInPicture = false;
		};
		video.addEventListener("enterpictureinpicture", enter);
		video.addEventListener("leavepictureinpicture", leave);
		return () => {
			video.removeEventListener("enterpictureinpicture", enter);
			video.removeEventListener("leavepictureinpicture", leave);
		};
	}

	run(action: PlayerAction): void {
		switch (action.kind) {
			case "toggle":
				return this.toggle();
			case "seek":
				return this.seekBy(action.by);
			case "frame":
				return this.step(action.by);
			case "fullscreen":
				return this.toggleFullscreen();
			case "mute":
				return this.toggleMute();
			case "volume":
				return this.setVolume(this.muted ? Math.max(0, action.by) : this.volume + action.by);
			case "rate":
				return this.setRate(stepRate(this.rate, action.step));
		}
	}
}
