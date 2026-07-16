import { useNavigate, useParams } from "react-router-dom";
import EditorialEditorShell from "./components/EditorialEditorShell";
import EditorialProjectsView from "./components/EditorialProjectsView";
import "./styles/editorial-base.css";
import "./styles/editorial-projects.css";
import "./styles/editorial-editor.css";
import "./styles/editorial-canvas.css";
import "./styles/editorial-responsive.css";
import "./styles/editorial-dark.css";

export default function EditorialModule({ profile, isAdmin, theme, onToggleTheme }) {
  const { projectId } = useParams();
  const navigate = useNavigate();

  if (projectId) {
    return (
      <EditorialEditorShell
        projectId={projectId}
        profile={profile}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onBack={() => navigate("/editorial")}
      />
    );
  }

  return (
    <EditorialProjectsView
      profile={profile}
      isAdmin={isAdmin}
      theme={theme}
      onToggleTheme={onToggleTheme}
      onOpenProject={(nextProjectId) => navigate(`/editorial/${nextProjectId}`)}
    />
  );
}
