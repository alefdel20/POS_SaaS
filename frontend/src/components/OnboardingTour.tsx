import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useAuth } from "../context/AuthContext";
import { getTutorialSteps } from "../utils/tutorialSteps";

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

async function syncSidebarForStep(stepIndex: number, posType: string) {
  const steps = getTutorialSteps(posType);
  const step = steps[stepIndex];
  if (!step) return;
  if (step.requiresSidebar) {
    await openSidebar();
  } else {
    closeSidebar();
    await delay(200);
  }
}

export const OnboardingTour = forwardRef<OnboardingTourHandle, OnboardingTourProps>(
  function OnboardingTour({ autoStart }, ref) {
    const { user, markTutorialSeen } = useAuth();
    const driverRef = useRef<ReturnType<typeof driver> | null>(null);

    function buildDriver(posType: string) {
      const steps = getTutorialSteps(posType);

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
          syncSidebarForStep(idx, posType).catch(() => {});
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
      const d = buildDriver(posType);
      driverRef.current = d;
      await syncSidebarForStep(0, posType);
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
