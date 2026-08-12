import { neon } from "@neondatabase/serverless";

let sqlClient = null;
let schemaReady = null;

function getSql() {
  if (!sqlClient) {
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

const SEED_SPOTS = [
  { id: "144-bonito-your-spot", name: "144 Bonito Ave", cross: "Your spot", area: "Bonito Ave", featured: true, lat: 33.767717, lng: -118.180526 },
  { id: "bonito-1-door-south", name: "Bonito Ave", cross: "~1 door south of 144", area: "Bonito Ave", featured: false, lat: 33.767419, lng: -118.180594 },
  { id: "bonito-2-doors-south", name: "Bonito Ave", cross: "~2 doors south of 144", area: "Bonito Ave", featured: false, lat: 33.76712, lng: -118.180663 },
  { id: "bonito-1-door-north", name: "Bonito Ave", cross: "~1 door north of 144", area: "Bonito Ave", featured: false, lat: 33.768015, lng: -118.180458 },
  { id: "bonito-2-doors-north", name: "Bonito Ave", cross: "~2 doors north of 144", area: "Bonito Ave", featured: false, lat: 33.768314, lng: -118.180389 },
];

// Creates tables and seeds the starting Bonito Ave spots on first use, so
// connecting a fresh Neon database needs no manual SQL setup.
export async function ensureSchema() {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    const sql = getSql();

    await sql`
      CREATE TABLE IF NOT EXISTS spots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cross_streets TEXT NOT NULL,
        area TEXT NOT NULL,
        featured BOOLEAN NOT NULL DEFAULT false,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        spot_id TEXT NOT NULL REFERENCES spots(id),
        type TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        reporter_lat DOUBLE PRECISION,
        reporter_lng DOUBLE PRECISION,
        distance_meters DOUBLE PRECISION
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_reports_spot_id ON reports(spot_id)`;

    const [{ count }] = await sql`SELECT count(*)::int AS count FROM spots`;
    if (count === 0) {
      for (const spot of SEED_SPOTS) {
        await sql`
          INSERT INTO spots (id, name, cross_streets, area, featured, lat, lng)
          VALUES (${spot.id}, ${spot.name}, ${spot.cross}, ${spot.area}, ${spot.featured}, ${spot.lat}, ${spot.lng})
          ON CONFLICT (id) DO NOTHING
        `;
      }
    }
  })();

  return schemaReady;
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export { getSql };
