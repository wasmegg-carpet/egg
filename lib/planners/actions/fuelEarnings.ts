/**
 * What fueling at partial speed earned. Ascension plans save it as `gemsEarnedDuringFuel` and
 * enlightenment plans as `cashEarnedDuringFuel`; saved plans keep those names.
 */
export interface FuelEarnings {
  gemsEarnedDuringFuel?: number;
  cashEarnedDuringFuel?: number;
}

export type FuelEarningsField = keyof FuelEarnings;

/** The amount earned, under whichever name this payload was saved with. */
export function fuelEarnings(payload: FuelEarnings): number {
  return payload.gemsEarnedDuringFuel ?? payload.cashEarnedDuringFuel ?? 0;
}
