function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

export function shiftMonth(monthKey: string, delta: number) {
  const { year, month } = parseMonthKey(monthKey);
  const totalMonths = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

export function formatMonthLabel(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "America/Mexico_City" })
    .format(new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)));
}

export function buildMonthCells(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
  const cells: Array<{ key: string; dayNumber: number; outside: boolean }> = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({ key: `empty-start-${index}`, dayNumber: 0, outside: true });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${monthKey}-${String(day).padStart(2, "0")}`;
    cells.push({
      key,
      dayNumber: day,
      outside: false
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `empty-end-${cells.length}`, dayNumber: 0, outside: true });
  }

  return cells;
}
