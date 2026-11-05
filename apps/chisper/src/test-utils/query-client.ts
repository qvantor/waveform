import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// a query client of its own (no retries: a failed query fails at once) and a wrapper of renderHook with it
export const queryWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: React.PropsWithChildren) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
};

// the answer of fetch with this status and JSON body
export const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as Response;
