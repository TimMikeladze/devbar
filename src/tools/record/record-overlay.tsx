import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@/session/types";

type RecordOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
	initialMode: "tab" | "screen";
};

type RecordMode = "requesting" | "recording" | "processing" | "note";

function captureThumbnail(video: HTMLVideoElement): Promise<string> {
	return new Promise((resolve) => {
		const canvas = document.createElement("canvas");
		canvas.width = Math.min(video.videoWidth, 640);
		canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth));
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			resolve("");
			return;
		}
		ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
		resolve(canvas.toDataURL("image/png"));
	});
}

function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecordOverlay({ onCapture, onDone, initialMode }: RecordOverlayProps): React.ReactNode {
	const [mode, setMode] = useState<RecordMode>("requesting");
	const [pendingAnnotation, setPendingAnnotation] = useState<Annotation | null>(null);
	const [noteText, setNoteText] = useState("");
	const [elapsed, setElapsed] = useState(0);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const startTimeRef = useRef(0);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const startedRef = useRef(false);

	const cleanup = useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}
		mediaRecorderRef.current = null;
		chunksRef.current = [];
	}, []);

	const stopRecording = useCallback(() => {
		if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
			mediaRecorderRef.current.stop();
		}
	}, []);

	const processRecording = useCallback(
		async (blob: Blob, duration: number, mimeType: string) => {
			setMode("processing");

			const videoBlobUrl = URL.createObjectURL(blob);
			let thumbnailDataUri = "";

			try {
				const video = document.createElement("video");
				video.muted = true;
				video.playsInline = true;
				video.src = videoBlobUrl;

				await new Promise<void>((resolve, reject) => {
					video.onloadeddata = () => resolve();
					video.onerror = () => reject(new Error("Failed to load video"));
					video.load();
				});

				const seekTime = Math.min(1, duration * 0.1);
				video.currentTime = seekTime;
				await new Promise<void>((resolve) => {
					video.onseeked = () => resolve();
				});

				thumbnailDataUri = await captureThumbnail(video);
			} catch {
				// Thumbnail capture failed, proceed without it
			}

			const annotation: Annotation = {
				id: crypto.randomUUID(),
				type: "recording",
				timestamp: Date.now(),
				data: {
					videoBlobUrl,
					thumbnailDataUri,
					duration,
					mimeType,
				},
				comments: [],
			};

			setPendingAnnotation(annotation);
			setNoteText("");
			setMode("note");
		},
		[],
	);

	const startRecording = useCallback(
		async (captureTab: boolean) => {
			setMode("requesting");

			try {
				const displayMediaOptions: DisplayMediaStreamOptions = {
					video: {
						displaySurface: captureTab ? "browser" : "monitor",
					},
					audio: true,
				};

				if (captureTab) {
					(displayMediaOptions as Record<string, unknown>).preferCurrentTab = true;
				}

				const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
				streamRef.current = stream;

				const videoTrack = stream.getVideoTracks()[0];
				if (videoTrack) {
					videoTrack.onended = () => {
						stopRecording();
					};
				}

				const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
					? "video/webm;codecs=vp9,opus"
					: MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
						? "video/webm;codecs=vp8,opus"
						: "video/webm";

				const recorder = new MediaRecorder(stream, { mimeType });
				mediaRecorderRef.current = recorder;
				chunksRef.current = [];

				recorder.ondataavailable = (e) => {
					if (e.data.size > 0) chunksRef.current.push(e.data);
				};

				recorder.onstop = () => {
					const duration = (Date.now() - startTimeRef.current) / 1000;
					const blob = new Blob(chunksRef.current, { type: mimeType });

					if (streamRef.current) {
						for (const track of streamRef.current.getTracks()) {
							track.stop();
						}
					}

					if (timerRef.current) {
						clearInterval(timerRef.current);
						timerRef.current = null;
					}

					processRecording(blob, duration, mimeType);
				};

				recorder.onerror = () => {
					cleanup();
					onDone();
				};

				recorder.start(1000);
				startTimeRef.current = Date.now();
				setElapsed(0);
				setMode("recording");

				timerRef.current = setInterval(() => {
					setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
				}, 1000);
			} catch {
				cleanup();
				onDone();
			}
		},
		[cleanup, stopRecording, processRecording, onDone],
	);

	// Start recording immediately on mount
	useEffect(() => {
		if (startedRef.current) return;
		startedRef.current = true;
		startRecording(initialMode === "tab");
	}, [initialMode, startRecording]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (mode === "recording") {
					stopRecording();
				} else if (mode === "note" && pendingAnnotation) {
					onCapture(pendingAnnotation);
					onDone();
				} else {
					cleanup();
					onDone();
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [mode, pendingAnnotation, onCapture, onDone, stopRecording, cleanup]);

	const submitNote = useCallback(() => {
		if (!pendingAnnotation) return;
		const comments = noteText.trim()
			? [
					{
						id: crypto.randomUUID(),
						author: localStorage.getItem("deloop-author") || "Anonymous",
						text: noteText.trim(),
						timestamp: Date.now(),
					},
				]
			: [];
		const updated = { ...pendingAnnotation, comments };
		onCapture(updated);
		onDone();
	}, [pendingAnnotation, noteText, onCapture, onDone]);

	return (
		<div data-deloop="record-overlay" className="deloop-overlay">
			{mode === "requesting" && (
				<div className="deloop-capture-status">Requesting access...</div>
			)}

			{mode === "recording" && (
				<div data-deloop-capture-toolbar className="deloop-overlay-toolbar">
					<span className="deloop-record-dot" />
					<span className="deloop-record-time">{formatDuration(elapsed)}</span>
					<div className="deloop-overlay-toolbar-divider" />
					<button
						type="button"
						onClick={stopRecording}
						className="deloop-overlay-btn deloop-record-stop"
					>
						Stop
					</button>
				</div>
			)}

			{mode === "processing" && (
				<div className="deloop-capture-status">Processing recording...</div>
			)}

			{mode === "note" && (
				<div data-deloop="note-input" className="deloop-capture-note">
					<div className="deloop-capture-note-title">Recording captured</div>
					<input
						type="text"
						placeholder="Add a note (optional)"
						value={noteText}
						onChange={(e) => setNoteText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") submitNote();
						}}
						autoFocus
					/>
					<div className="deloop-capture-note-actions">
						<button
							type="button"
							className="deloop-overlay-btn deloop-overlay-btn-primary"
							style={{ flex: 1 }}
							onClick={submitNote}
						>
							Save
						</button>
						<button
							type="button"
							className="deloop-overlay-btn"
							onClick={() => {
								if (pendingAnnotation) onCapture(pendingAnnotation);
								onDone();
							}}
						>
							Skip
						</button>
					</div>
				</div>
			)}

			{mode === "recording" && (
				<div className="deloop-instruction">
					Recording &middot; <kbd>Esc</kbd> to stop
				</div>
			)}
		</div>
	);
}
