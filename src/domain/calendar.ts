import type { TestDriveEntry } from "../types";
const escape = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
export function calendarEvent(entry: TestDriveEntry, vehicleName: string) {
  const date = entry.date.replace(/-/g, "");
  const start = entry.appointmentTime
    ? `${date}T${entry.appointmentTime.replace(":", "")}00`
    : date;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CarMatch//Test drive//EN",
    "BEGIN:VEVENT",
    `UID:${escape(entry.id ?? `${entry.vehicleId}-${date}`)}@carmatch`,
    `DTSTAMP:${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z/, "Z")}`,
    `DTSTART${entry.appointmentTime ? "" : ";VALUE=DATE"}:${start}`,
    `SUMMARY:${escape(`Test drive: ${vehicleName}`)}`,
    `LOCATION:${escape(entry.dealer)}`,
    `DESCRIPTION:${escape(entry.notes || "Bring your car seat and stroller.")}`,
  ];
  if (entry.reminderDate && entry.reminderDate <= entry.date) {
    const days = Math.round(
      (Date.parse(`${entry.date}T00:00:00Z`) -
        Date.parse(`${entry.reminderDate}T00:00:00Z`)) /
        86400000,
    );
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Test drive reminder",
      `TRIGGER:-P${days}D`,
      "END:VALARM",
    );
  }
  return [...lines, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}
export function downloadCalendar(entry: TestDriveEntry, name: string) {
  const url = URL.createObjectURL(
    new Blob([calendarEvent(entry, name)], {
      type: "text/calendar;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `test-drive-${entry.date}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function preparePhotos(files: FileList): Promise<string[]> {
  if (files.length > 3) throw new Error("Choose up to three photos per drive.");
  return Promise.all(
    Array.from(files).map(async (file) => {
      if (
        !/^image\/(jpeg|png|webp)$/.test(file.type) ||
        file.size > 15 * 1024 * 1024
      )
        throw new Error("Choose JPG, PNG or WebP photos smaller than 15 MB.");
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      let data = canvas.toDataURL("image/jpeg", 0.65);
      if (data.length > 180000) data = canvas.toDataURL("image/jpeg", 0.35);
      if (data.length > 180000)
        throw new Error("This photo is too detailed. Try a smaller image.");
      return data;
    }),
  );
}
