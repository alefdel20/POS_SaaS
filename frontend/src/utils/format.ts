import { formatMexicoCityDate, formatMexicoCityDateTime } from "./timezone";

function parseDateValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  return new Date(value);
}

export function currency(value: number | string) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(Number(value || 0));
}

export function dateLabel(value: string | null) {
  if (!value) {
    return "Sin fecha";
  }
  return formatMexicoCityDate(parseDateValue(value));
}

export function shortDate(value: string | null) {
  if (!value) {
    return "-";
  }
  return formatMexicoCityDate(parseDateValue(value));
}

export function shortDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  return formatMexicoCityDateTime(parseDateValue(value));
}
