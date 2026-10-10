export const tripOptions = [
  { label: 'MARKET A', price: '$55', detail: 'Food $52 + fuel $3', stops: '1 stop · simple trip' },
  { label: 'TWO-STOP LOOP', price: '$48', detail: 'Food $43 + fuel $5', stops: '2 stops · save $7', featured: true },
  { label: 'MARKET B', price: '$56', detail: 'Food $47 + fuel $9', stops: '1 stop · simple trip' },
];

export const starterList = [
  { id: 1, label: 'Avocados', quantity: 4, unitPrice: 1.5, checked: false },
  { id: 2, label: 'Pasta', quantity: 2, unitPrice: 2.25, checked: true },
  { id: 3, label: 'Laundry detergent', quantity: 1, unitPrice: 8.5, checked: false },
  { id: 4, label: 'Fresh berries', quantity: 2, unitPrice: 4.5, checked: false },
];

export const itemPrices = {
  avocados: 1.5,
  pasta: 2.25,
  'laundry detergent': 8.5,
  'fresh berries': 4.5,
};

export function getItemPrice(label) {
  return itemPrices[label.toLowerCase()] || 1;
}
