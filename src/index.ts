import path from 'path';
import { urlToHttpOptions } from 'url';
import { CloudFrontRequestEvent, CloudFrontRequestResult } from 'aws-lambda';

export async function handler(event: CloudFrontRequestEvent): Promise<CloudFrontRequestResult> {
  const log = (message: string, context: any) => {
    console.info(
      JSON.stringify({
        message,
        context,
      })
    );
  };

  try {
    const { config, request } = event.Records[0].cf;
    log(`Handling request origin-request.`, { request, config });
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
    const s3Path = path.join(s3.path, subDomain).replace(/\/$/i, '');

    const customHost = request.headers[`X-Origin-${subDomain.toUpperCase()}`]?.[0]?.value ?? null;
    if (!!customHost) {
      log('Redirecting request to custom origin', { s3Path, request });
      const opts = urlToHttpOptions(new URL(customHost));
      Reflect.deleteProperty(request.origin, 's3');
      request.origin.custom = {
        path: opts.path,
        readTimeout: 30,
        keepaliveTimeout: 5,
        domainName: opts.hostname,
        customHeaders: s3.customHeaders,
        port: parseInt(opts.port.toString() ?? '443'),
        sslProtocols: ['TLSv1', 'TLSv1.1', 'TLSv1.2'],
        protocol: opts.protocol == 'https' ? opts.protocol : 'https',
      };
      request.headers['host'][0].value = opts.hostname;
    } else {
      log('Redirecting request to S3 origin path', { s3Path, request });

      request.origin.s3.path = s3Path;
      request.headers['host'][0].value = request.origin.s3.domainName;
    }

    request.headers['x-target-domain'] = [{ value: targetHost }];
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
