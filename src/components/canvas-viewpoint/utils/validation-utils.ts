/**
 * box Ids might be zero, Jaavaascript
 */
export function isNullOrUndefined<T>(value: T | null | undefined): value is null | undefined {
  return value === null || value === undefined;
}
