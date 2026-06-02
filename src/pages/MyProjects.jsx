import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { getProjectsAssignedTo } from "../services/projectsService";

export default function MyProjects({ onOpenProject }) {
  const { profile } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  async function loadProjects() {
    setLoading(true);

    try {
      const data = await getProjectsAssignedTo(profile.uid);
      setProjects(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  if (loading) {
    return <p>Cargando tus proyectos...</p>;
  }

  return (
    <div>
      <h2>Mis proyectos</h2>
      <p className="page-description">
        Aquí aparecen los proyectos que tienes asignados.
      </p>

      <div className="card">
        {projects.length === 0 ? (
          <p>No tienes proyectos asignados por ahora.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>Estado</th>
                <th>Prioridad</th>
                <th>Avance</th>
                <th>Fecha compromiso</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <strong>{project.title}</strong>
                    <span>{project.description}</span>
                  </td>
                  <td>{project.status}</td>
                  <td>{project.priority}</td>
                  <td>{project.progress}%</td>
                  <td>{project.deadline}</td>
                  <td>
                    <button onClick={() => onOpenProject(project.id)}>
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}