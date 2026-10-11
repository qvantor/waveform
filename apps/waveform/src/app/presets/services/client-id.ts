const CLIENT_ID_KEY = 'clientId';

// anonymous id, used only to count unique users of presets
export const getClientId = () => {
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
};
