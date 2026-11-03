import React from 'react';

// useId of @rc-component/util (antd 6) gives every component the id 'test-id' under NODE_ENV=test: a tooltip and a
// modal shared it, and the name of the dialog was the text of the tooltip. The specs get the ids of React, unique
// as in a browser (test-setup.ts mocks the module with this one: antd imports it relatively too)
export const getId = (prefix: string, key: React.Key) =>
  `${prefix}-${String(key).replace(/[^a-zA-Z0-9_.:-]/g, '-')}`;

export const resetUuid = () => undefined;

const useId = (id?: string) => {
  const reactId = React.useId();
  return id || reactId;
};

export default useId;
