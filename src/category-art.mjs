import { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '../public/shared.mjs';

const presets = new Map([...DEFAULT_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES].map(category => [category.id, category]));

// Pictures decorate the original preset. A custom icon or color is an
// explicit user choice, including a historical snapshot: keep it intact.
export function categoryArtworkKey(category) {
  const preset = presets.get(category?.id);
  return preset && preset.icon === category.icon && preset.color === category.color ? preset.id : null;
}
