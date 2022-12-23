import path from 'path';
import { urlToHttpOptions } from 'url';
import { CloudFrontRequestEvent, CloudFrontRequestResult } from 'aws-lambda';

export type LogLevel = keyof Console & ('debug' | 'info' | 'warn' | 'error' | 'log');

export async function handler(event: CloudFrontRequestEvent): Promise<CloudFrontRequestResult> {
  const log = <T>(message: string, context?: T, level: LogLevel = 'info') => {
    console[level](
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
      return log('Invalid Event Type', { status: '500', statusDescription: 'Invalid Event Type' }, 'error');
    }

    const isS3Request = Object.hasOwn(request.origin, 's3');
    const origin = request.origin.s3 ?? request.origin.custom;
    if (!origin) {
      return log('Invalid Origin Type', { status: '500', statusDescription: 'Invalid Origin Type' }, 'error');
    }

    const targetHost = request.headers['host'][0].value;
    const baseHost = origin.customHeaders['x-base-host'][0].value;
    const hostDiff = targetHost.length - baseHost.length;
    const subDomain = hostDiff > 0 ? targetHost.substring(0, hostDiff - 1) : 'www';

    request.headers['host'][0].value = origin.domainName;
    request.headers['x-target-domain'] = [{ value: targetHost }];

    if (isS3Request) {
      log('Updating the S3 Origin Path');
      request.origin.s3.path = path.join(origin.path, subDomain).replace(/\/$/i, '');
    } else {
      log('Updating Custom Origin Request');
      const pathVarExp = /(\/\{.+\})/gim;
      const headerSearch = `x-origin-${subDomain.toLowerCase()}`;
      const headerKey = Object.keys(origin.customHeaders)
        .filter((k) => headerSearch === k.toLowerCase())
        .pop();
      const customEndpoint = origin.customHeaders[headerKey]?.[0]?.value;
      if (!!customEndpoint) {
        const customHost = customEndpoint.replace(pathVarExp, '');
        const opts = urlToHttpOptions(new URL(customHost));

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
    }

    return log('Responding With Request', request);
  } catch (e) {
    const errorData = log(
      'Fatal Error Encountered',
      {
        error: [...((e.stack as string) ?? e.toString()).split('\n')],
        event,
      },
      'error'
    );
    return {
      status: '500',
      statusDescription: 'Server Error',
      body: JSON.stringify(errorData),
      headers: {
        'Content-Type': [{ value: 'application/json' }],
      },
    };
  }
}
