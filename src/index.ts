import path from 'path';
import { urlToHttpOptions } from 'url';
import { CloudFrontRequestEvent, CloudFrontRequestResult } from 'aws-lambda';

export async function handler(event: CloudFrontRequestEvent): Promise<CloudFrontRequestResult> {
  const log = <T>(message: string, context?: T) => {
    console.info(
      JSON.stringify({
        message,
        context,
      })
    );
    return context;
  };

  try {
    log('Received Origin Request Event', event);
    const { config, request } = event.Records[0].cf;
    if (config.eventType.toLowerCase() !== 'origin-request') {
      return log('Invalid Event Type', { status: '500', statusDescription: 'Invalid Event Type' });
    }

    const { s3, custom } = request.origin;
    if (!s3 && !custom) {
      return log('Invalid Origin Type', { status: '500', statusDescription: 'Invalid Origin Type' });
    }

    const targetHost = request.headers['host'][0].value;
    if (!!s3) {
      const baseHost = s3.customHeaders['x-base-host'][0].value;
      const hostDiff = targetHost.length - baseHost.length;
      const subDomain = hostDiff > 0 ? targetHost.substring(0, hostDiff - 1) : 'www';
      const s3Path = path.join(s3.path, subDomain).replace(/\/$/i, '');

      log('Updating the S3 Origin Path');
      request.origin.s3.path = s3Path;
      request.headers['host'][0].value = request.origin.s3.domainName;
    } else {
      log('Updated Custom Origin Request');
      /**
       * ! Make this ENSURE the correct custom origin every time
       * ! to prevent excessive origin usage and billing
       */
      request.headers['host'][0].value = request.origin.custom.domainName;
    }

    request.headers['x-target-domain'] = [{ value: targetHost }];
    return log('Responding with Request', request);
  } catch (e) {
    const errorData = log('Fatal Error Encountered', {
      error: [...((e.stack as string) ?? e.toString()).split('\n')],
      event,
    });
    return {
      status: '500',
      statusDescription: 'Server Error',
      body: JSON.stringify(errorData),
    };
  }
}
