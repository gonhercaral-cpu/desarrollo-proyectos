import { useEffect, useRef, useState } from "react";

const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const VIDEO_MAX_BYTES = 80 * 1024 * 1024;

function getMediaKind(file) {
  if (String(file?.type || "").startsWith("video/")) return "video";
  if (String(file?.type || "").startsWith("audio/")) return "audio";
  return "";
}

function getRecorderMimeType(kind) {
  const candidates = kind === "video"
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

export default function ProjectMediaComposer({ items = [], onChange, disabled = false, compact = false }) {
  const [recordingKind, setRecordingKind] = useState("");
  const [error, setError] = useState("");
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const previewUrlsRef = useRef(new Set());
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    const previewUrls = previewUrlsRef.current;
    return () => {
      disposedRef.current = true;
      if (recorderRef.current) recorderRef.current.onstop = null;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const activeUrls = new Set(items.map((item) => item.previewUrl).filter(Boolean));
    previewUrlsRef.current.forEach((url) => {
      if (!activeUrls.has(url)) {
        URL.revokeObjectURL(url);
        previewUrlsRef.current.delete(url);
      }
    });
  }, [items]);

  function appendFiles(selectedFiles) {
    setError("");
    const nextItems = [];
    for (const file of selectedFiles) {
      const kind = getMediaKind(file);
      if (!kind) {
        setError("Solo se permiten archivos de audio o video.");
        continue;
      }
      const maxBytes = kind === "video" ? VIDEO_MAX_BYTES : AUDIO_MAX_BYTES;
      if (file.size > maxBytes) {
        setError(`${file.name} supera el máximo de ${kind === "video" ? 80 : 25} MB.`);
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      nextItems.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, kind, previewUrl });
    }
    if (nextItems.length) onChange([...items, ...nextItems]);
  }

  function removeItem(itemId) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (item?.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
      previewUrlsRef.current.delete(item.previewUrl);
    }
    onChange(items.filter((candidate) => candidate.id !== itemId));
  }

  async function toggleRecording(kind) {
    if (recordingKind) {
      recorderRef.current?.stop();
      return;
    }
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este navegador no permite grabar multimedia.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === "video" ? { audio: true, video: true } : { audio: true }
      );
      const mimeType = getRecorderMimeType(kind);
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
      recorder.onstop = () => {
        const resolvedType = recorder.mimeType || mimeType || `${kind}/webm`;
        const extension = resolvedType.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunksRef.current, { type: resolvedType });
        const file = new File([blob], `${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`, { type: resolvedType });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (disposedRef.current) return;
        setRecordingKind("");
        if (file.size) appendFiles([file]);
      };
      recorder.start(250);
      setRecordingKind(kind);
    } catch (recordingError) {
      console.error(recordingError);
      setError("No se pudo acceder a cámara o micrófono. Revisa permisos del navegador.");
    }
  }

  return (
    <div className={`project-media-composer${compact ? " compact" : ""}`}>
      <div className="project-media-actions">
        <label className="project-media-button">
          Adjuntar audio/video
          <input type="file" accept="audio/*,video/*" multiple disabled={disabled || Boolean(recordingKind)} onChange={(event) => {
            appendFiles(Array.from(event.target.files || []));
            event.target.value = "";
          }} />
        </label>
        <button type="button" disabled={disabled || (recordingKind && recordingKind !== "audio")} className={recordingKind === "audio" ? "recording" : ""} onClick={() => toggleRecording("audio")}>
          {recordingKind === "audio" ? "Detener audio" : "Grabar audio"}
        </button>
        <button type="button" disabled={disabled || (recordingKind && recordingKind !== "video")} className={recordingKind === "video" ? "recording" : ""} onClick={() => toggleRecording("video")}>
          {recordingKind === "video" ? "Detener video" : "Grabar video"}
        </button>
      </div>
      {error && <p className="project-media-error" role="alert">{error}</p>}
      {items.length > 0 && (
        <div className="project-media-drafts">
          {items.map((item) => (
            <article key={item.id}>
              {item.kind === "audio" ? <audio controls src={item.previewUrl} /> : <video controls src={item.previewUrl} />}
              <div><span>{item.kind === "audio" ? "Audio" : "Video"}</span><strong>{item.file?.name}</strong></div>
              <button type="button" onClick={() => removeItem(item.id)} disabled={disabled} aria-label={`Eliminar ${item.file?.name}`}>×</button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
