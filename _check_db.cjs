const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(process.argv[2] || './server/data/reader.db');
console.log('DB path:', dbPath);
console.log('DB size:', (fs.statSync(dbPath).size / 1024 / 1024).toFixed(2), 'MB');

initSqlJs().then(SQL => {
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);
  
  console.log('\n=== Row counts ===');
  for (const t of ['texts','folders','stats','wordbooks','words','knowledge_points','daily_insights']) {
    const r = db.exec('SELECT COUNT(*) FROM ' + t);
    if (r.length) console.log('  ' + t + ': ' + r[0].values[0][0]);
  }
  
  console.log('\n=== Top 3 largest texts (by text content) ===');
  const r1 = db.exec('SELECT id, title, LENGTH(text) as len FROM texts ORDER BY len DESC LIMIT 3');
  if (r1.length) r1[0].values.forEach(v => console.log('  [' + String(v[0]).substring(0,20) + '] ' + String(v[1]||'?').substring(0,40) + ': ' + Math.floor(v[2]/1024) + ' KB'));
  
  console.log('\n=== Marks coverage ===');
  const r2 = db.exec("SELECT COUNT(*), SUM(CASE WHEN marks IS NOT NULL AND marks != '' AND marks != '[]' THEN 1 ELSE 0 END) FROM texts");
  if (r2.length) console.log('  texts with marks: ' + r2[0].values[0][1] + ' / ' + r2[0].values[0][0]);
  
  console.log('\n=== Average JSON field sizes ===');
  const r3 = db.exec('SELECT AVG(LENGTH(analysis)), AVG(LENGTH(segments)), AVG(LENGTH(marks)), AVG(LENGTH(paragraphChats)) FROM texts');
  if (r3.length) {
    const v = r3[0].values[0];
    console.log('  analysis=' + Math.floor(v[0]||0) + 'B, segments=' + Math.floor(v[1]||0) + 'B, marks=' + Math.floor(v[2]||0) + 'B, chats=' + Math.floor(v[3]||0) + 'B');
  }
  
  console.log('\n=== Words stats ===');
  const r4 = db.exec('SELECT COUNT(DISTINCT word), COUNT(*) FROM words');
  if (r4.length) console.log('  distinct words: ' + r4[0].values[0][0] + ', total entries: ' + r4[0].values[0][1]);
  
  const r5 = db.exec('SELECT wb.name, COUNT(w.id) FROM wordbooks wb LEFT JOIN words w ON w.bookId = wb.id GROUP BY wb.id');
  if (r5.length) {
    console.log('  per wordbook:');
    r5[0].values.forEach(v => console.log('    ' + v[0] + ': ' + v[1]));
  }
  
  console.log('\n=== texts table total size (bytes) ===');
  const r6 = db.exec("SELECT SUM(LENGTH(id)) + SUM(LENGTH(title)) + SUM(LENGTH(text)) + SUM(LENGTH(analysis)) + SUM(LENGTH(segments)) + SUM(LENGTH(marks)) + SUM(LENGTH(paragraphChats)) FROM texts");
  if (r6.length) console.log('  raw data: ' + Math.floor(r6[0].values[0][0]/1024/1024) + ' MB');
  
  db.close();
});
