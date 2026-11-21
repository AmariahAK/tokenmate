import { lum } from "./palette";

// WCAG 2.x relative contrast. The theme gate asserts with this, so it must be the
// same maths a browser would use, not an approximation of it.
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
