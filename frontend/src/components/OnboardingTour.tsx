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
    if (!sidebar) { resolve(); return; }

    const toggle = sidebar.querySelector<HTMLButtonElement>(
      '[data-tour-expand="productos"]'
    );

    const target = sidebar.querySelector('[data-tour="nav-products"]');
    if (target) { resolve(); return; }

    if (toggle) toggle.click();

    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 50;
      const el = sidebar.querySelector('[data-tour="nav-products"]');
      if (el || elapsed >= 1000) {
        clearInterval(interval);
        setTimeout(resolve, 100);
      }
    }, 50);
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

    function teardownTour() {
      markTutorialSeen().catch(() => {});
      driverRef.current?.destroy();
      closeSidebar();
    }

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
        onNextClick: () => {
          const idx = driverRef.current?.getActiveIndex() ?? 0;
          const nextIdx = idx + 1;
          if (nextIdx >= steps.length) {
            teardownTour();
            return;
          }
          syncSidebarForStep(nextIdx, steps)
            .then(() => { driverRef.current?.moveNext(); })
            .catch(() => { driverRef.current?.moveNext(); });
        },
        onPrevClick: () => {
          const idx = driverRef.current?.getActiveIndex() ?? 0;
          const prevIdx = idx - 1;
          if (prevIdx < 0) return;
          syncSidebarForStep(prevIdx, steps)
            .then(() => { driverRef.current?.movePrevious(); })
            .catch(() => { driverRef.current?.movePrevious(); });
        },
        onDestroyStarted: () => {
          teardownTour();
        },
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
