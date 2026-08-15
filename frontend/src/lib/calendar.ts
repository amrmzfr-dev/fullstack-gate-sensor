export interface CalendarCell {
  date: Date;
  inMonth: boolean;
}

export const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

// Sunday-start grid for one month, padded to full weeks with the trailing
// end of the previous month / leading start of the next so the grid is
// always a clean multiple of 7 cells.
export function getMonthGrid(year: number, month: number): CalendarCell[][] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: CalendarCell[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ date: new Date(year, month, i - firstWeekday + 1), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ date: new Date(year, month, day), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false });
  }

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
