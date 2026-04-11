export const MEXICO_CITY_TIMEZONE = "America/Mexico_City";
const MEXICO_CITY_OFFSET = "-06:00";

function partsToRecord(parts: Intl.DateTimeFormatPart[]) {
  return parts.reduce<Record<string, string>>((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});
}

function getDateParts(value: Date | string | number = new Date()) {
  let date: Date;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  } else {
    date = value instanceof Date ? value : new Date(value);
  }
  return partsToRecord(new Intl.DateTimeFormat("en-CA", {
    timeZone: MEXICO_CITY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date));
}

function getDateTimeParts(value: Date | string | number = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return partsToRecord(new Intl.DateTimeFormat("en-CA", {
    timeZone: MEXICO_CITY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date));
}

export function getMexicoCityDateInputValue(value: Date | string | number = new Date()) {
  const parts = getDateParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatMexicoCityDate(value: Date | string | number) {
  const parts = getDateParts(value);
  return `${parts.day}/${parts.month}/${parts.year}`;
}

export function formatMexicoCityDateTime(value: Date | string | number) {
  const parts = getDateTimeParts(value);
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export function getMexicoCityDateTimeLocalValue(value?: string | null) {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}/.test(value)) {
    return value.replace(" ", "T").slice(0, 16);
  }

  const parts = getDateTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function dateTimeLocalToIsoString(value?: string | null) {
  if (!value) {
    return null;
  }
  const normalized = value.length === 16 ? `${value}:00` : value;
  return `${normalized}${MEXICO_CITY_OFFSET}`;
}

export function getMonthInputRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return null;
  }

  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1, 12, 0, 0));
  const end = new Date(Date.UTC(year, monthNumber, 0, 12, 0, 0));
  return {
    start: getMexicoCityDateInputValue(start),
    end: getMexicoCityDateInputValue(end)
  };
}
