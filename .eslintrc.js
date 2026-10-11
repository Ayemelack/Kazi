module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['server/', '**/dist/'],
  overrides: [
    {
      files: ['jest.setup.js', 'jest/**/*.js'],
      env: {
        jest: true,
      },
      globals: {
        jest: 'readonly',
      },
    },
  ],
};