export function truncateText(
  text: string,
  maxLength: number,
  suffix: string
): string {
  return text.length > maxLength
    ? text.slice(0, maxLength) + suffix
    : text;
}
