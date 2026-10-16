import React from 'react';
import styled from 'styled-components';
import { Turnstile } from '@marsidev/react-turnstile';
import { usePresetUsageTracker, UsageEvent } from '../hooks/use-preset-usage-tracker';
import { sendUsage, TURNSTILE_SITE_KEY } from '../services';

// a token not given by then (the script didn't load) drops the event
export const CAPTCHA_TIMEOUT_MS = 30 * 1000;

// out of the layout of the section, it is never shown
const Captcha = styled(Turnstile)`
  position: fixed;
`;

interface Pending {
  key: number;
  usage: UsageEvent;
}

const without = (pending: Pending) => (queue: Pending[]) => queue.filter((item) => item !== pending);

// sends the listens and stays of usePresetUsageTracker, each with a Turnstile token of its own: a listener is an IP
// (an IPv6 /64, see ipKey), a host with a /56 would be 256 of them. One at a time, a widget is created for an event
// and removed once it is sent (the script loads with the first one). The visitor never sees it: an event Cloudflare
// would ask to interact for, a failed or timed out check is dropped, the next one gets a new widget
export const UsageReporter = () => {
  const [queue, setQueue] = React.useState<Pending[]>([]);
  const nextKey = React.useRef(0);

  usePresetUsageTracker((usage) => {
    const key = nextKey.current++;
    setQueue((queue) => [...queue, { key, usage }]);
  });

  const head = queue[0];

  React.useEffect(() => {
    if (!head) return undefined;
    const timeout = setTimeout(() => setQueue(without(head)), CAPTCHA_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [head]);

  if (!head) return null;
  const drop = () => setQueue(without(head));
  return (
    <Captcha
      key={head.key}
      id='usage-captcha'
      siteKey={TURNSTILE_SITE_KEY}
      options={{ appearance: 'interaction-only' }}
      onSuccess={(turnstileToken) => {
        sendUsage({ ...head.usage, turnstileToken }).catch(() => undefined);
        drop();
      }}
      onBeforeInteractive={drop}
      onError={drop}
      onUnsupported={drop}
    />
  );
};
