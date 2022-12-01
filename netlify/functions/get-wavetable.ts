import { Handler } from '@netlify/functions';
import { getHeaders, client } from '../utils';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

const handler: Handler = async (event) => {
  if (typeof event.queryStringParameters.id !== 'string') return { statusCode: 400 };
  const { id: Key } = event.queryStringParameters;
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: process.env.BUCKET,
      Key,
    }),
      { expiresIn: 21600 }
  );
  return {
    statusCode: 200,
    httpMethod: 'POST',
    headers: {
      ...getHeaders(),
    },
    body: url,
  };
};

export { handler };
