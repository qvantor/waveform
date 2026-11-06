// a response that is ok, else an error with its url and status (the load fails, react-query retries it)
export const fetchOk = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res;
};

// the list a function answers as JSON; anything else is an error, as a status that isn't ok (a function that threw:
// Netlify's {errorType, errorMessage}), so a selector stays without options instead of mapping it
export const fetchList = async <T>(url: string): Promise<T[]> => {
  const data: unknown = await (await fetchOk(url)).json();
  if (!Array.isArray(data)) throw new Error(`${url} answered no list`);
  return data;
};
