import MessageAudioPlayer from "./MessageAudioPlayer";

function getUrl(item) {
  return item?.url || item?.downloadUrl || item?.downloadURL || item?.fileUrl || "";
}

function getKind(item) {
  const type = String(item?.fileType || item?.type || item?.mimeType || "").toLowerCase();
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return item?.kind || "";
}

export default function ProjectMediaList({ items = [], className = "" }) {
  const mediaItems = items.filter((item) => getUrl(item) && getKind(item));
  if (!mediaItems.length) return null;

  return (
    <div className={`project-media-list ${className}`.trim()}>
      {mediaItems.map((item, index) => {
        const url = getUrl(item);
        const kind = getKind(item);
        const name = item.fileName || item.name || `${kind === "audio" ? "Audio" : "Video"} adjunto`;
        return (
          <article key={item.filePath || item.id || `${name}-${index}`}>
            <strong>{name}</strong>
            {kind === "audio" ? (
              <MessageAudioPlayer attachment={{ ...item, url }} />
            ) : (
              <video controls preload="metadata" src={url}>Video no compatible con este navegador.</video>
            )}
          </article>
        );
      })}
    </div>
  );
}
