import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

// 화면이 몇 개뿐이라 라이브러리 없이 History API로 옮겨 다닌다.

const listeners = new Set<() => void>();

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.scrollTo(0, 0);
  for (const listener of listeners) listener();
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const read = () => ({ path: location.pathname, query: new URLSearchParams(location.search) });
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return value;
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
