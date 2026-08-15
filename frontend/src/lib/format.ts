export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "medium",
  }).format(new Date(value));
}

// "16 August 2026" — used as a day-group header, so no year-omitting
// "medium" shorthand and no time component.
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatDay(value: string): string {
  return DAY_FORMAT.format(new Date(value));
}

// Same "16 August 2026" display as formatDay, but for a local "YYYY-MM-DD"
// value (e.g. the press-log date filter) rather than a full timestamp.
// Plain "YYYY-MM-DD" strings parse as UTC midnight per spec, which can
// print as the wrong day in timezones behind UTC — parse the components
// directly as local instead.
export function formatDateInputValue(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return DAY_FORMAT.format(new Date(year, month - 1, day));
}

// Local (not UTC) calendar-day key, so events group by the day the viewer
// would actually call "today" rather than the day it happened to be in UTC.
export function dayKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// Zero-padded local "YYYY-MM-DD" — the same shape <input type="date">
// reads/writes, so an event's timestamp or a calendar grid cell can be
// compared straight against the press-log date filter's value.
export function dateInputValue(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatDeviceName(device: string): string {
  return capitalize(device);
}
