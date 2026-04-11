const BUSINESS_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const BUSINESS_DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/;

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getDaysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function isValidBusinessDate(value) {
  const match = BUSINESS_DATE_REGEX.exec(String(value || "").trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= getDaysInMonth(year, month);
}

function extractBusinessDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (BUSINESS_DATE_REGEX.test(text)) return text;
  const prefixed = BUSINESS_DATE_PREFIX_REGEX.exec(text);
  if (!prefixed) return null;
  return prefixed[1];
}

function normalizeBusinessDate(value, fallback = null) {
  const extracted = extractBusinessDate(value);
  if (extracted && isValidBusinessDate(extracted)) {
    return extracted;
  }

  const fallbackExtracted = extractBusinessDate(fallback);
  if (fallbackExtracted && isValidBusinessDate(fallbackExtracted)) {
    return fallbackExtracted;
  }

  return null;
}

module.exports = {
  isValidBusinessDate,
  normalizeBusinessDate,
};
