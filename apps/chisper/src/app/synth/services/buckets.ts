// the buckets of R2 on custom domains of their own: public, their CORS policy a GET from any origin. The files are
// fetched from there, the lists of the buckets from the functions (a domain lists nothing). No imports: the scripts
// of the benches take it too (Node strips its types)
export const WAVETABLES_ORIGIN = 'https://wavetables.chisper.qvantor.org';
export const NOISES_ORIGIN = 'https://noises.chisper.qvantor.org';

// the same files through the site (the rewrites of netlify.toml), where the domains don't load
export const WAVETABLES_PROXY = '/files/wavetables';
export const NOISES_PROXY = '/files/noises';

// the url of an object by its key: the slashes of the key are the path, each part of it encoded (a space, & and #)
export const bucketUrl = (origin: string, key: string) =>
  `${origin}/${key.split('/').map(encodeURIComponent).join('/')}`;
