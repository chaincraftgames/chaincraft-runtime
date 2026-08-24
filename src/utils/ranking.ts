// ---------------------------------------------------------------------------
// Ranking utilities — shared by win-conditions, dominant-gamepiece, turn order.
// ---------------------------------------------------------------------------

/**
 * Assigns an ordinal rank to each element. Rank 0 = best; ties share the
 * same rank. The rank equals the count of elements with a strictly better
 * value (like dense sports ranking with no gaps within a group).
 */
export function rankBy<T>(
  items: T[],
  valueOf: (item: T) => number,
  order: "highest" | "lowest",
): number[] {
  const values = items.map(valueOf);
  const isBetter = order === "highest"
    ? (a: number, b: number) => a > b
    : (a: number, b: number) => a < b;

  return values.map((v, i) =>
    values.reduce((rank, other, j) => {
      if (j === i) return rank;
      return rank + (isBetter(other, v) ? 1 : 0);
    }, 0),
  );
}

/** Items sharing the best rank (rank 0) from a `rankBy` result. */
export function topRanked<T>(items: T[], ranks: number[]): T[] {
  return items.filter((_, i) => ranks[i] === 0);
}
