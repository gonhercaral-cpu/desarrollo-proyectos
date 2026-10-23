import { useEffect, useState } from "react";
import { getActiveClassroomResourceUrl } from "../services/activeClassroomService";
import ActiveClassroomIcon from "./ActiveClassroomIcon";

export default function ContentCover({ storagePath, name, icon, className = "", children }) {
  const [image, setImage] = useState({ path: "", url: "" });
  useEffect(() => {
    let active = true;
    if (storagePath) getActiveClassroomResourceUrl({ storagePath }).then(url => {
      if (active) setImage({ path: storagePath, url });
    }).catch(() => {});
    return () => { active = false; };
  }, [storagePath]);
  const url = image.path === storagePath ? image.url : "";
  return <div className={`ac-content-cover ${className}`}>
    {url ? <img src={url} alt={name || ""} loading="lazy" onError={() => setImage({ path: "", url: "" })} /> : <span className="ac-cover-fallback" aria-hidden="true">{icon || <ActiveClassroomIcon name="library" size={38} />}</span>}
    {children}
  </div>;
}
