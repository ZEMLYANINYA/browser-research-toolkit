export const EXTENSION_CAPTURE_LIMITS = Object.freeze({
  maxResponseChars: 80_000,
  maxHtmlChars: 1_500_000,
  maxRuntimeEntries: 4000,
  maxStructuredBodyChars: 120_000
} as const);
