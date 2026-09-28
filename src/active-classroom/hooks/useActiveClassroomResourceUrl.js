import { useEffect, useRef, useState } from "react";
import { getActiveClassroomResourceUrl } from "../services/activeClassroomService";
import { getCloudFileContent } from "../../services/driveService";
import { isDriveResource } from "../utils/driveResources";

export default function useActiveClassroomResourceUrl(resource) {
  const [state, setState] = useState({ resourceId: "", url: "", error: "" });
  const requestId = useRef(0);
  const blobUrl = useRef("");
  const id = resource?.id;
  const storagePath = resource?.storagePath;
  const drive = isDriveResource(resource);

  useEffect(() => {
    let active = true;
    if (id && storagePath && !drive) getActiveClassroomResourceUrl({ storagePath })
      .then((url) => {
        if (active) setState({ resourceId: id, url, error: "" });
      })
      .catch((error) => {
        if (active) {
          setState({
            resourceId: id,
            url: "",
            error: error?.message || "No se pudo abrir recurso.",
          });
        }
      });

    return () => {
      active = false;
      requestId.current += 1;
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = "";
    };
  }, [id, storagePath, drive]);

  async function loadDriveContent() {
    const currentRequest = ++requestId.current;
    setState({ resourceId: id, url: "", error: "", loading: true });
    try {
      const content = await getCloudFileContent({
        id: resource.driveFileId, name: resource.name, mimeType: resource.mimeType, size: resource.sizeBytes,
      });
      if (currentRequest !== requestId.current) return;
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = URL.createObjectURL(content.blob);
      setState({ resourceId: id, url: blobUrl.current, error: "", loading: false, downloadName: content.deliveredName });
    } catch (error) {
      if (currentRequest === requestId.current) setState({ resourceId: id, url: "", error: error.message || "No se pudo abrir Nube AES.", loading: false });
    }
  }

  if (!resource || state.resourceId !== resource.id) {
    return { url: "", error: "", loading: false, loadDriveContent };
  }

  return { ...state, loadDriveContent };
}
