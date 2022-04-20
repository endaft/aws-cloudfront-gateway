import path from 'path';
import { S3 } from 'aws-sdk';
import { CloudFrontRequestEvent, CloudFrontRequestResult } from 'aws-lambda';

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
    return {
      status: '200',
      statusDescription: 'OK',
      headers: {
        etag: [{ value: s3Data.ETag }],
        'content-type': [{ value: s3Data.ContentType }],
        'last-modified': [{ value: s3Data.LastModified.toUTCString() }],
      },
      body: s3Data.Body.toString(),
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
