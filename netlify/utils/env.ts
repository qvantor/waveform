export const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`env variable ${name} is not set`);
  return value;
};

export const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
