import "dotenv/config";
// Tests use the separate test database.
if (process.env.DATABASE_URL) process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/pharmastock$/, "/pharmastock_test");
if (process.env.APP_DATABASE_URL) process.env.APP_DATABASE_URL = process.env.APP_DATABASE_URL.replace(/\/pharmastock$/, "/pharmastock_test");
