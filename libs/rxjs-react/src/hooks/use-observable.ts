import React from 'react';
import { Observable } from 'rxjs';

export const useObservable = <T>(observable: Observable<T>, initialValue: T): T => {
  const [value, setValue] = React.useState<T>(initialValue);
  React.useEffect(() => {
    const subscription = observable.subscribe(setValue);
    return () => {
      subscription.unsubscribe();
    };
  }, [observable, setValue]);
  return value;
};
