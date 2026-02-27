// Backend configuration

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  
  // Database
  dbPath: process.env.DB_PATH || './data/construct.db',
  
  // JWT
  jwtSecret: process.env.JWT_SECRET || 'construct-computer-jwt-secret-change-in-production',
  jwtExpiry: process.env.JWT_EXPIRY || '7d',
  
  // Encryption
  encryptionKey: process.env.ENCRYPTION_KEY || 'construct-computer-default-key-32b',
  
  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(','),
  
  // Environment
  isDev: process.env.NODE_ENV !== 'production',
};

export function validateConfig(): void {
  if (config.jwtSecret === 'construct-computer-jwt-secret-change-in-production' && !config.isDev) {
    console.warn('WARNING: Using default JWT secret in production!');
  }
  
  if (config.encryptionKey === 'construct-computer-default-key-32b' && !config.isDev) {
    console.warn('WARNING: Using default encryption key in production!');
  }
}

export function logConfig(): void {
  console.log('Configuration:');
  console.log(`  Port: ${config.port}`);
  console.log(`  Host: ${config.host}`);
  console.log(`  Database: ${config.dbPath}`);
  console.log(`  CORS Origins: ${config.corsOrigins.join(', ')}`);
  console.log(`  Environment: ${config.isDev ? 'development' : 'production'}`);
}
