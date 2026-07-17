import { useEffect, useMemo, useState } from "react";
import { subscribeEditorialProjects } from "../services/editorialProjectsService";

export function useEditorialProjects({ profile, isAdmin, filter, search, academicFilters = {} }) {
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
      const searchable = [project.name, project.seriesName, project.levelName, project.bookName, project.unitTitle, project.lessonTitle].filter(Boolean).join(" ").toLocaleLowerCase("es-MX");
      const matchesSearch = !normalizedSearch || searchable.includes(normalizedSearch);
      const matchesAcademicType = !academicFilters.academicType || project.academicType === academicFilters.academicType;
      const matchesSeries = !academicFilters.seriesId || project.seriesId === academicFilters.seriesId;
      const matchesLevel = !academicFilters.levelId || project.levelId === academicFilters.levelId;
      return matchesFilter && matchesSearch && matchesAcademicType && matchesSeries && matchesLevel;
    });
  }, [academicFilters.academicType, academicFilters.levelId, academicFilters.seriesId, projects, filter, search]);

  return { projects, visibleProjects, loading, error };
}
