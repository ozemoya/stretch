const trips = [
  { label: 'MARKET A', price: '$55', detail: 'Food $52 + fuel $3', stops: '1 stop · simple trip', tone: 'light' },
  { label: 'TWO-STOP LOOP', price: '$48', detail: 'Food $43 + fuel $5', stops: '2 stops · save $7', tone: 'featured' },
  { label: 'MARKET B', price: '$56', detail: 'Food $47 + fuel $9', stops: '1 stop · simple trip', tone: 'light' }
];

function TripCard({ label, price, detail, stops, tone }) {
  return `<article class="trip-card ${tone}">
    <p>${label}</p>
    <strong>${price}</strong>
    <span>${detail}</span>
    <small>${stops}</small>
  </article>`;
}

document.querySelector('#trip-options').innerHTML = trips.map(TripCard).join('');

document.querySelectorAll('.step').forEach((step) => {
  step.addEventListener('click', () => {
    document.querySelector('.step.active')?.classList.remove('active');
    step.classList.add('active');
  });
});
