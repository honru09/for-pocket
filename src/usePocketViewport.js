import { useEffect } from 'react';

// The Mini App viewport excludes Telegram's own title/footer chrome.
export default function usePocketViewport(telegram) {
  useEffect(() => {
    const update = () => {
      const browserHeight = window.visualViewport?.height || window.innerHeight;
      const appHeight = Math.min(telegram?.viewportStableHeight || browserHeight, browserHeight);
      document.documentElement.style.setProperty('--pocket-height', `${Math.round(appHeight)}px`);
      const shell = document.querySelector('.app-shell');
      const style = shell && getComputedStyle(shell);
      const insets = style ? (parseFloat(style.paddingTop) || 0) + Math.max(0, (parseFloat(style.paddingBottom) || 62) - 62) : 0;
      document.documentElement.dataset.pocketCompact = String(appHeight - insets < 568);
    };
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    telegram?.onEvent?.('viewportChanged', update);
    try { telegram?.ready?.(); telegram?.expand?.(); } catch {}
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      telegram?.offEvent?.('viewportChanged', update);
      document.documentElement.style.removeProperty('--pocket-height');
      delete document.documentElement.dataset.pocketCompact;
    };
  }, [telegram]);
}
