import {
  ACTIVE_CLASSROOM_FUTURE_SECTIONS,
  ACTIVE_CLASSROOM_SECTIONS,
} from "../constants";
import ActiveClassroomIcon from "./ActiveClassroomIcon";

export default function ActiveClassroomNavigation({ activeSection, onChange }) {
  return (
    <nav className="ac-navigation" aria-label="Navegación de Active Classroom">
      <div className="ac-navigation-scroll">
        {ACTIVE_CLASSROOM_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={activeSection === section.id ? "is-active" : ""}
            onClick={() => onChange(section.id)}
          >
            <ActiveClassroomIcon name={section.icon} />
            <span>{section.label}</span>
          </button>
        ))}

        <span className="ac-navigation-divider" aria-hidden="true" />

        {ACTIVE_CLASSROOM_FUTURE_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`is-future ${activeSection === section.id ? "is-active" : ""}`}
            onClick={() => onChange(section.id)}
          >
            <ActiveClassroomIcon name={section.icon} />
            <span>{section.label}</span>
            <small>Próx.</small>
          </button>
        ))}
      </div>
    </nav>
  );
}
