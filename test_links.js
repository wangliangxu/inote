const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '.inote', 'index.sqlite3');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the database.');
});

db.all("SELECT * FROM links", [], (err, rows) => {
  if (err) {
    throw err;
  }
  console.log("LINKS:");
  rows.forEach((row) => {
    console.log(row);
  });
});

db.all("SELECT path, title FROM notes", [], (err, rows) => {
  if (err) {
    throw err;
  }
  console.log("\nNOTES:");
  rows.forEach((row) => {
    console.log(row);
  });
});

db.close();
