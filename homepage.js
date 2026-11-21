const controls = document.querySelector('#publication-controls');
const list = document.querySelector('#publications');
const entries = Array.from(list.children);
const count = document.querySelector('#result-count');
function updatePublications() {
  const selected = new Set(Array.from(controls.querySelectorAll('input:checked'), input => input.value));
  const direction = document.querySelector('#sort').value === 'asc' ? 1 : -1;
  entries.sort((a, b) => {
    const yearA = Number(a.dataset.year);
    const yearB = Number(b.dataset.year);
    if (!yearA) return yearB ? 1 : 0;
    if (!yearB) return -1;
    return direction * (yearA - yearB);
  });
  let visible = 0;
  entries.forEach(entry => {
    entry.hidden = !selected.has(entry.dataset.type);
    if (!entry.hidden) visible++;
    list.append(entry);
  });
  count.textContent = `${visible} ${count.dataset.label}`;
  document.querySelector('#empty').hidden = visible !== 0;
}
controls.hidden = false;
controls.addEventListener('change', updatePublications);
controls.addEventListener('submit', event => event.preventDefault());
updatePublications();
