const Database = require("better-sqlite3");
const readline = require("readline");

const API_BASE = "https://wls-api.waterlinkconnect.com";
const AUTH_URL = "https://wls-auth.waterlinkconnect.com/authentication";
const LIMIT = 25;
const DB_PATH = "watermeter.db";
let username = null;
let password = null;
let authToken = null;

function getHeaders() {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    authorization: authToken,
    "cache-control": "no-cache",
    pragma: "no-cache",
    Referer: "https://solutions.waterlinkconnect.com/",
  };
}

const RESOURCES = {
  sites: "/sites",
  properties: "/properties",
  contacts: "/contacts",
};

function initDb() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT NOT NULL,
      resource TEXT NOT NULL,
      data JSON NOT NULL,
      PRIMARY KEY (resource, id)
    )
  `);
  return db;
}

function promptPassword() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write("Password: ");
    rl.input.setRawMode?.(true);
    let pw = "";
    rl.input.on("data", (ch) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r" || c === "\u0004") {
        rl.input.setRawMode?.(false);
        rl.close();
        console.log();
        resolve(pw);
      } else if (c === "\u0003") {
        process.exit();
      } else if (c === "\u007F" || c === "\b") {
        pw = pw.slice(0, -1);
      } else {
        pw += c;
      }
    });
  });
}

async function login() {
  if (!username) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    username = await new Promise((resolve) => rl.question("Username: ", (ans) => { rl.close(); resolve(ans); }));
  }
  if (!password) {
    password = await promptPassword();
  }

  console.log("  Logging in to refresh token...");
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      Referer: "https://solutions.waterlinkconnect.com/",
    },
    body: JSON.stringify({ username, password, appId: "WaterVapor" }),
  });

  if (!res.ok) {
    throw new Error(`Login failed: HTTP ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const token = data.jwt ?? data.token ?? data.access_token ?? data.accessToken;
  if (!token) {
    throw new Error(`Login response missing token. Keys: ${Object.keys(data).join(", ")}`);
  }

  authToken = `Bearer ${token}`;
  console.log("  Token refreshed.");
}

async function fetchPage(endpoint, offset) {
  const url = `${API_BASE}${endpoint}?offset=${offset}&limit=${LIMIT}`;
  let res = await fetch(url, { method: "GET", headers: getHeaders() });

  if (res.status === 401) {
    await login();
    res = await fetch(url, { method: "GET", headers: getHeaders() });
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} at offset ${offset}: ${res.statusText}`);
  }

  return res.json();
}

async function scrapeResource(db, name, endpoint) {
  console.log(`\n=== Scraping ${name} ===`);

  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM records WHERE resource = ?").get(name);
  let offset = countRow.cnt;
  console.log(`  ${offset} records already in db`);

  const probe = await fetchPage(endpoint, offset);
  const total = probe.totalRecords;
  console.log(`  Total records: ${total}`);

  if (offset >= total) {
    console.log(`  Already have all ${name}.`);
    return;
  }

  const insert = db.prepare(
    "INSERT OR IGNORE INTO records (id, resource, data) VALUES (?, ?, ?)"
  );
  const insertBatch = db.transaction((rows) => {
    for (const row of rows) insert.run(row.id, name, JSON.stringify(row));
  });

  insertBatch(probe.data);
  offset += probe.data.length;
  console.log(`  Fetched: ${probe.data.length} (total: ${offset})`);

  while (offset < total) {
    console.log(`  Fetching offset=${offset}/${total}...`);
    const page = await fetchPage(endpoint, offset);

    if (!page.data || page.data.length === 0) break;

    insertBatch(page.data);
    offset += page.data.length;
    console.log(`    Got ${page.data.length} (total: ${offset})`);
  }

  console.log(`  Done! ${offset} ${name} in db`);
}

async function main() {
  await login();
  const db = initDb();
  const args = process.argv.slice(2);
  const targets = args.length > 0 ? args : Object.keys(RESOURCES);

  for (const name of targets) {
    if (!RESOURCES[name]) {
      console.error(`Unknown resource: ${name}. Available: ${Object.keys(RESOURCES).join(", ")}`);
      process.exit(1);
    }
    await scrapeResource(db, name, RESOURCES[name]);
  }

  db.close();
}

main().catch((err) => {
  console.error("\nScrape failed:", err.message);
  console.error("Progress has been saved. Run again to resume.");
  process.exit(1);
});
