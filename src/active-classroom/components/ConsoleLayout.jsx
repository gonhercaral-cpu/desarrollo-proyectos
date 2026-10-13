import { useEffect, useRef } from "react";
import ActiveClassroomIcon from "./ActiveClassroomIcon";
import ModuleHeader from "../../components/ModuleHeader";
export function ClassroomHeader({ title, subtitle, children }) {
  return <ModuleHeader icon={<img className="ac-institutional-icon" src="/active-classroom-icon.png" alt="Active Classroom" />} kicker="Active Classroom" title={title} subtitle={subtitle}>{children}</ModuleHeader>;
}
export function ClassroomMetrics({ items }) {
  return <div className="ac-console-metrics">{items.map(({ title, value, detail, icon = "folder", tone = "blue" }) => <article key={title}><span className={`ac-metric-icon is-${tone}`}><ActiveClassroomIcon name={icon} size={30} /></span><div><strong>{title}</strong><b>{value}</b><small>{detail}</small></div></article>)}</div>;
}
export function ClassroomInspector({ title = "Inspector", children }) {
  const host = useRef(null);
  useEffect(() => {
    const schedule = window.requestAnimationFrame?.bind(window) || (callback => window.setTimeout(callback, 0)); const cancel = window.cancelAnimationFrame?.bind(window) || window.clearTimeout.bind(window);
    let frame; const adjust = () => { cancel(frame); frame = schedule(() => { if (!host.current) return; const available = Math.max(140, window.innerHeight - Math.max(18, host.current.getBoundingClientRect().top) - 20); host.current.style.setProperty("--ac-inspector-available", `${available}px`); }); };
    adjust(); window.addEventListener("resize", adjust); window.addEventListener("scroll", adjust, true);
    return () => { cancel(frame); window.removeEventListener("resize", adjust); window.removeEventListener("scroll", adjust, true); };
  }, []);
  return <aside ref={host} className="ac-console-inspector"><header><h2>{title}</h2><ActiveClassroomIcon name="info" /></header>{children}</aside>; }
