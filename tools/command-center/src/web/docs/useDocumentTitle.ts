import { useEffect } from 'react';
import { APP_NAME } from '../../shared/types';

/**
 * Sets the title of the browser tab while the page that calls it is shown, as "<title> · <app name>",
 * and puts the old title back when that page goes away. The tab title is what a person sees in the
 * tab strip and in the browser history, so each doc must have its own.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const before = document.title;
    document.title = `${title} · ${APP_NAME}`;
    return () => {
      document.title = before;
    };
  }, [title]);
}
