import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * Produces a stable lexicographic key strictly between two neighbours.
 * Reordering never renumbers other rows. Null means the outer boundary.
 */
export function positionBetween(before: string | null | undefined, after: string | null | undefined): string {
  if (before && after && before >= after) {
    throw new Error("Invalid ordering boundary: before must sort before after");
  }
  return generateKeyBetween(before ?? null, after ?? null);
}

export function positionsBetween(
  before: string | null | undefined,
  after: string | null | undefined,
  count: number,
): string[] {
  if (!Number.isInteger(count) || count < 0) throw new Error("count must be a non-negative integer");
  if (count === 0) return [];
  return generateNKeysBetween(before ?? null, after ?? null, count);
}

export function firstPosition(): string {
  return positionBetween(null, null);
}

export function appendAfter(last: string | null | undefined): string {
  return positionBetween(last ?? null, null);
}

export function prependBefore(first: string | null | undefined): string {
  return positionBetween(null, first ?? null);
}

export function sortByPosition<T extends { position: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.position === b.position ? a.id.localeCompare(b.id) : a.position.localeCompare(b.position)));
}
