export const MEXICO_CITY_TIMEZONE = "America/Mexico_City";
const MEXICO_CITY_OFFSET = "-06:00";
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DMY_DATE_REGEX = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const ISO_DATETIME_LOCAL_REGEX = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DMY_DATETIME_REGEX = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/;

function partsToRecord(parts: Intl.DateTimeFormatPart[]) {
  return parts.reduce<Record<string, string>>((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});
}

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getDaysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

function isValidDateParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  const maxDay = getDaysInMonth(year, month);
  return day >= 1 && day <= maxDay;
}

export function isIsoDate(value: string) {
  return ISO_DATE_REGEX.test(value);
}

export function parseDateDMY(value: string) {
  const match = DMY_DATE_REGEX.exec(String(value || "").trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatDateDMY(value?: string | null) {
  if (!value) return "";
  const text = String(value).trim();
  if (isIsoDate(text)) {
    const [year, month, day] = text.split("-");
    return `${day}/${month}/${year}`;
  }
  const dateTimeMatch = ISO_DATETIME_LOCAL_REGEX.exec(text);
  if (dateTimeMatch) {
    return `${dateTimeMatch[3]}/${dateTimeMatch[2]}/${dateTimeMatch[1]}`;
  }
  const dmy = parseDateDMY(text);
  if (dmy) {
    return formatDateDMY(dmy);
  }
  return "";
}

export function parseDateTimeDMY(value: string) {
  const match = DMY_DATETIME_REGEX.exec(String(value || "").trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!isValidDateParts(year, month, day)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatDateTimeLocalDMY(value?: string | null) {
  if (!value) return "";
  const text = String(value).trim();
  const match = ISO_DATETIME_LOCAL_REGEX.exec(text);
  if (match) {
    const [, year, month, day, hour, minute] = match;
    return `${day}/${month}/${year} ${hour}:${minute}`;
  }
  const parsed = parseDateTimeDMY(text);
  if (parsed) {
    return formatDateTimeLocalDMY(parsed);
  }
  return "";
}

function getDateParts(value: Date | string | number = new Date()) {
  let date: Date;
  if (typeof value === "string" && ISO_DATE_REGEX.test(value)) {
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

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}/.test(value)) return value.replace(" ", "T").slice(0, 16);

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
