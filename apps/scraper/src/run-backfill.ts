import { createDb } from "@flat-finder/db";

async function main() {
  const { sql } = createDb();

  console.log("Sreality — move 'okres X' city → district, fix city from address ...");
  const affected = await sql`
    SELECT id, address, city
    FROM listings
    WHERE source = 'sreality' AND city LIKE 'okres %'
  `;
  console.log(`  Found ${affected.length} rows to fix`);

  let updated = 0;
  for (const row of affected) {
    const district = (row.city as string).replace(/^okres\s+/i, "").trim();

    let newCity: string | null = null;
    const address = row.address as string | null;
    if (address) {
      const parts = address.split(",").map((p: string) => p.trim());
      if (parts.length >= 2 && /^okres\s+/i.test(parts[parts.length - 1])) {
        let cityPart = parts[parts.length - 2];
        cityPart = cityPart.replace(/\s*-\s*\S.*$/, "").trim();
        cityPart = cityPart.replace(/\s+\d+$/, "").trim();
        newCity = cityPart || null;
      }
    }

    if (!newCity) newCity = district;

    await sql`
      UPDATE listings SET city = ${newCity}, district = ${district}
      WHERE id = ${row.id}
    `;
    updated++;
  }
  console.log(`  Updated ${updated} rows`);

  console.log("Done!");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
