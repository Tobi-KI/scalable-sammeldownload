// Merkt sich, dass der Nutzer den Disclaimer bestätigt hat.
const KEY = 'scDocDlAccepted';
const acceptBtn = document.getElementById('accept');
const gate = document.getElementById('gate');
const accepted = document.getElementById('accepted');

chrome.storage.local.get(KEY, (r) => {
  if (r[KEY]) showAccepted();
});

acceptBtn.addEventListener('click', () => {
  chrome.storage.local.set({ [KEY]: true }, showAccepted);
});

function showAccepted() {
  gate.style.display = 'none';
  accepted.style.display = 'block';
}