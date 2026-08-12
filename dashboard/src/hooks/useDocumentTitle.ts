import { useEffect } from 'react';

/**
 * Custom hook to set document title dynamically.
 * Automatically appends " | OpenWA PAMGM" suffix.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | OpenWA PAMGM`;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
