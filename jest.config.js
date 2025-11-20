module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/app.js',
    '!src/cli/**',
    '!src/electron/**',
    '!src/public/**',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(default-gateway)/)',
  ],
  testTimeout: 10000,
};
