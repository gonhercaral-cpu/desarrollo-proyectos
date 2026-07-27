import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function UserAvatar({
  user = null,
  profile = null,
  userId = "",
  email = "",
  name = "",
  photoURL,
  preview = "",
  alt = "",
}) {
  const { users = [] } = useAuth();
  const baseUser = user || profile;
  const directoryUser = findDirectoryUser(users, {
    userId: userId || baseUser?.uid || baseUser?.id,
    email: email || baseUser?.email,
    name: name || baseUser?.name,
  });
  const resolvedUser = {
    ...(baseUser || {}),
    ...(directoryUser || {}),
  };
  const displayName =
    name ||
    resolvedUser.name ||
    email ||
    resolvedUser.email ||
    "Usuario";
  const storedPhotoURL =
    photoURL === undefined ? resolvedUser.photoURL || "" : photoURL;
  const imageURL = preview || getVersionedPhotoURL(storedPhotoURL, resolvedUser);
  const [loadedURL, setLoadedURL] = useState("");
  const [failedURL, setFailedURL] = useState("");
  const showImage = Boolean(imageURL && failedURL !== imageURL);
  const imageLoaded = showImage && loadedURL === imageURL;

  return (
    <>
      {!imageLoaded && getInitials(displayName)}
      {showImage && (
        <img
          className="user-avatar-image"
          src={imageURL}
          alt={alt || `Foto de perfil de ${displayName}`}
          style={imageLoaded ? undefined : { display: "none" }}
          onLoad={() => setLoadedURL(imageURL)}
          onError={() => setFailedURL(imageURL)}
        />
      )}
    </>
  );
}

function getInitials(name = "") {
  const initials = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "U";
}

function findDirectoryUser(users, reference) {
  const userId = String(reference.userId || "").trim();

  if (userId) {
    const match = users.find(
      (candidate) => candidate.id === userId || candidate.uid === userId
    );

    if (match) return match;
  }

  const normalizedEmail = normalize(reference.email);

  if (normalizedEmail) {
    const match = users.find(
      (candidate) => normalize(candidate.email) === normalizedEmail
    );

    if (match) return match;
  }

  const normalizedName = normalize(reference.name);

  if (!normalizedName) return null;

  const matches = users.filter(
    (candidate) => normalize(candidate.name) === normalizedName
  );

  return matches.length === 1 ? matches[0] : null;
}

function getVersionedPhotoURL(photoURL, user) {
  if (!photoURL) return "";

  const version = getTimestampMillis(
    user?.profileUpdatedAt || user?.photoUpdatedAt
  );

  if (!version) return photoURL;

  try {
    const url = new URL(photoURL);
    url.searchParams.set("profileVersion", String(version));
    return url.toString();
  } catch {
    return photoURL;
  }
}

function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;

  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("es");
}
