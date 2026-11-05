import React from 'react';

interface Props {
  onSuccess?: (token: string) => void;
  onError?: (code: string) => void;
  onBeforeInteractive?: () => void;
  onUnsupported?: () => void;
}

// stands in for @marsidev/react-turnstile: buttons resolve or fail the captcha, ask to interact or report an
// unsupported browser
export const Turnstile = React.forwardRef<{ reset: () => void }, Props>(
  ({ onSuccess, onError, onBeforeInteractive, onUnsupported }, ref) => {
    React.useImperativeHandle(ref, () => ({ reset: jest.fn() }));
    return (
      <>
        <button type='button' onClick={() => onSuccess?.('captcha-token')}>
          Pass captcha
        </button>
        <button type='button' onClick={() => onError?.('110200')}>
          Fail captcha
        </button>
        <button type='button' onClick={() => onBeforeInteractive?.()}>
          Ask to interact
        </button>
        <button type='button' onClick={() => onUnsupported?.()}>
          Unsupported captcha
        </button>
      </>
    );
  }
);
