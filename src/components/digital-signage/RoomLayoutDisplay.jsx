import { useMemo } from "react";
import {
  formatRoomClassTime,
  getRoomDayLabel,
  DEFAULT_ROOM_TEMPLATE,
} from "../../utils/digitalSignage/roomLayouts";

function fitTextSize(text, requested, width, height) {
  const count = Math.max(1, Array.from(String(text || "")).length);
  // Estimate area before paint; wrapping handles unusually wide names and words.
  return Math.min(requested, Math.max(8, Math.sqrt((width * height) / (count * 0.65 * 1.2))));
}

const FALLBACK_WEEKDAY_NAMES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

export default function RoomLayoutDisplay({
  layout,
  template,
  nowMillis = 0,
  className = "",
}) {
  const activeTemplate = useMemo(() => {
    if (template && typeof template === "object") return template;
    if (layout?.template && typeof layout.template === "object") return layout.template;
    return (
      DEFAULT_ROOM_TEMPLATE || {
        version: 1,
        backgroundColor: "#0b3265",
        backgroundUrl: "",
        columns: 2,
        rows: 4,
        elements: [],
      }
    );
  }, [template, layout?.template]);

  const activeAssignments = useMemo(() => {
    const list = Array.isArray(layout?.assignments) ? layout.assignments : [];
    return list.filter((item) => item && item.active !== false);
  }, [layout]);

  const formattedTime = useMemo(() => {
    if (typeof formatRoomClassTime === "function") {
      try {
        const result = formatRoomClassTime(layout);
        if (result) return result;
      } catch {
        // fallback to standard format
      }
    }
    if (!layout) return "";
    if (layout.classStart && layout.classEnd) return `${layout.classStart} – ${layout.classEnd}`;
    return layout.classStart || layout.classEnd || "";
  }, [layout]);

  const formattedDay = useMemo(() => {
    if (typeof getRoomDayLabel === "function") {
      try {
        const result = getRoomDayLabel(layout?.classDays);
        if (result) return result;
      } catch {
        // fallback to standard format
      }
    }
    if (!Array.isArray(layout?.classDays) || layout.classDays.length === 0) return "";
    return layout.classDays.map((d) => FALLBACK_WEEKDAY_NAMES[d] || d).join(", ");
  }, [layout]);

  const columns = Math.max(1, activeTemplate.columns || 2);
  const rows = Math.max(1, activeTemplate.rows || 4);
  const pageSize = columns * rows;
  const totalPages = Math.max(1, Math.ceil(activeAssignments.length / pageSize));
  const pageIndex =
    totalPages > 1 && nowMillis > 0
      ? Math.floor(nowMillis / 10000) % totalPages
      : 0;
  const pagedAssignments = activeAssignments.slice(
    pageIndex * pageSize,
    (pageIndex + 1) * pageSize
  );

  const elements = Array.isArray(activeTemplate.elements) ? activeTemplate.elements : [];

  function getFieldValue(field, rowIndex = 0) {
    switch (field) {
      case "plantel":
        return layout?.plantel || "";
      case "day":
        return formattedDay;
      case "classTime":
        return formattedTime;
      case "room":
        return activeAssignments[rowIndex]?.roomName || "";
      case "teacher":
        return activeAssignments[rowIndex]?.teacher || "";
      case "group":
        return activeAssignments[rowIndex]?.group || "";
      default:
        return "";
    }
  }

  return (
    <div className={`signage-room-display-wrapper ${className}`.trim()}>
      <div
        className="signage-room-display-canvas"
        style={{
          backgroundColor: activeTemplate.backgroundColor || "#0b3265",
          backgroundImage: activeTemplate.backgroundUrl ? `url(${activeTemplate.backgroundUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {elements.map((el, elIndex) => {
          const key = el.id || `el-${elIndex}`;
          const style = {
            position: "absolute",
            left: `${el.x ?? 0}%`,
            top: `${el.y ?? 0}%`,
            width: `${el.width ?? 10}%`,
            height: `${el.height ?? 10}%`,
            fontSize: `calc(${el.fontSize || 32} * 100cqi / 1600)`,
            color: el.color || "#ffffff",
            backgroundColor: el.backgroundColor || "transparent",
            textAlign: el.align || "left",
            zIndex: elIndex + 1,
          };

          if (el.type === "rect") {
            return (
              <div
                key={key}
                className="signage-room-display-element signage-room-display-rect"
                style={{
                  ...style,
                  borderRadius: "calc(10 * 100cqi / 1600)",
                }}
              />
            );
          }

          if (el.type === "image") {
            return (
              <div
                key={key}
                className="signage-room-display-element signage-room-display-image-wrap"
                style={style}
              >
                <img
                  src={el.url || "/active-logo.png"}
                  alt=""
                  loading="eager"
                  className="signage-room-display-img"
                />
              </div>
            );
          }

          if (el.type === "field") {
            const val = getFieldValue(el.field, el.rowIndex || 0);
            return (
              <div
                key={key}
                className="signage-room-display-element signage-room-display-field"
                style={style}
              >
                <span className="signage-room-display-text-content" style={{ fontSize: `calc(${fitTextSize(val, el.fontSize || 32, (el.width || 10) * 16, (el.height || 10) * 9)} * 100cqi / 1600)` }}>{val}</span>
              </div>
            );
          }

          if (el.type === "text") {
            return (
              <div
                key={key}
                className="signage-room-display-element signage-room-display-text"
                style={style}
              >
                <span className="signage-room-display-text-content" style={{ fontSize: `calc(${fitTextSize(el.text, el.fontSize || 32, (el.width || 10) * 16, (el.height || 10) * 9)} * 100cqi / 1600)` }}>{el.text || ""}</span>
              </div>
            );
          }

          if (el.type === "assignments") {
            const baseFontSize = el.fontSize || 32;
            const cardBg =
              el.backgroundColor && el.backgroundColor !== "transparent"
                ? el.backgroundColor
                : "rgba(255, 255, 255, 0.12)";
            const cardTextColor = el.color || "#ffffff";

            return (
              <div
                key={key}
                className="signage-room-display-element signage-room-display-assignments"
                style={{
                  ...style,
                  backgroundColor: "transparent",
                }}
              >
                <div
                  className="signage-room-display-cards-grid"
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                  }}
                >
                  {pagedAssignments.map((assignment, aIndex) => {
                    const cardWidth = (el.width || 88) * 16 / columns - 28;
                    const cardHeight = (el.height || 68) * 9 / rows - 20;
                    const roomFont = fitTextSize(assignment.roomName, baseFontSize * 0.72, cardWidth, cardHeight * 0.25);
                    const teacherFont = fitTextSize(assignment.teacher || "Sin maestro", baseFontSize, cardWidth, cardHeight * (assignment.group ? 0.48 : 0.7));
                    const groupFont = fitTextSize(assignment.group, baseFontSize * 0.65, cardWidth, cardHeight * 0.22);
                    return (
                    <div
                      key={assignment.id || `asg-${aIndex}`}
                      className="signage-room-display-card"
                      style={{
                        backgroundColor: cardBg,
                      }}
                    >
                      <div
                        className="signage-room-display-card-room"
                        style={{
                          fontSize: `calc(${roomFont} * 100cqi / 1600)`,
                        }}
                      >
                        {assignment.roomName || `Salón ${aIndex + 1}`}
                      </div>
                      <div className="signage-room-display-card-body">
                        <div
                          className="signage-room-display-card-teacher"
                          style={{
                            fontSize: `calc(${teacherFont} * 100cqi / 1600)`,
                            color: cardTextColor,
                          }}
                        >
                          {assignment.teacher || "Sin maestro"}
                        </div>
                        {assignment.group && (
                          <div
                            className="signage-room-display-card-group"
                            style={{
                              fontSize: `calc(${groupFont} * 100cqi / 1600)`,
                            }}
                          >
                            {assignment.group}
                          </div>
                        )}
                      </div>
                    </div>
                  ); })}
                </div>
              </div>
            );
          }

          return null;
        })}

        {totalPages > 1 && (
          <div className="signage-room-display-page-indicator">
            Pág. {pageIndex + 1} / {totalPages}
          </div>
        )}
      </div>
    </div>
  );
}
