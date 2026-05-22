/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 30000,
  forceExit: true,
  collectCoverage: false, // enable with --coverage flag for coverage reports
  coverageReporters: ['lcov', 'text-summary'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'controllers/**/*.js',
    'models/**/*.js',
    'config/**/*.js',
    '!config/passport.js', // OAuth strategy — hard to unit test
  ],
};
