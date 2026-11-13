import { useEffect, useState } from 'react';

/**
 * True from 1280 px up, where the Verification tab has room for the product's
 * screenshot beside the table. False on the server and on the first client
 * render, so the markup matches; it settles in an effect.
 */
export function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1280px)');
    const read = () => setWide(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);
  return wide;
}
