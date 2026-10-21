import React, { memo, useState } from 'react';
import { Icon } from './icons.jsx';
import { categoryArtworkKey } from './category-art.mjs';

const images = import.meta.glob('../public/assets/category-art-v1/*.webp', { eager:true, query:'?url', import:'default' });

const CategoryArt = memo(function CategoryArt({ category, eager = false }) {
  const key = categoryArtworkKey(category);
  const source = key && images[`../public/assets/category-art-v1/${key}.webp`];
  const [failedSource, setFailedSource] = useState(null);
  if (!source || failedSource === source) return <Icon name={category?.icon || 'spark'}/>;
  return <img className="category-art" data-category-art={key} src={source} alt="" aria-hidden="true"
    width="32" height="32" loading={eager ? 'eager' : 'lazy'} decoding="async" draggable="false"
    onError={() => setFailedSource(source)}/>;
});

export default CategoryArt;
