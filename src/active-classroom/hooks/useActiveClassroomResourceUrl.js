import { useEffect, useState } from "react";
import { getActiveClassroomResourceUrl } from "../services/activeClassroomService";

export default function useActiveClassroomResourceUrl(resource) {
  const [state, setState] = useState({ resourceId: "", url: "", error: "" });

  useEffect(() => {
    let active = true;

    if (!resource?.id || !resource?.storagePath) return undefined;

    getActiveClassroomResourceUrl(resource)
      .then((url) => {
        if (active) setState({ resourceId: resource.id, url, error: "" });
      })
      .catch((error) => {
        if (active) {
          setState({
            resourceId: resource.id,
            url: "",
            error: error?.message || "No se pudo abrir recurso.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [resource]);

  if (!resource || state.resourceId !== resource.id) {
    return { url: "", error: "" };
  }

  return { url: state.url, error: state.error };
}
