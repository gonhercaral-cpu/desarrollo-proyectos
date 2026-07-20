import { useMemo } from "react";
import { useEditorialComponents } from "./useEditorialComponents";
import { useEditorialMasterPages } from "./useEditorialMasterPages";
import { useEditorialStyles } from "./useEditorialStyles";
import { useEditorialTemplates } from "./useEditorialTemplates";
import { useEditorialVariables } from "./useEditorialVariables";
import { useEditorialFonts } from "./useEditorialFonts";

export function useEditorialDesignSystem({ project, documentId, user }) {
  const mastersState = useEditorialMasterPages({ project, documentId });
  const componentsState = useEditorialComponents(project.id);
  const stylesState = useEditorialStyles(project.id);
  const templatesState = useEditorialTemplates(project.id);
  const variablesState = useEditorialVariables(project.id);
  const fontsState = useEditorialFonts(project.id, user);
  const mastersById = useMemo(() => new Map(mastersState.masters.map((item) => [item.id, item])), [mastersState.masters]);
  const componentsById = useMemo(() => new Map(componentsState.components.map((item) => [item.id, item])), [componentsState.components]);
  const stylesById = useMemo(() => new Map(stylesState.styles.map((item) => [item.id, item])), [stylesState.styles]);
  return {
    masters: mastersState.masters,
    components: componentsState.components,
    styles: stylesState.styles,
    templates: templatesState.templates,
    variables: variablesState.variables,
    fonts: fontsState,
    mastersById,
    componentsById,
    stylesById,
    error: mastersState.error || componentsState.error || stylesState.error || templatesState.error || variablesState.error || fontsState.error,
  };
}
