import { S3Client } from '@aws-sdk/client-s3';

// the buckets of the tables (R2_BUCKET) and of the noise samples (R2_NOISES_BUCKET), Cloudflare R2 through its S3
// API: their lists (the browser fetches the files from their custom domains)
export const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID ?? ''}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
});

export const getHeaders = () => {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTION',
  };
};

// the answer of a list that failed (R2 unreachable, its variables missing): logged, no error or trace sent (Netlify
// would answer a function that threw with its message and stack)
export const serverError = (error: unknown) => {
  console.error(error);
  return { statusCode: 500, headers: getHeaders(), body: JSON.stringify({ error: 'Internal error' }) };
};
