import { useEffect, useMemo, useState } from "react";
import { subscribeEditorialProjects } from "../services/editorialProjectsService";

export function useEditorialProjects({ profile, isAdmin, filter, search }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeEditorialProjects({
      user: profile,
      isAdmin,
      onChange: (items) => {
        setProjects(items);
        setError("");
        setLoading(false);
      },
      onError: (subscriptionError) => {
        setError(subscriptionError.message || "No fue posible cargar los proyectos.");
        setLoading(false);
      },
    });

    return unsubscribe;
  }, [profile, isAdmin]);

  const visibleProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("es-MX");

    return projects.filter((project) => {
      const matchesFilter = filter === "all" ||
        (filter === "archived" ? project.archived === true : project.archived !== true);
      const matchesSearch = !normalizedSearch ||
        project.name?.toLocaleLowerCase("es-MX").includes(normalizedSearch);
      return matchesFilter && matchesSearch;
    });
  }, [projects, filter, search]);

  return { projects, visibleProjects, loading, error };
}
