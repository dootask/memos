import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { createServer } from './server.js';

const cfg = loadConfig();
const { server, users } = createServer(cfg, logger);

server.listen(cfg.port, () => {
  logger.info(
    { port: cfg.port, memos: cfg.memosUpstream, dootask: cfg.dootaskUrl, admins: cfg.adminUserIds },
    'memos auth proxy listening',
  );
});

// Seed admins in the background; retry a few times while Memos finishes booting.
(async () => {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await users.seedAdmins();
      return;
    } catch (err) {
      logger.warn({ attempt, err: (err as Error).message }, 'admin seeding attempt failed');
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  logger.error('admin seeding gave up after retries');
})();

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
