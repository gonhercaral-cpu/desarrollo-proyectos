import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createActiveClassroomUnit,
  deleteActiveClassroomResource,
  deleteActiveClassroomUnit,
  ensureActiveClassroomStructure,
  renameActiveClassroomUnit,
  setActiveClassroomResourcePublished,
  subscribeActiveClassroomFolders,
  subscribeActiveClassroomResources,
  uploadActiveClassroomResources,
} from "../services/activeClassroomService";
import { getFileExtension, sortFolders } from "../utils/resourceTypes";

export default function useActiveClassroomLibrary(profile) {
  const [folders, setFolders] = useState([]);
  const [resources, setResources] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState("root");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const profileUid = profile?.uid || profile?.id || "";
  const profileRole = String(profile?.role || "").trim().toLowerCase();
  const profileActive = profile?.active === true;
  const canManage = Boolean(profileUid) && profileActive && profileRole === "admin";

  useEffect(() => {
    if (!canManage) return undefined;

    let foldersReady = false;
    let resourcesReady = false;

    const markReady = () => {
      if (foldersReady && resourcesReady) setLoading(false);
    };
    const handleError = (subscriptionError) => {
      console.error("Error sincronizando Active Classroom:", subscriptionError);
      setError(subscriptionError?.code === "permission-denied"
        ? "Tu sesión no tiene permisos para consultar Active Classroom. Verifica perfil activo y rol administrador."
        : subscriptionError?.message || "No se pudo sincronizar Active Classroom.");
      setLoading(false);
    };

    const unsubscribeFolders = subscribeActiveClassroomFolders((items) => {
      foldersReady = true;
      setFolders(items.sort(sortFolders));
      markReady();
    }, handleError);
    const unsubscribeResources = subscribeActiveClassroomResources((items) => {
      resourcesReady = true;
      setResources(items);
      markReady();
    }, handleError);

    ensureActiveClassroomStructure({
      uid: profileUid,
      role: profileRole,
      active: profileActive,
    }).catch(handleError);

    return () => {
      unsubscribeFolders();
      unsubscribeResources();
    };
  }, [canManage, profileActive, profileRole, profileUid]);

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) || null,
    [folders, selectedFolderId]
  );
  const selectedResource = useMemo(
    () => resources.find((resource) => resource.id === selectedResourceId) || null,
    [resources, selectedResourceId]
  );
  const breadcrumbs = useMemo(() => {
    const items = [];
    let current = selectedFolder;

    while (current) {
      items.unshift(current);
      current = folders.find((folder) => folder.id === current.parentId) || null;
    }

    return items;
  }, [folders, selectedFolder]);

  const runMutation = useCallback(async (operation) => {
    setSaving(true);
    setError("");

    try {
      return await operation();
    } catch (mutationError) {
      console.error("Error actualizando Active Classroom:", mutationError);
      setError(mutationError?.message || "No se pudo guardar el cambio.");
      throw mutationError;
    } finally {
      setSaving(false);
    }
  }, []);

  const createUnit = useCallback((name) => {
    if (selectedFolder?.kind !== "level") {
      return Promise.reject(new Error("Abre un Nivel antes de crear una Unit."));
    }

    const siblingUnits = folders.filter((folder) => folder.parentId === selectedFolder.id);
    const normalizedName = name.trim().toLocaleLowerCase("es");

    if (siblingUnits.some((folder) => folder.name.trim().toLocaleLowerCase("es") === normalizedName)) {
      return Promise.reject(new Error("Ya existe una Unit con ese nombre en este Nivel."));
    }

    return runMutation(() => createActiveClassroomUnit({
      parentId: selectedFolder.id,
      name,
      position: siblingUnits.length + 1,
    }, profile));
  }, [folders, profile, runMutation, selectedFolder]);

  const renameUnit = useCallback((folderId, name) => runMutation(
    () => renameActiveClassroomUnit(folderId, name, profile)
  ), [profile, runMutation]);

  const removeUnit = useCallback((folderId) => runMutation(
    () => deleteActiveClassroomUnit(folderId, profile)
  ), [profile, runMutation]);

  const uploadFiles = useCallback((files) => {
    if (selectedFolder?.kind !== "unit") {
      return Promise.reject(new Error("Abre una Unit antes de subir archivos."));
    }

    return runMutation(() => uploadActiveClassroomResources(files, selectedFolder.id, profile));
  }, [profile, runMutation, selectedFolder]);

  const togglePublished = useCallback((resource) => runMutation(
    () => setActiveClassroomResourcePublished(resource.id, !resource.published, profile)
  ), [profile, runMutation]);

  const removeResource = useCallback((resource) => runMutation(
    () => deleteActiveClassroomResource(resource, profile)
  ), [profile, runMutation]);

  const getVisibleItems = useCallback(({ searchTerm, typeFilter, statusFilter, sortMode }) => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase("es");
    const parentId = selectedFolderId === "root" ? null : selectedFolderId;
    const visibleFolders = typeFilter === "all" && statusFilter === "all"
      ? folders.filter((folder) => (
        folder.parentId === parentId &&
        (!normalizedSearch || folder.name.toLocaleLowerCase("es").includes(normalizedSearch))
      )).sort(sortFolders)
      : [];
    const visibleResources = resources
      .filter((resource) => resource.folderId === selectedFolderId)
      .filter((resource) => !normalizedSearch || resource.name.toLocaleLowerCase("es").includes(normalizedSearch))
      .filter((resource) => {
        if (typeFilter === "all") return true;
        if (typeFilter === "pdf") return getFileExtension(resource.name) === "pdf";
        return resource.kind === typeFilter;
      })
      .filter((resource) => (
        statusFilter === "all" ||
        (statusFilter === "published" ? resource.published : !resource.published)
      ))
      .sort((a, b) => {
        if (sortMode === "date") {
          const firstDate = a.updatedAt?.toMillis?.() || 0;
          const secondDate = b.updatedAt?.toMillis?.() || 0;
          return secondDate - firstDate;
        }

        return a.name.localeCompare(b.name, "es");
      });

    return { folders: visibleFolders, resources: visibleResources };
  }, [folders, resources, selectedFolderId]);

  function openFolder(folderId) {
    setSelectedFolderId(folderId || "root");
    setSelectedResourceId("");
  }

  return {
    folders: canManage ? folders : [],
    resources: canManage ? resources : [],
    selectedFolder,
    selectedFolderId,
    selectedResource,
    selectedResourceId,
    breadcrumbs,
    loading: canManage ? loading : false,
    saving,
    error: canManage
      ? error
      : profileUid
        ? "Tu perfil no tiene permisos para administrar Active Classroom."
        : "Esperando sesión y perfil de usuario.",
    setError,
    openFolder,
    setSelectedResourceId,
    getVisibleItems,
    createUnit,
    renameUnit,
    removeUnit,
    uploadFiles,
    togglePublished,
    removeResource,
  };
}
