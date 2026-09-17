module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['server/', '**/dist/'],
  overrides: [
    {
      files: ['jest.setup.js'],
      env: {
        jest: true,
      },
      globals: {
        jest: 'readonly',
      },
    },
  ],
};