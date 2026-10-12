import React from 'react';

interface Props {
  onSuccess?: (token: string) => void;
  onError?: (code: string) => void;
}

// stands in for @marsidev/react-turnstile: buttons resolve or fail the captcha
export const Turnstile = React.forwardRef<{ reset: () => void }, Props>(({ onSuccess, onError }, ref) => {
  React.useImperativeHandle(ref, () => ({ reset: jest.fn() }));
  return (
    <>
      <button type='button' onClick={() => onSuccess?.('captcha-token')}>
        Pass captcha
      </button>
      <button type='button' onClick={() => onError?.('110200')}>
        Fail captcha
      </button>
    </>
  );
});
