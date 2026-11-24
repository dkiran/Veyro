// Fuel is ESTIMATED (no fuel sensors yet): distance / typical efficiency + idle burn.
// Reference India prices and typical efficiencies; make these per-org/per-vehicle settings later.
type Unit = 'L' | 'kg' | 'kWh';
export const FUEL_PRICE: Record<string, { price: number; unit: Unit }> = {
  diesel: { price: 92, unit: 'L' }, petrol: { price: 103, unit: 'L' }, hybrid: { price: 103, unit: 'L' },
  cng: { price: 85, unit: 'kg' }, electric: { price: 12, unit: 'kWh' }, other: { price: 92, unit: 'L' },
};
const KM_PER_UNIT: Record<string, number> = { truck: 4, bus: 4.5, van: 9, car: 14, bike: 40, tractor: 3, other: 8 };
const EV_KM_PER_KWH: Record<string, number> = { truck: 1.2, bus: 1.1, van: 3, car: 6, bike: 25, tractor: 1, other: 3 };
const IDLE_PER_HOUR: Record<string, number> = { truck: 2.5, bus: 3, van: 1.2, car: 0.8, bike: 0.3, tractor: 2, other: 1 };
const FUEL_EFF_MULT: Record<string, number> = { cng: 1.3, hybrid: 1.4 };

export function estimateFuel(vehicleType: string, fuelType: string, km: number, idleSeconds: number) {
  const f = FUEL_PRICE[fuelType] ?? FUEL_PRICE.other;
  const type = vehicleType in KM_PER_UNIT ? vehicleType : 'other';
  const eff = fuelType === 'electric' ? EV_KM_PER_KWH[type] : KM_PER_UNIT[type] * (FUEL_EFF_MULT[fuelType] ?? 1);
  const driveUnits = km / eff;
  const idleUnits = fuelType === 'electric' ? 0 : (idleSeconds / 3600) * IDLE_PER_HOUR[type];
  return { unit: f.unit, driveUnits, idleUnits, driveCost: driveUnits * f.price, idleCost: idleUnits * f.price };
}
