import { S3Client } from '@aws-sdk/client-s3';

export const client = new S3Client({
  region: 'eu-central-1',
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

export const getHeaders = () => {
  if (process.env.URL.includes('localhost'))
    return {
      'Access-Control-Allow-Origin': '*',
    };
};
