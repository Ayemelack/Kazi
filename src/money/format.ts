export function formatMoney(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const [integer, decimals] = String(rounded).split('.');
  const grouped = (integer ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decimals ? `${grouped}.${decimals} FCFA` : `${grouped} FCFA`;
}