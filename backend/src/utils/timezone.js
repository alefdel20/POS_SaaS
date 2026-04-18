const TIME_ZONE = "America/Mexico_City";

const datePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

function partsToObject(parts) {
  return parts.reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});
}

function getLocalParts(value = new Date()) {
  const parts = partsToObject(dateTimePartsFormatter.formatToParts(value));
  if (parts.hour === "24") {
    parts.hour = "00";
  }
  return parts;
}

function getLocalDateParts(value = new Date()) {
  return partsToObject(datePartsFormatter.formatToParts(value));
}

function getMexicoCityDate(value = new Date()) {
  const parts = getLocalDateParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getMexicoCityTime(value = new Date()) {
  const parts = getLocalParts(value);
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

function getMexicoCityDateTime(value = new Date()) {
  const parts = getLocalParts(value);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getMonthRange(month) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1, 12, 0, 0));
  const end = new Date(Date.UTC(year, monthNumber, 0, 12, 0, 0));
  return {
    start: getMexicoCityDate(start),
    end: getMexicoCityDate(end),
  };
}

function toSqlTimestampInTimeZone(column) {
  return `${column} AT TIME ZONE '${TIME_ZONE}'`;
}

module.exports = {
  TIME_ZONE,
  getMexicoCityDate,
  getMexicoCityTime,
  getMexicoCityDateTime,
  getMonthRange,
  toSqlTimestampInTimeZone,
};
