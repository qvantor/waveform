import { Observable } from 'rxjs';

// a load as an observable: its value, then complete, or its error; unsubscribed before it settles (a switchMap to a
// newer path, the model stopped) its signal aborts it. Each subscription starts it again (retry)
export const abortable = <T>(start: (signal: AbortSignal) => Promise<T>) =>
  new Observable<T>((subscriber) => {
    const controller = new AbortController();
    let settled = false;
    // (a throw of start is its error, as of defer)
    new Promise<T>((resolve) => resolve(start(controller.signal))).then(
      (value) => {
        settled = true;
        subscriber.next(value);
        subscriber.complete();
      },
      (error) => {
        settled = true;
        subscriber.error(error);
      }
    );
    return () => {
      if (!settled) controller.abort();
    };
  });
