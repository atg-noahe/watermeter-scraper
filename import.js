const mysql = require("mysql2/promise");
const readline = require("readline");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");

const BATCH_SIZE = 500;

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

function promptPassword(label) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(label);
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

async function getConnection() {
  const connStr = process.argv[2] || process.env.MYSQL_URL;

  if (connStr) {
    const url = new URL(connStr);
    return mysql.createConnection({
      host: url.hostname,
      port: parseInt(url.port, 10) || 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
      ssl: { rejectUnauthorized: false },
    });
  }

  const host = process.env.MYSQL_HOST || await prompt("MySQL host: ");
  const port = parseInt(process.env.MYSQL_PORT || await prompt("MySQL port [25060]: ") || "25060", 10);
  const user = process.env.MYSQL_USER || await prompt("MySQL user: ");
  const password = process.env.MYSQL_PASSWORD || await promptPassword("MySQL password: ");
  const database = process.env.MYSQL_DATABASE || await prompt("MySQL database [olympia-watertest]: ") || "olympia-watertest";

  return mysql.createConnection({ host, port, user, password, database, ssl: { rejectUnauthorized: false } });
}

async function importContacts(conn, records) {
  console.log(`\n=== Importing ${records.length} contacts ===`);

  const sql = `
    INSERT INTO contacts (id, first_name, last_name, phone, email, tag_ids, notification_opt_in)
    VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      first_name = VALUES(first_name),
      last_name = VALUES(last_name),
      phone = VALUES(phone),
      email = VALUES(email),
      tag_ids = VALUES(tag_ids),
      notification_opt_in = VALUES(notification_opt_in)
  `;

  let created = 0, updated = 0, unchanged = 0, processed = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    for (const r of batch) {
      const [result] = await conn.execute(sql, [
        r.id,
        r.firstName || "",
        r.lastName || "",
        r.phone || null,
        r.email || null,
        JSON.stringify(r.tagIds || []),
        JSON.stringify(r.notificationOptIn || []),
      ]);
      if (result.changedRows === 1) updated++;
      else if (result.affectedRows === 1) created++;
      else unchanged++;
    }
    processed += batch.length;
    process.stdout.write(`\r  ${processed}/${records.length}`);
  }
  console.log(`\n  Created: ${created} | Updated: ${updated} | Unchanged: ${unchanged}`);
}

async function importProperties(conn, records) {
  console.log(`\n=== Importing ${records.length} properties ===`);

  const sql = `
    INSERT INTO properties (id, name, address, phone, site_ids, contact_ids, property_group_id, linked_property_ids, tag_ids)
    VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      address = VALUES(address),
      phone = VALUES(phone),
      site_ids = VALUES(site_ids),
      contact_ids = VALUES(contact_ids),
      property_group_id = VALUES(property_group_id),
      linked_property_ids = VALUES(linked_property_ids),
      tag_ids = VALUES(tag_ids)
  `;

  let created = 0, updated = 0, unchanged = 0, processed = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    for (const r of batch) {
      const [result] = await conn.execute(sql, [
        r.id,
        r.name || "",
        JSON.stringify(r.address || {}),
        r.phone || null,
        JSON.stringify(r.siteIds || []),
        JSON.stringify(r.contactIds || []),
        r.propertyGroupId || null,
        JSON.stringify(r.linkedPropertyIds || []),
        JSON.stringify(r.tagIds || []),
      ]);
      if (result.changedRows === 1) updated++;
      else if (result.affectedRows === 1) created++;
      else unchanged++;
    }
    processed += batch.length;
    process.stdout.write(`\r  ${processed}/${records.length}`);
  }
  console.log(`\n  Created: ${created} | Updated: ${updated} | Unchanged: ${unchanged}`);
}

async function importSites(conn, records) {
  console.log(`\n=== Importing ${records.length} sites ===`);

  const sql = `
    INSERT INTO sites (id, name, volume, volume_unit, property_id, treatment_profile_id, monitoring_profile_id, property_name, tag_ids, site_data)
    VALUES (UUID_TO_BIN(?), ?, ?, ?, UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      volume = VALUES(volume),
      volume_unit = VALUES(volume_unit),
      property_id = VALUES(property_id),
      treatment_profile_id = VALUES(treatment_profile_id),
      monitoring_profile_id = VALUES(monitoring_profile_id),
      property_name = VALUES(property_name),
      tag_ids = VALUES(tag_ids),
      site_data = VALUES(site_data)
  `;

  let created = 0, updated = 0, unchanged = 0, skipped = 0, processed = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    for (const r of batch) {
      if (!r.treatmentProfileId) {
        skipped++;
        continue;
      }
      const [result] = await conn.execute(sql, [
        r.id,
        r.name || "",
        r.volume || 0,
        r.volumeUnit || "Gallons",
        r.propertyId || null,
        r.treatmentProfileId,
        r.monitoringProfileId || null,
        r.propertyName || null,
        JSON.stringify(r.tagIds || []),
        JSON.stringify(r.siteData || {}),
      ]);
      if (result.changedRows === 1) updated++;
      else if (result.affectedRows === 1) created++;
      else unchanged++;
    }
    processed += batch.length;
    process.stdout.write(`\r  ${processed}/${records.length}`);
  }
  console.log(`\n  Created: ${created} | Updated: ${updated} | Unchanged: ${unchanged}${skipped ? ` | Skipped: ${skipped}` : ""}`);
}

async function main() {
  const contacts = require(path.join(DATA_DIR, "contacts.js"));
  const properties = require(path.join(DATA_DIR, "properties.js"));
  const sites = require(path.join(DATA_DIR, "sites.js"));

  console.log(`Loaded: ${contacts.length} contacts, ${properties.length} properties, ${sites.length} sites`);

  const conn = await getConnection();
  console.log("Connected to MySQL.");

  try {
    await importContacts(conn, contacts);
    await importProperties(conn, properties);
    await importSites(conn, sites);
    console.log("\nImport complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nImport failed:", err.message);
  process.exit(1);
});
