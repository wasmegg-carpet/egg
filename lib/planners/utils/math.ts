/**
 * Mathematical utility functions.
 */

/**
 * Clamp a value between a minimum and maximum.
 * @param value The value to clamp
 * @param min The minimum value
 * @param max The maximum value
 * @returns The clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Clamp a value to be at least the minimum.
 * @param value The value to check
 * @param min The minimum value (default 0)
 * @returns The clamped value
 */
export function min(value: number, min: number = 0): number {
  return Math.max(value, min);
}

/**
 * Clamp a value to be at most the maximum.
 * @param value The value to check
 * @param max The maximum value
 * @returns The clamped value
 */
export function max(value: number, max: number): number {
  return Math.min(value, max);
}
