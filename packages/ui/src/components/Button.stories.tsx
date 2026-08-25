// SPDX-License-Identifier: Apache-2.0
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'Button',
  component: Button,
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: 'Log in' },
};

export const Outline: Story = {
  args: { children: 'Cancel', variant: 'outline' },
};

export const Ghost: Story = {
  args: { children: 'Skip', variant: 'ghost' },
};

export const Destructive: Story = {
  args: { children: 'Delete', variant: 'destructive' },
};
