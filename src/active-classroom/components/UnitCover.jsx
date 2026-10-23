import { useEffect, useState } from "react";
import { getBuildPreview } from "../services/unitEditorService";
import { getActiveClassroomResourceUrl } from "../services/activeClassroomService";
import ActiveClassroomIcon from "./ActiveClassroomIcon";
const previews = new Map();
export default function UnitCover({ unit, resources = [], showLevel = true }) {
  const [image, setImage] = useState("");
  const main = resources.find(file => file.id === unit.document?.draft?.mainPresentationId);
  const initialId = unit.document?.draft?.slides?.[0]?.interaction?.initialResourceId;
  const fallback = resources.find(file => file.id === initialId && file.storagePath) || resources.find(file => file.folderId === unit.id && file.kind === "image" && file.storagePath);
  const key = `${unit.id}:${main?.processing?.revision || fallback?.id || ""}`;
  useEffect(() => {
    let live = true;
    const load = async () => {
      if (previews.has(key)) { if (live) setImage(previews.get(key)); return; }
      let url = "";
      if (initialId && fallback) url = await getActiveClassroomResourceUrl(fallback);
      else if (main?.processing?.state === "ready") { const result = await getBuildPreview(unit.id, main.id, main.processing.pages?.[0]?.pageObjectId); if (result.mimeType.startsWith("image/")) url = result.url; }
      else if (fallback) url = await getActiveClassroomResourceUrl(fallback);
      if (live) setImage(url); if (url) { if (previews.size > 200) previews.clear(); previews.set(key, url); }
    };
    void load().catch(() => { if (live) setImage(""); }); return () => { live = false; };
  }, [key, unit.id, main, fallback, initialId]);
  return <div className="ac-console-cover">{image ? <img src={image} alt={`Vista previa de ${unit.name}`} loading="lazy" onError={() => { previews.delete(key); setImage(""); }} /> : <ActiveClassroomIcon name="folder" size={58} />}{showLevel && <span className="ac-level-chip">{unit.level?.name || unit.name}</span>}</div>;
}
