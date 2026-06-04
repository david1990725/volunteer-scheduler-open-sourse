const fetch = require('node-fetch');
async function run() {
  const url = 'https://script.google.com/macros/s/AKfycbzZ86wcnKqSTzBPYKPCYIEXy_-xT07yp-EW_iOuFRyuMKtDZxb74jLx0ALKamihcNOf/exec';
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ action: 'fetchVolunteers' })
  });
  const text = await res.text();
  console.log(text.substring(0, 500));
}
run();
