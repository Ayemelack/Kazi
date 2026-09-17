const React = require('react');
const { View } = require('react-native');

const LucideIcon = props => React.createElement(View, props);

module.exports = new Proxy(
  {},
  {
    get: () => LucideIcon,
  },
);