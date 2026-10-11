// KZ-30: unmount every tree a test rendered once the test ends.
//
// Screens start timers (toasts, tab transitions, animation loops, the
// connectivity poll). Left mounted, they fire after Jest tears the environment
// down ("import a file after the Jest environment has been torn down") or keep
// a single-file run from exiting. Test files share this module instance, so
// wrapping create() here covers every ReactTestRenderer.create call.
const ReactTestRenderer = require('react-test-renderer');

const mounted = new Set();
const create = ReactTestRenderer.create;

ReactTestRenderer.create = (...args) => {
  const renderer = create(...args);
  const unmount = renderer.unmount.bind(renderer);
  renderer.unmount = () => {
    mounted.delete(renderer);
    unmount();
  };
  mounted.add(renderer);
  return renderer;
};

afterEach(() => {
  for (const renderer of [...mounted]) {
    ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  }
});
