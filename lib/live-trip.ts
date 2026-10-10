export function fuelCostCents(
  miles: number,
  mpg: number,
  dollarsPerGallon: number,
) {
  if (
    ![miles, mpg, dollarsPerGallon].every(Number.isFinite) ||
    miles < 0 ||
    mpg <= 0 ||
    dollarsPerGallon <= 0
  )
    return null;
  return Math.round((miles / mpg) * dollarsPerGallon * 100);
}
