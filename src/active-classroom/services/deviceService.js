import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

const callable = (name) => async (data = {}) => (await httpsCallable(functions, name)(data)).data;
export const deviceService = {
  list: callable("listActiveClassroomDevices"),
  approve: callable("approveActiveClassroomDevice"),
  reject: callable("rejectActiveClassroomDevice"),
  rename: callable("renameActiveClassroomDevice"),
  revoke: callable("revokeActiveClassroomDevice"),
};
