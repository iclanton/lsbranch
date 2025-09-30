const nodeProfile = require('@rushstack/eslint-config/flat/profile/node');

module.exports = [
  ...nodeProfile,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: __dirname
      }
    }
  }
];
