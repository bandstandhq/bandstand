// SPDX-License-Identifier: Apache-2.0
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Resolves the absolute path of a package. Needed in monorepos where
 * Storybook's addons aren't hoisted to a location it'd find by default.
 */
function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [getAbsolutePath('@storybook/addon-a11y'), getAbsolutePath('@storybook/addon-docs')],
  framework: getAbsolutePath('@storybook/react-vite'),
  viteFinal: async (viteConfig) => {
    viteConfig.plugins ??= [];
    viteConfig.plugins.push(tailwindcss());
    return viteConfig;
  },
};

export default config;
