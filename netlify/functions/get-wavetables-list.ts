import { Handler } from '@netlify/functions';
import { ListObjectsCommand } from '@aws-sdk/client-s3';
import { getHeaders, client } from '../utils';
import { listToTree } from '../utils/tree';

// the wavetables of the bucket as a folder tree
const handler: Handler = async () => {
  const result = await client.send(new ListObjectsCommand({ Bucket: process.env.R2_BUCKET }));
  return {
    statusCode: 200,
    headers: getHeaders(),
    body: JSON.stringify(listToTree(result.Contents ?? [])),
  };
};

export { handler };
