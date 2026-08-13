/** Return an operator-local citation time, or null for absent/invalid evidence. */
export function formatBriefingReferenceTime(
  value: string | null,
  timezone: string,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
}
