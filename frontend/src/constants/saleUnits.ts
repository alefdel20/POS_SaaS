export const SALE_UNITS = ["pieza", "kg", "litro", "caja", "metro", "pliego", "hoja"] as const;
export type SaleUnit = typeof SALE_UNITS[number];

export const INTEGER_UNITS = new Set<string>(["pieza", "caja", "pliego", "hoja"]);

export function isIntegerUnit(unit?: string | null): boolean {
  return INTEGER_UNITS.has(unit || "");
}
