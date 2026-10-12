import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../services/firebase";
import { canClassroom } from "../utils/permissions";
const emptyPermissions = Object.freeze({});
export default function useClassroomPermissions(profile) {
  const uid = profile?.uid || profile?.id;
  const [grant, setGrant] = useState({ uid: "", permissions: {} });
  useEffect(() => {
    if (!uid || profile?.active !== true || profile?.role === "admin") return undefined;
    return onSnapshot(doc(db, "activeClassroomPermissions", uid), snapshot => setGrant({ uid, permissions: snapshot.data()?.permissions || {} }), () => setGrant({ uid, permissions: {} }));
  }, [uid, profile?.active, profile?.role]);
  const resolved = profile?.role === "admin" || grant.uid === uid;
  const current = { ...profile, activeClassroomPermissions: grant.uid === uid ? grant.permissions : emptyPermissions };
  return { profile: current, canAccess: resolved ? canClassroom(current) : undefined };
}
