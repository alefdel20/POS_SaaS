import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useAuth } from "../context/AuthContext";
import { getTutorialSteps } from "../utils/tutorialSteps";

export type OnboardingTourHandle = {
  startTour: () => void;
};

type OnboardingTourProps = {
  autoStart: boolean;
};

export const OnboardingTour = forwardRef<OnboardingTourHandle, OnboardingTourProps>(
  function OnboardingTour({ autoStart }, ref) {
    const { user, markTutorialSeen } = useAuth();
    const driverRef = useRef<ReturnType<typeof driver> | null>(null);

    function buildDriver() {
      const steps = getTutorialSteps(user?.pos_type);

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
        onDestroyStarted: () => {
          markTutorialSeen().catch(() => {});
          driverRef.current?.destroy();
        }
      });
    }

    function startTour() {
      if (driverRef.current) {
        driverRef.current.destroy();
      }
      const d = buildDriver();
      driverRef.current = d;
      d.drive();
    }

    useImperativeHandle(ref, () => ({ startTour }));

    useEffect(() => {
      if (!autoStart) return;

      const timer = setTimeout(() => {
        startTour();
      }, 800);

      return () => {
        clearTimeout(timer);
        driverRef.current?.destroy();
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoStart]);

    return null;
  }
);
