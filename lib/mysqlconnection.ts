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











// import mysql from 'mysql2/promise';

// let mysqlPoolConnection: mysql.Pool;

// async function initMySQLConnection(): Promise<void> {
//   try {
//     mysqlPoolConnection = mysql.createPool({
//       host: process.env.DB_HOST || 'localhost',
//       user: process.env.DB_USER || 'cylindtrack',
//       password: process.env.DB_PASSWORD || '0]@3V9(em;2S[-+g',
//       database: process.env.DB_NAME || 'jrcapitalco_cylindtrack',
//       waitForConnections: true,
//     });

//     // Test the connection
//     const connection = await mysqlPoolConnection.getConnection();
//     console.log('✅ MySQL connected successfully.');
//     connection.release();
//   } catch (error) {
//     console.error('❌ Error connecting to MySQL:', error instanceof Error ? error.message : error);
//     process.exit(1);
//   }
// }

// // Initialize the connection when the module is loaded
// initMySQLConnection().catch(console.error);

// export function getMySQLPoolConnection(): mysql.Pool {
//   if (!mysqlPoolConnection) {
//     throw new Error('MySQL pool has not been initialized yet.');
//   }
//   return mysqlPoolConnection;
// }

// ==========

// update the all connection to be able to run on : psql 'postgresql://cylindetrack_owner:npg_NiWwvF4cyX0m@ep-patient-leaf-a84re0qa-pooler.eastus2.azure.neon.tech/cylindetrack?sslmode=require&channel_binding=require'