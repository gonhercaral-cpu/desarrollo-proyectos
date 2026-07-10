import { useEffect, useRef, useState } from "react";

let activeAudio = null;

function formatTime(value) {
  if (!Number.isFinite(value)) return "0:00";
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function MessageAudioPlayer({ attachment }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (activeAudio === audio) activeAudio = null;
      audio?.pause();
    };
  }, []);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (activeAudio && activeAudio !== audio) activeAudio.pause();
    activeAudio = audio;
    try {
      await audio.play();
    } catch {
      setUnsupported(true);
    }
  }

  function changeSpeed() {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  if (unsupported) return <p className="attachment-audio-unsupported">Audio no compatible con este dispositivo.</p>;

  return (
    <div className="message-audio-player">
      <audio
        ref={audioRef}
        src={attachment.url}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setUnsupported(true)}
      />
      <button type="button" className="message-audio-play" onClick={togglePlayback} aria-label={playing ? "Pausar audio" : "Reproducir audio"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="message-audio-track">
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (audioRef.current) audioRef.current.currentTime = value;
            setCurrentTime(value);
          }}
          aria-label="Posición del audio"
        />
        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
      </div>
      <button type="button" className="message-audio-speed" onClick={changeSpeed} aria-label={`Velocidad ${speed}x`}>{speed}x</button>
    </div>
  );
}
