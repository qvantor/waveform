import { Handler } from '@netlify/functions';
import { ListObjectsV2Command, _Object } from '@aws-sdk/client-s3';
import { getHeaders, client } from '../utils';
import { listToTree } from '../utils/tree';

// the samples of the noise oscillator (the bucket R2_NOISES_BUCKET, scripts/noises/upload.mjs puts them there) as
// a tree of their folders (its categories), every page of the list; a leaf is its key and size
const handler: Handler = async () => {
  const samples: _Object[] = [];
  let ContinuationToken: string | undefined;
  do {
    const result = await client.send(
      new ListObjectsV2Command({ Bucket: process.env.R2_NOISES_BUCKET, ContinuationToken })
    );
    (result.Contents ?? []).forEach(({ Key, Size }) => {
      if (Key && !Key.endsWith('/')) samples.push({ Key, Size });
    });
    ContinuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return {
    statusCode: 200,
    headers: getHeaders(),
    body: JSON.stringify(listToTree(samples)),
  };
};

export { handler };
