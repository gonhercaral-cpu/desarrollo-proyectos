import { useEffect, useState } from "react";
import { getAllProjects } from "../services/projectsService";

export default function AllProjects({ onOpenProject }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  async function loadProjects() {
    setLoading(true);

    try {
      const data = await getAllProjects();
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
    return <p>Cargando proyectos...</p>;
  }

  return (
    <div>
      <h2>Todos los proyectos</h2>
      <p className="page-description">
        Vista administrativa de todos los proyectos registrados.
      </p>

      <div className="card">
        {projects.length === 0 ? (
          <p>No hay proyectos registrados todavía.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>Solicitante</th>
                <th>Responsable</th>
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
                  <td>
                    {project.requesterName}
                    <span>{project.requesterArea}</span>
                  </td>
                  <td>
                    {project.assignedToName}
                    <span>{project.responsibleArea}</span>
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