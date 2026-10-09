import React, { memo } from 'react';

const paths = {
  bowl: 'M3 12h18c-1 6-4 9-9 9s-8-3-9-9ZM6 21h12M7 3c-3 3 3 3 0 6m5-7c-3 3 3 3 0 6m5-5c-3 3 3 3 0 6',
  book: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15M6 8h3m6 0h3M6 12h3m6 0h3',
  bag: 'M5 8h14l2 13H3L5 8Zm3 0V6a4 4 0 0 1 8 0v2M9 13v1m6-1v1m-6 3q3 2 6 0',
  game: 'M7 7h10c4 0 5 5 5 10 0 4-4 2-6-1H8c-2 3-6 5-6 1 0-5 1-10 5-10ZM6 11v4m-2-2h4m7-1h.1m3 2h.1M12 3v4',
  plane: 'm21 3-6 18-4-8-8-4 18-6Zm0 0L11 13M3 16l3-1m1 6 1-3',
  spark: 'm12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Zm7 0v4m-2-2h4M3 19v3m-1.5-1.5h3',
  heart: 'M12 20C-5 10 5-3 12 6c7-9 17 4 0 14Z',
  coffee: 'M4 9h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Zm13 1h2a3 3 0 0 1 0 6h-2M7 2c-2 2 2 3 0 5m5-5c-2 2 2 3 0 5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  edit: 'm15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z',
  backspace: 'm9 5-7 7 7 7h11V5Zm3 4 6 6m0-6-6 6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 6-5 12 0 18 5-6 5-12 0-18Z',
  face: 'M8 9v2m8-2v2m-7 4q3 3 6 0',
};
export const Icon = memo(function Icon({ name, ...props }) {
  return <svg className="for-icon" viewBox="0 0 24 24" aria-hidden="true" {...props}><path d={paths[name] || paths.spark} /></svg>;
});
export const Mascot = memo(function Mascot({ mascotRef }) {
  return <svg ref={mascotRef} className="mascot" id="mascot" viewBox="0 0 130 126" aria-hidden="true"><path className="mascot-body" d="M24 53C16 18 48 7 68 18C86-1 121 23 107 52C130 74 113 107 87 101C70 128 38 116 35 98C4 105-5 68 24 53Z"/><path d="M45 58v7m28-10v7" className="face-eyes"/><path d="M50 78q10 10 20-3" className="face-mouth"/><ellipse cx="35" cy="74" rx="7" ry="4" fill="#ed885f"/><ellipse cx="88" cy="72" rx="7" ry="4" fill="#ed885f"/></svg>;
});

