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
    log('Handling Origin Request Event', event);
    const { config, request } = event.Records[0].cf;
    if (config.eventType.toLowerCase() !== 'origin-request') {
      return log('Invalid Event Type', { status: '500', statusDescription: 'Invalid Event Type' });
    }
    const { s3 } = request.origin;
    if (!s3) {
      return log('Invalid Origin Type', { status: '500', statusDescription: 'Invalid Origin Type' });
    }

    const targetHost = request.headers['host'][0].value;
    const baseHost = s3.customHeaders['x-base-host'][0].value;
    const hostDiff = targetHost.length - baseHost.length;
    const subDomain = hostDiff > 0 ? targetHost.substring(0, hostDiff - 1) : 'www';
    const s3Path = path.join(s3.path, subDomain).replace(/\/$/i, '');

    const customHost =
      s3.customHeaders[`x-origin-${subDomain.toLowerCase()}`]?.[0]?.value ??
      s3.customHeaders[`X-Origin-${subDomain.toUpperCase()}`]?.[0]?.value ??
      null;
    if (!!customHost) {
      const opts = urlToHttpOptions(new URL(customHost));
      log('Redirecting Request to Custom Origin');
      Reflect.deleteProperty(request.origin, 's3');
      const uri = opts.path.split('/').pop();
      request.origin.custom = {
        path: opts.path.split('/').reverse().splice(1).reverse().join('/'),
        readTimeout: 30,
        keepaliveTimeout: 5,
        domainName: opts.hostname,
        customHeaders: s3.customHeaders,
        port: parseInt(`${opts.port ?? '443'}`),
        sslProtocols: ['TLSv1', 'TLSv1.1', 'TLSv1.2'],
        protocol: 'https',
      };
      request.uri = `/${uri}`;
      request.headers['host'][0].value = opts.hostname;
    } else {
      log('Redirecting Request to S3 Origin Path');

      request.origin.s3.path = s3Path;
      request.headers['host'][0].value = request.origin.s3.domainName;
    }

    request.headers['x-target-domain'] = [{ value: targetHost }];
    return log('Responding with Modified Request', request);
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
