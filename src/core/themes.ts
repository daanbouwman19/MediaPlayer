/**
 * @file defines available themes and their metadata.
 */

export interface Theme {
  id: string;
  label: string;
  base: 'light' | 'dark' | 'system';
}

export const AVAILABLE_THEMES: Theme[] = [
  {
    id: 'system',
    label: 'System',
    base: 'system',
  },
  {
    id: 'light',
    label: 'Light',
    base: 'light',
  },
  {
    id: 'dark',
    label: 'Dark',
    base: 'dark',
  },
  {
    id: 'pink',
    label: 'Pink',
    base: 'light',
  },
];

export type ThemeId = (typeof AVAILABLE_THEMES)[number]['id'];
