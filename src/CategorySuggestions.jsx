import React, { useMemo } from 'react';
import { Tappable } from '@telegram-apps/telegram-ui';
import { getCategorySuggestions } from '../public/category-suggestions.mjs';
import { Icon } from './icons.jsx';
import PocketIllustration from './PocketIllustration.jsx';
import './category-suggestions.css';

const COPY = {
  zh: { title:'常记的小事', hint:'点一下加入分类，保存后显示。', add:'添加分类：', count:n=>`${n} 笔` },
  en: { title:'Little regulars', hint:'Tap to add a category, then save.', add:'Add category: ', count:n=>`${n} entries` },
  uk: { title:'Звичні дрібниці', hint:'Додайте категорію та збережіть.', add:'Додати категорію: ', count:n=>`${n} записів` },
};

export default function CategorySuggestions({ categories, expenses, ledgerId, type, language, disabled, onAdd }) {
  const suggestions = useMemo(() => getCategorySuggestions(categories, expenses, {type, ledgerId}), [categories, expenses, ledgerId, type]);
  const copy = COPY[language] || COPY.zh;
  if (!suggestions.length) return null;
  return <section className="category-suggestions" aria-label={copy.title}>
    <header><PocketIllustration name="category-suggestions-tactile-v1" compact/><div><strong>{copy.title}</strong><span>{copy.hint}</span></div></header>
    <div>{suggestions.map(({label, count, icon, color}) => <Tappable Component="button" type="button" key={label}
      className="category-suggestion" disabled={disabled} aria-label={`${copy.add}${label}`} onClick={() => onAdd({label, icon, color})}>
      <Icon name="edit"/><span>{label}</span><small>{copy.count(count)}</small><span aria-hidden="true">＋</span>
    </Tappable>)}</div>
  </section>;
}
