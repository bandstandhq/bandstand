// SPDX-License-Identifier: Apache-2.0
import type { Preview } from '@storybook/react-vite';
import './preview.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // 'todo' shows violations in the test UI only; switch to 'error' once
      // the design system is further along to fail CI on regressions.
      test: 'todo',
    },
  },
};

export default preview;
