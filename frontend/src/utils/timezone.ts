export const MEXICO_CITY_TIMEZONE = "America/Mexico_City";

function partsToRecord(parts: Intl.DateTimeFormatPart[]) {
  return parts.reduce<Record<string, string>>((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});
}

function getDateParts(value: Date | string | number = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
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

export function getMexicoCityDateTimeLocalValue(value?: string | null) {
  if (!value) {
    return "";
  }

  const parts = getDateTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function dateTimeLocalToIsoString(value?: string | null) {
  if (!value) {
    return null;
  }

  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  return utcDate.toISOString();
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
