const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/modfyinew', (req, res) => {
  res.sendFile(path.join(__dirname, 'modfyinew.html'));
});

app.listen(PORT, () => {
  console.log(`Affix running on port ${PORT}`);
});
