import { formatDateDMY, formatDateTimeLocalDMY, formatMexicoCityDate, formatMexicoCityDateTime, isIsoDate } from "./timezone";

function parseDateValue(value: string) {
  if (isIsoDate(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) {
    return new Date(value);
  }
  return null;
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
  const dateOnly = formatDateDMY(value);
  if (dateOnly) return dateOnly;
  const parsed = parseDateValue(value);
  return parsed ? formatMexicoCityDate(parsed) : "Sin fecha";
}

export function shortDate(value: string | null) {
  if (!value) {
    return "-";
  }
  const dateOnly = formatDateDMY(value);
  if (dateOnly) return dateOnly;
  const parsed = parseDateValue(value);
  return parsed ? formatMexicoCityDate(parsed) : "-";
}

export function shortDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const dateTimeLocal = formatDateTimeLocalDMY(value);
  if (dateTimeLocal) return dateTimeLocal;
  const parsed = parseDateValue(value);
  return parsed ? formatMexicoCityDateTime(parsed) : "-";
}
