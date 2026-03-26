const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH = "watermeter.db";
const OUT_DIR = path.join(__dirname, "data");

const db = new Database(DB_PATH, { readonly: true });

const resources = db
  .prepare("SELECT DISTINCT resource FROM records")
  .pluck()
  .all();

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const resource of resources) {
  const rows = db
    .prepare("SELECT data FROM records WHERE resource = ?")
    .pluck()
    .all(resource);

  const records = rows.map((r) => JSON.parse(r));
  const outFile = path.join(OUT_DIR, `${resource}.js`);

  fs.writeFileSync(
    outFile,
    `module.exports = ${JSON.stringify(records, null, 2)};\n`
  );

  console.log(`${resource}: ${records.length} records -> ${outFile}`);
}

db.close();
console.log("\nDone.");
