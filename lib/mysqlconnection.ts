import { Pool } from 'pg';

let pgPoolConnection: Pool;

async function initPostgresConnection(): Promise<void> {
  try {
    const connectionString = process.env.DB_URL || 'postgresql://cylindetrack_owner:npg_NiWwvF4cyX0m@ep-patient-leaf-a84re0qa-pooler.eastus2.azure.neon.tech/cylindetrack?sslmode=require&channel_binding=require';
    
    pgPoolConnection = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false 
      }
    });

    // Test the connection
    const client = await pgPoolConnection.connect();
    console.log('✅ PostgreSQL connected successfully.');
    client.release();
  } catch (error) {
    console.error('❌ Error connecting to PostgreSQL:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Initialize the connection when the module is loaded
initPostgresConnection().catch(console.error);

export function getPostgresPoolConnection(): Pool {
  if (!pgPoolConnection) {
    throw new Error('PostgreSQL pool has not been initialized yet.');
  }
  return pgPoolConnection;
}
