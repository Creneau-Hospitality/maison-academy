import { useEffect, useState } from 'react';

/** Tiny path router: no extra dependency. */
export function navigate(to: string) {
  if (to === location.pathname + location.search) return;
  history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => {
    const on = () => setPath(location.pathname + location.search);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

/** Link that uses the router; still a real link for right-click and keyboard. */
export function linkProps(to: string) {
  return {
    href: to,
    onClick: (e: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => {
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
