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

export function formatDeviceName(device: string): string {
  return device.charAt(0).toUpperCase() + device.slice(1);
}
