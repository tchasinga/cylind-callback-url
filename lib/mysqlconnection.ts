import pg from 'pg';

// Create a PostgreSQL connection pool
const { Pool } = pg;
let pgPool: pg.Pool;

async function initPostgresConnection(): Promise<void> {
  try {
    // Connection configuration for Neon.tech
    const connectionString = 'postgresql://cylindetrack_owner:npg_NiWwvF4cyX0m@ep-patient-leaf-a84re0qa-pooler.eastus2.azure.neon.tech/cylindetrack?sslmode=require&channel_binding=require';
    
    pgPool = new Pool({
      connectionString,
      // Additional pool configuration
      max: 20, // maximum number of clients in the pool
    });

    // Test the connection
    const client = await pgPool.connect();
    console.log('✅ PostgreSQL connected successfully to Neon.tech');
    client.release();
  } catch (error) {
    console.error('❌ Error connecting to PostgreSQL:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Initialize the connection when the module is loaded
initPostgresConnection().catch(console.error);

export function getPostgresPoolConnection(): pg.Pool {
  if (!pgPool) {
    throw new Error('PostgreSQL pool has not been initialized yet.');
  }
  return pgPool;
}

// For backward compatibility (if you want to keep the same function name)
export const getMySQLPoolConnection = getPostgresPoolConnection;