const enabled = process.env.RUN_DB_TESTS === '1';

if (enabled) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required when RUN_DB_TESTS=1.');

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL connection string.');
  }

  if (!/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to run database tests against "${databaseName}". ` +
        'Tests must use a dedicated database whose name contains "test" ' +
        '(for example maxcare_test). Run "npm run test:db" with TEST_DATABASE_URL and TEST_DIRECT_URL, ' +
        'or rename the CI database to maxcare_test.',
    );
  }
}

export {};
