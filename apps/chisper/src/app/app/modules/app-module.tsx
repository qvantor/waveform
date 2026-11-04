import { fromEvent, filter, tap, share } from 'rxjs';
import { rxModel, rxModelReact } from '@chisper/rxjs-react';

export const appModel = () => {
  return rxModel(() => {
    const $keyDown = fromEvent<KeyboardEvent>(document, 'keydown');
    return {
      $keyDown,
      $keyUp: fromEvent<KeyboardEvent>(document, 'keyup'),
      // on the window: after every listener of the document, so it sees the keys a control took there too (a
      // keyboard drag of dnd-kit listens on the document from its start, after the app)
      $windowKeyDown: fromEvent<KeyboardEvent>(window, 'keydown'),
      // the window loses focus (another app, another tab): the keys held now get their keyup elsewhere
      $blur: fromEvent(window, 'blur'),
      // Cmd/Ctrl+S
      $saveRequest: $keyDown.pipe(
        filter((e) => (e.metaKey || e.ctrlKey) && e.code === 'KeyS'),
        tap((e) => e.preventDefault()),
        share()
      ),
    };
  });
};

export const { ModelProvider: AppProvider, useModel: useApp } = rxModelReact('appModel', appModel);

export type AppModule = ReturnType<typeof useApp>;
