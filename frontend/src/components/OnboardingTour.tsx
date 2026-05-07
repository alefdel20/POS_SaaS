import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useAuth } from "../context/AuthContext";
import { getTutorialSteps, type TutorialStep } from "../utils/tutorialSteps";

export type OnboardingTourHandle = {
  startTour: () => Promise<void>;
};

type OnboardingTourProps = {
  autoStart: boolean;
};

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function openSidebar(): Promise<void> {
  return new Promise((resolve) => {
    const sidebar = document.getElementById("app-sidebar");
    if (sidebar && !sidebar.classList.contains("open")) {
      const toggle = document.querySelector<HTMLButtonElement>(".menu-toggle");
      toggle?.click();
    }
    setTimeout(resolve, 400);
  });
}

function closeSidebar() {
  const sidebar = document.getElementById("app-sidebar");
  if (sidebar?.classList.contains("open")) {
    const toggle = document.querySelector<HTMLButtonElement>(".menu-toggle");
    toggle?.click();
  }
}

function expandProductsMenu(): Promise<void> {
  return new Promise((resolve) => {
    const sidebar = document.getElementById("app-sidebar");
    if (sidebar) {
      const explicit = sidebar.querySelector<HTMLButtonElement>('[data-tour-expand="productos"]');
      if (explicit && explicit.getAttribute("aria-expanded") === "false") {
        explicit.click();
      } else if (!explicit) {
        // Fallback for pos types where the products group has a different label
        sidebar.querySelectorAll<HTMLButtonElement>('.nav-tree-toggle[aria-expanded="false"]')
          .forEach((t) => t.click());
      }
    }
    setTimeout(resolve, 350);
  });
}

async function syncSidebarForStep(stepIndex: number, steps: TutorialStep[]) {
  const step = steps[stepIndex];
  if (!step) return;
  if (step.requiresSidebar) {
    await openSidebar();
    if (step.element === '[data-tour="nav-products"]') {
      await expandProductsMenu();
    }
  } else {
    closeSidebar();
    await delay(200);
  }
}

export const OnboardingTour = forwardRef<OnboardingTourHandle, OnboardingTourProps>(
  function OnboardingTour({ autoStart }, ref) {
    const { user, markTutorialSeen } = useAuth();
    const driverRef = useRef<ReturnType<typeof driver> | null>(null);

    function buildDriver(posType: string, hasBranch: boolean) {
      const steps = getTutorialSteps(posType, hasBranch);

      return driver({
        showProgress: true,
        progressText: "Paso {{current}} de {{total}}",
        nextBtnText: "Siguiente",
        prevBtnText: "Anterior",
        doneBtnText: "¡Listo!",
        smoothScroll: true,
        steps: steps.map((step) => ({
          element: step.element,
          popover: step.popover
        } as DriveStep)),
        onHighlightStarted: () => {
          const idx = driverRef.current?.getActiveIndex() ?? 0;
          syncSidebarForStep(idx, steps).catch(() => {});
        },
        onDestroyStarted: () => {
          markTutorialSeen().catch(() => {});
          driverRef.current?.destroy();
          closeSidebar();
        }
      });
    }

    async function startTour() {
      if (driverRef.current) {
        driverRef.current.destroy();
      }
      const posType = user?.pos_type ?? "";
      const hasBranch = Boolean(user?.branch_id);
      const d = buildDriver(posType, hasBranch);
      driverRef.current = d;
      const steps = getTutorialSteps(posType, hasBranch);
      await syncSidebarForStep(0, steps);
      d.drive();
    }

    useImperativeHandle(ref, () => ({ startTour }));

    useEffect(() => {
      if (!autoStart) return;

      const timer = setTimeout(() => {
        startTour().catch(() => {});
      }, 800);

      return () => {
        clearTimeout(timer);
        driverRef.current?.destroy();
        closeSidebar();
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoStart]);

    return null;
  }
);
