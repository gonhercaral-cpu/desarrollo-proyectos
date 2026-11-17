export class TeacherWorkspace {
  private root: HTMLElement;
  private clockEl: HTMLElement | null = null;
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private timeFormatter: Intl.DateTimeFormat;
  private tablist: HTMLElement | null = null;
  private tabs: HTMLButtonElement[] = [];
  private panels: HTMLElement[] = [];
  private activeIndex: number = 0;
  private boundKeyDown: (event: KeyboardEvent) => void;
  private boundTabClick: (event: MouseEvent) => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.timeFormatter = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });

    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundTabClick = this.handleTabClick.bind(this);

    this.initClock();
    this.initTabs();
  }

  private initClock(): void {
    this.clockEl = this.root.querySelector<HTMLElement>("[data-teacher-clock]");
    if (!this.clockEl) return;

    this.updateClock();
    this.scheduleNextMinute();
  }

  private updateClock(): void {
    if (this.clockEl) {
      this.clockEl.textContent = this.timeFormatter.format(new Date());
    }
  }

  private scheduleNextMinute(): void {
    if (this.clockTimer !== null) {
      clearTimeout(this.clockTimer);
      this.clockTimer = null;
    }
    const now = new Date();
    const delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
    this.clockTimer = setTimeout(() => {
      this.updateClock();
      this.scheduleNextMinute();
    }, Math.max(50, delay));
  }

  private initTabs(): void {
    this.tablist = this.root.querySelector<HTMLElement>('[role="tablist"]');
    this.tabs = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    this.panels = Array.from(this.root.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
    if (!this.tabs.length) return;
    const selectedIdx = this.tabs.findIndex(tab => tab.getAttribute("aria-selected") === "true");
    this.activeIndex = selectedIdx >= 0 ? selectedIdx : 0;
    this.applyTabState(false);

    if (this.tablist) {
      this.tablist.addEventListener("keydown", this.boundKeyDown);
      this.tablist.addEventListener("click", this.boundTabClick);
    } else {
      this.tabs.forEach((tab) => {
        tab.addEventListener("keydown", this.boundKeyDown);
        tab.addEventListener("click", this.boundTabClick);
      });
    }
  }

  private handleTabClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement)?.closest?.('[role="tab"]') as HTMLButtonElement | null;
    if (!target) return;
    const index = this.tabs.indexOf(target);
    if (index !== -1) {
      this.selectTab(index, false);
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const target = (event.target as HTMLElement)?.closest?.('[role="tab"]') as HTMLButtonElement | null;
    if (!target) return;
    const index = this.tabs.indexOf(target);
    if (index === -1) return;

    let targetIdx: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        targetIdx = (index + 1) % this.tabs.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        targetIdx = (index - 1 + this.tabs.length) % this.tabs.length;
        break;
      case "Home":
        targetIdx = 0;
        break;
      case "End":
        targetIdx = this.tabs.length - 1;
        break;
      case "Enter":
      case " ":
        targetIdx = index;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (targetIdx !== null) {
      this.selectTab(targetIdx, true);
    }
  }

  public selectTab(index: number, focus: boolean = false): void {
    if (index < 0 || index >= this.tabs.length) return;
    this.activeIndex = index;
    this.applyTabState(focus);
  }

  public getActiveTabIndex(): number {
    return this.activeIndex;
  }

  private applyTabState(focus: boolean): void {
    const activeTab = this.tabs[this.activeIndex];
    const controlsId = activeTab?.getAttribute("aria-controls");

    this.tabs.forEach((tab, i) => {
      const isSelected = i === this.activeIndex;
      tab.setAttribute("aria-selected", isSelected ? "true" : "false");
      tab.tabIndex = isSelected ? 0 : -1;
      tab.classList.toggle("is-active", isSelected);
    });

    this.panels.forEach((panel, i) => {
      const isMatch = controlsId ? panel.id === controlsId : i === this.activeIndex;
      if (isMatch) {
        panel.removeAttribute("hidden");
        panel.classList.add("is-active");
      } else {
        panel.setAttribute("hidden", "");
        panel.classList.remove("is-active");
      }
    });

    if (focus && activeTab) {
      activeTab.focus();
    }
  }

  public destroy(): void {
    if (this.clockTimer !== null) {
      clearTimeout(this.clockTimer);
      this.clockTimer = null;
    }

    if (this.tablist) {
      this.tablist.removeEventListener("keydown", this.boundKeyDown);
      this.tablist.removeEventListener("click", this.boundTabClick);
    } else {
      this.tabs.forEach((tab) => {
        tab.removeEventListener("keydown", this.boundKeyDown);
        tab.removeEventListener("click", this.boundTabClick);
      });
    }
  }
}
