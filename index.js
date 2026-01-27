const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('<h1>Hello from Affix!</h1>');
});

app.listen(PORT, () => {
  console.log(`Affix running on port ${PORT}`);
});
