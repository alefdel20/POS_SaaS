function normalizeFrequency(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "monthly";
  if (["weekly", "biweekly", "monthly", "bimonthly", "quarterly", "semiannual", "annual", "custom"].includes(normalized)) {
    return normalized;
  }
  return "monthly";
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function buildDate(year, monthIndex, dueDay) {
  const safeDay = Math.min(Math.max(Number(dueDay) || 1, 1), daysInMonth(year, monthIndex));
  return new Date(year, monthIndex, safeDay, 12, 0, 0, 0);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(baseDate, days) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(baseDate, months, dueDay) {
  const cursor = new Date(baseDate.getFullYear(), baseDate.getMonth() + months, 1, 12, 0, 0, 0);
  return buildDate(cursor.getFullYear(), cursor.getMonth(), dueDay);
}

function getNextFixedExpenseDueDate(fixedExpense, referenceDate = new Date()) {
  const dueDay = Number(fixedExpense?.due_day);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return null;
  }

  const frequency = normalizeFrequency(fixedExpense?.frequency);
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  if (frequency === "weekly") {
    const currentMonthDue = buildDate(today.getFullYear(), today.getMonth(), dueDay);
    if (currentMonthDue >= today) return formatDate(currentMonthDue);
    return formatDate(addDays(currentMonthDue, 7));
  }

  if (frequency === "biweekly") {
    const currentMonthDue = buildDate(today.getFullYear(), today.getMonth(), dueDay);
    const secondCycle = addDays(currentMonthDue, 14);
    if (currentMonthDue >= today) return formatDate(currentMonthDue);
    if (secondCycle >= today) return formatDate(secondCycle);
    return formatDate(addMonths(currentMonthDue, 1, dueDay));
  }

  const monthIntervals = {
    monthly: 1,
    custom: 1,
    bimonthly: 2,
    quarterly: 3,
    semiannual: 6,
    annual: 12
  };

  const intervalMonths = monthIntervals[frequency] || 1;
  let candidate = buildDate(today.getFullYear(), today.getMonth(), dueDay);
  while (candidate < today) {
    candidate = addMonths(candidate, intervalMonths, dueDay);
  }

  return formatDate(candidate);
}

module.exports = {
  normalizeFrequency,
  getNextFixedExpenseDueDate
};
