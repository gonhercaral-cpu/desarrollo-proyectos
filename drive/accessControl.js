function isPrivateRootMetadata(metadata) {
  return Boolean(
    metadata &&
    metadata.isRoot === true &&
    metadata.visibility !== "inherited" &&
    (metadata.ownerUid || metadata.createdByUid)
  );
}

async function resolveFolderAccess({
  drive,
  folderId,
  allowedRootIds,
  getPrivateMetadata,
  maxDepth = 30,
}) {
  const allowed = new Set((allowedRootIds || []).filter(Boolean));
  const pending = [folderId];
  const visited = new Set();
  let depth = 0;
  let privacyRootId = null;
  let ownerUid = null;
  let ownerName = null;
  let matchedRootId = "";
  const matchedRootIds = [];

  while (pending.length > 0 && depth < maxDepth) {
    const currentId = pending.shift();

    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    depth += 1;

    if (privacyRootId === null) {
      const metadata = (await getPrivateMetadata(currentId)) || {};

      if (isPrivateRootMetadata(metadata)) {
        privacyRootId = currentId;
        ownerUid = metadata.ownerUid || metadata.createdByUid || null;
        ownerName = metadata.ownerName || metadata.createdByName || null;
      }
    }

    if (!matchedRootId && allowed.has(currentId)) {
      matchedRootId = currentId;
    }
    if (allowed.has(currentId)) {
      matchedRootIds.push(currentId);
    }

    try {
      const response = await drive.files.get({
        fileId: currentId,
        fields: "id,parents",
        supportsAllDrives: true,
      });
      const parents = Array.isArray(response.data.parents) ? response.data.parents : [];
      pending.push(...parents);
    } catch {
      // Un ancestro inaccesible no invalida otra ruta ya comprobada.
    }
  }

  return {
    insideAllowedRoot: Boolean(matchedRootId),
    privacyRootId,
    ownerUid,
    ownerName,
    matchedRootId,
    matchedRootIds,
  };
}

function evaluateResolvedAccess({ access, uid, shareRole = null, requireWrite = true }) {
  if (!access?.insideAllowedRoot) {
    return { allowed: false, reason: "outside-allowed-root" };
  }

  const belongsToAnotherPrivateRoot = Boolean(
    access.privacyRootId && access.ownerUid !== uid
  );

  if (belongsToAnotherPrivateRoot && !shareRole) {
    return { allowed: false, reason: "private" };
  }

  if (shareRole && requireWrite && shareRole !== "editor") {
    return { allowed: false, reason: "read-only-share" };
  }

  return { allowed: true, reason: "allowed" };
}

function hasNonShareLocationGrant(access, nonShareRootIds = []) {
  const nonShareRoots = new Set(nonShareRootIds);
  return (access?.matchedRootIds || []).some((rootId) => nonShareRoots.has(rootId));
}

module.exports = {
  evaluateResolvedAccess,
  hasNonShareLocationGrant,
  isPrivateRootMetadata,
  resolveFolderAccess,
};
