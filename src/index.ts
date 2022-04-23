import path from 'path';
import { CloudFrontRequestEvent, CloudFrontRequestResult } from 'aws-lambda';

function log(message: string, context: any) {
  console.log(
    JSON.stringify({
      message,
      context,
    })
  );
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

    const targetHost = request.headers['host'][0].value;
    const baseHost = s3.customHeaders['x-base-host'][0].value;
    const hostDiff = targetHost.length - baseHost.length;
    const subDomain = hostDiff > 0 ? targetHost.substring(0, hostDiff - 1) : 'www';
    const s3Path = path.join(s3.path, subDomain);

    request.origin.s3.path = s3Path;
    request.headers['host'][0].value = request.origin.s3.domainName;
    request.headers['x-target-domain'] = [{ value: targetHost }];
    log('Redirecting request to origin path', { s3Path, request });

    return request;
  } catch (e) {
    log('Error encountered', {
      error: [...((e.stack as string) ?? e.toString()).split('\n')],
      event,
    });
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
