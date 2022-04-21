import path from 'path';
import { S3 } from 'aws-sdk';
import { CloudFrontRequestEvent, CloudFrontRequestResult } from 'aws-lambda';

const TextTypes = {
  MimeStart: ['text'],
  MimeEnd: ['json', 'xml', 'html', 'css', 'csv'],
};

type EncodedBody = { body: string; bodyEncoding: 'text' | 'base64' };

function encodeBody(data: S3.GetObjectOutput): EncodedBody {
  const contentType = data.ContentType ?? 'application/octet-stream';
  const mimeParts = contentType.toLowerCase().split('/');
  const prefix = mimeParts.shift();
  const suffix = mimeParts.pop();
  const isText = TextTypes.MimeStart.includes(prefix) || TextTypes.MimeEnd.includes(suffix);
  return {
    body: data.Body.toString(isText ? 'utf-8' : 'base64'),
    bodyEncoding: isText ? 'text' : 'base64',
  };
}

export async function handler(event: CloudFrontRequestEvent): Promise<CloudFrontRequestResult> {
  try {
    const { config, request } = event.Records[0].cf;
    if (config.eventType.toLowerCase() !== 'origin-request') {
      return { status: '500', statusDescription: 'Invalid event type.' };
    }
    const { s3 } = request.origin;
    if (!s3) {
      return { status: '500', statusDescription: 'Invalid origin type.' };
    }
    const bucketRegion = s3.region;
    const targetHost = request.headers['host'][0].value;
    const baseHost = s3.customHeaders['x-base-host'][0].value;
    const bucketName = s3.domainName.replace('.s3.amazonaws.com', '');
    const hostDiff = targetHost.length - baseHost.length;
    const subDomain = hostDiff > 0 ? targetHost.substring(0, hostDiff - 1) : 'www';
    const s3Path = path.join(s3.path.substring(1), subDomain, request.uri);
    const client = new S3({ region: bucketRegion });
    const s3Data = await client.getObject({ Bucket: bucketName, Key: s3Path }).promise();
    const { body, bodyEncoding } = encodeBody(s3Data);
    return {
      status: '200',
      statusDescription: 'OK',
      headers: {
        etag: [{ value: s3Data.ETag }],
        'content-type': [{ value: s3Data.ContentType }],
        'last-modified': [{ value: s3Data.LastModified.toUTCString() }],
      },
      body,
      bodyEncoding,
    };
  } catch (e) {
    return {
      status: '500',
      statusDescription: 'Server Error',
      body: JSON.stringify({
        error: [...((e.stack as string) ?? e.toString()).split('\n')],
        event,
      }),
    };
  }
}
