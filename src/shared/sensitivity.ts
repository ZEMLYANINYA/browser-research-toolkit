export const EXTENSION_SENSITIVE_FIELD_PATTERN =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-csrf.*|x-xsrf.*|.*(?:token|secret|password|passwd|apikey|api_key|access_token|refresh_token|session|signature|jwt|visitor[_-]?id|client[_-]?id|device[_-]?id|tracking[_-]?id).*)$/i;

export function isExtensionSensitiveFieldName(value: unknown): boolean {
  return EXTENSION_SENSITIVE_FIELD_PATTERN.test(String(value ?? ''));
}
