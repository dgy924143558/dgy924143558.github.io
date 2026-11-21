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

const emailDialog = document.querySelector('#email-dialog');
document.querySelectorAll('.email-trigger').forEach(trigger => {
  trigger.addEventListener('click', event => {
    if (typeof emailDialog.showModal !== 'function') return;
    event.preventDefault();
    emailDialog.showModal();
  });
});
emailDialog.querySelector('.email-close').addEventListener('click', () => emailDialog.close());
emailDialog.addEventListener('click', event => {
  if (event.target !== emailDialog) return;
  const rect = emailDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom) emailDialog.close();
});

const photoDialog = document.querySelector('#photo-dialog');
document.querySelectorAll('.photo-trigger').forEach(trigger => {
  trigger.addEventListener('click', event => {
    if (typeof photoDialog.showModal !== 'function') return;
    event.preventDefault();
    const image = photoDialog.querySelector('img');
    image.src = trigger.href;
    image.alt = trigger.querySelector('img').alt;
    photoDialog.querySelector('.photo-caption').textContent = trigger.closest('figure').querySelector('figcaption').textContent;
    photoDialog.showModal();
  });
});
photoDialog.querySelector('.photo-close').addEventListener('click', () => photoDialog.close());
photoDialog.addEventListener('click', event => {
  if (event.target !== photoDialog) return;
  const rect = photoDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom) photoDialog.close();
});
