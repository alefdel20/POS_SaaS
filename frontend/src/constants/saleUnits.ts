export const SALE_UNITS = ["pieza", "kg", "litro", "caja", "metro", "pliego", "hoja"] as const;
export type SaleUnit = typeof SALE_UNITS[number];

export const INTEGER_UNITS = new Set<string>(["pieza", "caja", "pliego", "hoja"]);

export function isIntegerUnit(unit?: string | null): boolean {
  return INTEGER_UNITS.has(unit || "");
}

export const SUB_UNIT_CONVERSIONS: Record<string, { unit: string; factor: number }[]> = {
  metro: [
    { unit: "cm", factor: 100 },
    { unit: "mm", factor: 1000 }
  ],
  kg: [
    { unit: "gramo", factor: 1000 }
  ],
  litro: [
    { unit: "ml", factor: 1000 }
  ]
};

export function getSubUnitsForBaseUnit(baseUnit: string): { unit: string; factor: number }[] {
  return SUB_UNIT_CONVERSIONS[baseUnit] || [];
}
