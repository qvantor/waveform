import { Handler } from '@netlify/functions';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getHeaders, client } from '../utils';

// a signed url of a sample of the noise oscillator (`id` its key in R2_NOISES_BUCKET, which holds only them)
const handler: Handler = async (event) => {
  const Key = event.queryStringParameters?.id;
  if (typeof Key !== 'string' || Key === '' || Key.split('/').includes('..'))
    return { statusCode: 400, headers: getHeaders() };
  const Bucket = process.env.R2_NOISES_BUCKET;
  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn: 21600 });
  return {
    statusCode: 200,
    headers: getHeaders(),
    body: url,
  };
};

export { handler };
