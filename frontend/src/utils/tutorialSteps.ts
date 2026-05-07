export type TutorialStep = {
  element: string;
  popover: { title: string; description: string; side?: string };
};

const RETAIL_POS_TYPES = new Set(["Tienda", "Tlapaleria", "Papeleria", "Otro"]);
const SALUD_POS_TYPES = new Set(["Veterinaria", "Dentista", "FarmaciaConsultorio", "ClinicaChica"]);
const RESTAURANTE_POS_TYPES = new Set(["Restaurante"]);

const commonSteps: TutorialStep[] = [
  {
    element: '[data-tour="sidebar"]',
    popover: { title: "Navegación principal", description: "Aquí encuentras todos los módulos de tu negocio.", side: "right" }
  },
  {
    element: '[data-tour="user-menu"]',
    popover: { title: "Tu perfil", description: "Configura tu cuenta, tema visual y preferencias.", side: "bottom" }
  },
  {
    element: '[data-tour="branch-selector"]',
    popover: { title: "Sucursal activa", description: "Siempre verás en qué sucursal estás operando.", side: "bottom" }
  }
];

const retailSteps: TutorialStep[] = [
  {
    element: '[data-tour="nav-sales"]',
    popover: { title: "Punto de Venta", description: "Registra ventas rápido con búsqueda por producto o código.", side: "right" }
  },
  {
    element: '[data-tour="nav-products"]',
    popover: { title: "Inventario", description: "Gestiona productos, precios y existencias.", side: "right" }
  },
  {
    element: '[data-tour="nav-finances"]',
    popover: { title: "Finanzas", description: "Revisa ingresos, egresos y el corte del día.", side: "right" }
  }
];

const saludSteps: TutorialStep[] = [
  {
    element: '[data-tour="nav-patients"]',
    popover: { title: "Pacientes", description: "Registra y consulta el historial clínico de tus pacientes.", side: "right" }
  },
  {
    element: '[data-tour="nav-appointments"]',
    popover: { title: "Citas", description: "Agenda y administra tus consultas del día.", side: "right" }
  },
  {
    element: '[data-tour="nav-sales"]',
    popover: { title: "Cobros", description: "Genera cobros asociados a cada consulta.", side: "right" }
  }
];

const farmaciaSteps: TutorialStep[] = [
  {
    element: '[data-tour="nav-sales"]',
    popover: { title: "Punto de Venta", description: "Registra ventas rápido con búsqueda por producto o código.", side: "right" }
  },
  {
    element: '[data-tour="nav-products"]',
    popover: { title: "Inventario", description: "Gestiona productos, precios y existencias.", side: "right" }
  },
  {
    element: '[data-tour="nav-finances"]',
    popover: { title: "Finanzas", description: "Revisa ingresos, egresos y el corte del día.", side: "right" }
  }
];

const restauranteSteps: TutorialStep[] = [
  {
    element: '[data-tour="nav-restaurant-map"]',
    popover: { title: "Mapa de Mesas", description: "Visualiza y gestiona las mesas de tu restaurante.", side: "right" }
  },
  {
    element: '[data-tour="nav-restaurant-orders"]',
    popover: { title: "Órdenes", description: "Toma y envía órdenes a cocina en tiempo real.", side: "right" }
  },
  {
    element: '[data-tour="nav-daily-cut"]',
    popover: { title: "Corte del Día", description: "Cierra la caja y revisa el resumen del día.", side: "right" }
  }
];

export function getTutorialSteps(posType?: string): TutorialStep[] {
  let groupSteps: TutorialStep[];

  if (posType && SALUD_POS_TYPES.has(posType)) {
    groupSteps = saludSteps;
  } else if (posType && RESTAURANTE_POS_TYPES.has(posType)) {
    groupSteps = restauranteSteps;
  } else if (posType === "Farmacia") {
    groupSteps = farmaciaSteps;
  } else if (!posType || RETAIL_POS_TYPES.has(posType)) {
    groupSteps = retailSteps;
  } else {
    groupSteps = retailSteps;
  }

  return [...commonSteps, ...groupSteps];
}
