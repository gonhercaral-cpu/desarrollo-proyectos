import type { Manifest } from "../offline/manifest.ts";

export class PlayerController {
  manifest: Manifest;
  slideIndex: number | null = 0;
  presentationPage: number;
  selectedResourceId: string;
  resourcePages = new Map<string, number>();
  constructor(manifest: Manifest) {
    if (!manifest.slides?.length || !manifest.resources?.some((resource) => resource.resourceId === manifest.mainPresentationId)) throw new Error("Manifest inconsistente: faltan presentación o diapositivas.");
    if (!Array.isArray(manifest.generalResourceIds) || manifest.generalResourceIds.some((id) => !manifest.resources.some((resource) => resource.resourceId === id))) throw new Error("Manifest inconsistente: recurso general ausente.");
    manifest.slides.forEach((slide, index) => {
      const page = slide.metadata?.pageNumber;
      if (slide.index !== index || (page != null && (!Number.isInteger(page) || Number(page) < 1))) throw new Error("Manifest inconsistente: orden o página inválidos.");
      if (slide.resourceIds.some((id) => !manifest.resources.some((resource) => resource.resourceId === id))) throw new Error("Manifest inconsistente: recurso asociado ausente.");
      const presentationId = slide.metadata?.presentationResourceId;
      if (presentationId != null && !manifest.resources.some((resource) => resource.resourceId === presentationId)) throw new Error("Manifest inconsistente: imagen de diapositiva ausente.");
    });
    this.manifest = manifest;
    this.presentationPage = this.pageForSlide(0);
    this.selectedResourceId = this.presentationId;
  }
  get presentationId(): string { return String(this.slideIndex === null ? this.manifest.mainPresentationId : this.manifest.slides[this.slideIndex].metadata?.presentationResourceId || this.manifest.mainPresentationId); }
  get isPresentation(): boolean { return this.selectedResourceId === this.presentationId; }
  get associatedIds(): string[] { return this.slideIndex === null ? [] : this.manifest.slides[this.slideIndex].resourceIds; }
  get page(): number { return this.isPresentation ? this.presentationPage : this.resourcePages.get(this.selectedResourceId) || 1; }
  pageForSlide(index: number): number { return Number(this.manifest.slides[index].metadata?.pageNumber ?? index + 1); }
  goSlide(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.manifest.slides.length) return;
    this.slideIndex = index;
    this.presentationPage = this.pageForSlide(index);
    this.selectedResourceId = this.presentationId;
  }
  moveSlide(direction: number): void { this.goSlide(this.slideIndex === null ? 0 : this.slideIndex + direction); }
  selectResource(id: string): void {
    if (!this.manifest.resources.some((resource) => resource.resourceId === id)) throw new Error("El recurso no pertenece a esta Unit.");
    this.selectedResourceId = id;
  }
  returnToPresentation(): void { this.selectedResourceId = this.presentationId; }
  pageChanged(page: number): void {
    if (!Number.isInteger(page) || page < 1) return;
    if (this.isPresentation) {
      if (this.slideIndex !== null && this.manifest.slides[this.slideIndex].metadata?.presentationResourceId) return;
      this.presentationPage = page;
      const index = this.manifest.slides.findIndex((_slide, position) => this.pageForSlide(position) === page);
      this.slideIndex = index < 0 ? null : index;
    } else this.resourcePages.set(this.selectedResourceId, page);
  }
}
