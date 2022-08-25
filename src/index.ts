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

    const origin = request.origin.s3 ?? request.origin.custom;
    if (!origin) {
      return log('Invalid Origin Type', { status: '500', statusDescription: 'Invalid Origin Type' });
    }

    const targetHost = request.headers['host'][0].value;
    const isS3Request = Object.hasOwn(request.origin, 's3');
    const baseHost = origin.customHeaders['x-base-host'][0].value;
    const hostDiff = targetHost.length - baseHost.length;
    const subDomain = hostDiff > 0 ? targetHost.substring(0, hostDiff - 1) : 'www';

    request.headers['host'][0].value = origin.domainName;
    request.headers['x-target-domain'] = [{ value: targetHost }];

    if (isS3Request) {
      log('Updating the S3 Origin Path');
      request.origin.s3.path = path.join(origin.path, subDomain).replace(/\/$/i, '');
    } else {
      log('Updated Custom Origin Request');
      const pathVarExp = /(\/\{.+\})/gim;
      const customEndpoint =
        origin.customHeaders[`x-origin-${subDomain.toLowerCase()}`]?.[0]?.value ??
        origin.customHeaders[`X-Origin-${subDomain.toUpperCase()}`]?.[0]?.value ??
        null;
      const customHost = customEndpoint.replace(pathVarExp, '');
      const opts = urlToHttpOptions(new URL(customHost));
      const uri = opts.path.split('/').pop();

      request.origin.custom = {
        path: opts.path.split('/').reverse().splice(1).reverse().join('/'),
        readTimeout: 30,
        keepaliveTimeout: 5,
        domainName: opts.hostname,
        customHeaders: origin.customHeaders,
        port: parseInt(`${opts.port ?? '443'}`),
        sslProtocols: ['TLSv1', 'TLSv1.1', 'TLSv1.2'],
        protocol: 'https',
      };
    }

    return log('Responding With Request', request);
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
