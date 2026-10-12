import { ACTIVE_CLASSROOM_SECTIONS } from "../constants";
import ActiveClassroomIcon from "./ActiveClassroomIcon";
export default function ActiveClassroomNavigation({ activeSection, onChange, canManageDevices = true }) {
  return <nav className="ac-navigation" aria-label="Navegación de Active Classroom"><div className="ac-navigation-scroll">{ACTIVE_CLASSROOM_SECTIONS.filter(section => section.id !== "teams" || canManageDevices).map(section => <button key={section.id} type="button" className={activeSection === section.id ? "is-active" : ""} onClick={() => onChange(section.id)}><ActiveClassroomIcon name={section.icon} /><span>{section.label}</span></button>)}</div></nav>;
}
