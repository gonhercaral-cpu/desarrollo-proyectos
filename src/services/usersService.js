import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "./firebase";

const USERS_COLLECTION = "users";

export async function getActiveUsers() {
  const usersRef = collection(db, USERS_COLLECTION);
  const q = query(
    usersRef,
    where("active", "==", true),
    orderBy("name", "asc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

export async function getCollaborators() {
  const users = await getActiveUsers();

  return users.filter((user) => user.role === "collaborator");
}