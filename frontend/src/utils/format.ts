import { formatDateDMY, formatDateTimeLocalDMY, parseDateDMY } from "./timezone";

const ISO_DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/;
const ISO_DATETIME_PREFIX_REGEX = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/;

function extractBusinessDate(value?: string | null) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;

  const prefixed = ISO_DATE_PREFIX_REGEX.exec(text);
  if (prefixed?.[1]) return prefixed[1];

  const parsedDmy = parseDateDMY(text);
  if (parsedDmy) return parsedDmy;

  return null;
}

export function normalizeDateInput(value?: string | null, fallback = "") {
  return extractBusinessDate(value) || fallback;
}

export function formatDate(dateString?: string | null) {
  const normalized = extractBusinessDate(dateString);
  if (!normalized) return "";
  return formatDateDMY(normalized) || "";
}

function formatDateTimePrefix(dateTimeString?: string | null) {
  if (!dateTimeString) return "";
  const text = String(dateTimeString).trim();
  const match = ISO_DATETIME_PREFIX_REGEX.exec(text);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
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
  return formatDate(value) || "Sin fecha";
}

export function shortDate(value: string | null) {
  if (!value) {
    return "-";
  }
  return formatDate(value) || "-";
}

export function shortDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const dateTimeLocal = formatDateTimeLocalDMY(value);
  if (dateTimeLocal) return dateTimeLocal;
  const dateTimePrefix = formatDateTimePrefix(value);
  if (dateTimePrefix) return dateTimePrefix;
  return formatDate(value) || "-";
}
