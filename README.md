# watermeter-scraper

Scrapes site, property, and contact data from the WaterLink Connect API into a local SQLite database.

## Setup

```
npm install
```

## Usage

### Scrape data

```
npm start
```

You'll be prompted for a password. The scraper pages through the API and stores records in `watermeter.db`. It resumes from where it left off, so you can safely re-run it.

To scrape specific resources only:

```
node index.js sites properties
```

Available resources: `sites`, `properties`, `contacts`

### Extract to JS

```
node extract.js
```

Reads the database and writes each resource to a JS file in `data/`:

- `data/sites.js` — pool/site records
- `data/properties.js` — property addresses and metadata
- `data/contacts.js` — contact names, emails, and phone numbers

Each file exports an array:

```js
const sites = require("./data/sites");
console.log(sites.length); // 14120
```

### Import to MySQL

```
node import.js
```

Reads the extracted JS files and upserts them into the MySQL database. You'll be prompted for connection details, or set environment variables:

```
MYSQL_HOST=your-host MYSQL_PORT=25060 MYSQL_USER=your-user MYSQL_PASSWORD=your-pass MYSQL_DATABASE=olympia-watertest node import.js
```

Existing records are updated on conflict (matched by UUID primary key). Records are imported in order: contacts, properties, then sites.
