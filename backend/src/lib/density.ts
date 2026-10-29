import { DENSITY_SPEC_KG_M3 } from '../shared/index.js';
import { D, Decimal } from './decimal.js';

/**
 * Density correction to 15°C.
 *
 * Pump par hydrometer se jo density milti hai wo us samay ke temperature par
 * hoti hai. Fuel garam hone par failta hai (density kam dikhti hai), isliye
 * OMC hamesha 15°C par corrected density compare karta hai:
 *
 *   density@15 = observed + k × (T_observed − 15)
 *
 * k ek thermal-expansion approximation hai (petrol ~0.70, diesel ~0.64
 * kg/m³ per °C). Ye ASTM Table 53B ka seedha-saada roop hai — register aur
 * screening ke liye kaafi hai; kisi dispute me OMC lab ki report hi final hai.
 */
export function densityAt15C(category: string, observedKgM3: string | number, tempC: string | number): Decimal {
  const spec = DENSITY_SPEC_KG_M3[category] ?? DENSITY_SPEC_KG_M3.PETROL!;
  const observed = D(observedKgM3);
  const temp = D(tempC);
  return observed.plus(D(spec.correctionPerC).mul(temp.minus(15)));
}

export interface DensityEvaluation {
  densityAt15c: string;
  specMin: string | null;
  specMax: string | null;
  withinSpec: boolean;
}

export function evaluateDensity(category: string, observedKgM3: string | number, tempC: string | number): DensityEvaluation {
  const corrected = densityAt15C(category, observedKgM3, tempC);
  const spec = DENSITY_SPEC_KG_M3[category];
  if (!spec || spec.max === 0) {
    return { densityAt15c: corrected.toFixed(1), specMin: null, specMax: null, withinSpec: true };
  }
  return {
    densityAt15c: corrected.toFixed(1),
    specMin: String(spec.min),
    specMax: String(spec.max),
    withinSpec: corrected.gte(spec.min) && corrected.lte(spec.max),
  };
}
