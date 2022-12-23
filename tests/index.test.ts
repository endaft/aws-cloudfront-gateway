import { randomUUID } from 'crypto';
import { handler, LogLevel } from '../src/index';
import {
  CloudFrontHeaders,
  CloudFrontOrigin,
  CloudFrontRequest,
  CloudFrontRequestEvent,
  CloudFrontRequestResult,
  CloudFrontResponse,
} from 'aws-lambda';

interface LogData {
  debug: string[];
  info: string[];
  warn: string[];
  error: string[];
  log: string[];
}

type LogTester = [LogData, (dump?: LogLevel[]) => void];
type CfEventType = 'origin-request' | 'origin-response' | 'viewer-request' | 'viewer-response';

describe('Basic Tests', () => {
  function makeLogData(): LogTester {
    const logData: LogData = {
      log: [],
      debug: [],
      info: [],
      warn: [],
      error: [],
    };
    const consoleSpyLog = jest.spyOn(console, 'log').mockImplementation((json: string) => logData.log.push(json));
    const consoleSpyDebug = jest.spyOn(console, 'debug').mockImplementation((json: string) => logData.debug.push(json));
    const consoleSpyInfo = jest.spyOn(console, 'info').mockImplementation((json: string) => logData.info.push(json));
    const consoleSpyWarn = jest.spyOn(console, 'warn').mockImplementation((json: string) => logData.warn.push(json));
    const consoleSpyError = jest.spyOn(console, 'error').mockImplementation((json: string) => logData.error.push(json));
    const reset = (dump: LogLevel[] = []) => {
      [consoleSpyLog, consoleSpyDebug, consoleSpyInfo, consoleSpyWarn, consoleSpyError].forEach((s) => {
        s.mockRestore();
      });
      for (const level of dump) {
        logData[level].forEach((v) => console[level](v));
      }
      logData.log.splice(0);
      logData.debug.splice(0);
      logData.info.splice(0);
      logData.warn.splice(0);
      logData.error.splice(0);
    };
    return [logData, reset];
  }
  function getCfReqEvent(
    domain: string,
    eventType: CfEventType,
    headers: CloudFrontHeaders = {},
    origin: CloudFrontOrigin = {} as CloudFrontOrigin
  ): CloudFrontRequestEvent {
    return {
      Records: [
        {
          cf: {
            config: {
              eventType: eventType,
              requestId: randomUUID(),
              distributionDomainName: domain,
              distributionId: randomUUID(),
            },
            request: {
              clientIp: '0.0.0.0',
              headers,
              method: 'GET',
              querystring: '',
              uri: '',
              origin,
            },
          },
        },
      ],
    };
  }

  it('Fails When Event Type Is Unexpected', async () => {
    const [logs, resetLogs] = makeLogData();
    try {
      let response: CloudFrontRequestResult;
      const event = getCfReqEvent('foo.com', 'viewer-request');
      const expectedError: CloudFrontResponse = {
        status: '500',
        statusDescription: 'Invalid Event Type',
        headers: {},
      };

      await expect(handler(event).then((r) => (response = r))).resolves.toBeDefined();

      expect(response).toBeDefined();
      expect(response).not.toBeNull();
      expect(logs.info).toHaveLength(1);
      expect(logs.info[0]).toMatch(/.*Received Origin Request Event.*/i);
      expect(logs.error).toHaveLength(1);
      expect(logs.error[0]).toMatch(/.*Invalid Event Type.*/i);

      const redirect = { headers: {}, ...JSON.parse(logs.error[0]).context } as CloudFrontResponse;
      expect(redirect).toMatchObject<CloudFrontResponse>(expectedError);
      expect(redirect).toMatchObject<CloudFrontResponse>(response as CloudFrontResponse);
    } finally {
      resetLogs();
    }
  });

  it('Fails When Request Origin Is Unexpected', async () => {
    const [logs, resetLogs] = makeLogData();
    try {
      let response: CloudFrontRequestResult;
      const event = getCfReqEvent('foo.com', 'origin-request');
      const expectedError: CloudFrontResponse = {
        status: '500',
        statusDescription: 'Invalid Origin Type',
        headers: {},
      };

      await expect(handler(event).then((r) => (response = r))).resolves.toBeDefined();

      expect(response).toBeDefined();
      expect(response).not.toBeNull();
      expect(logs.info).toHaveLength(1);
      expect(logs.info[0]).toMatch(/.*Received Origin Request Event.*/i);
      expect(logs.error).toHaveLength(1);
      expect(logs.error[0]).toMatch(/.*Invalid Origin Type.*/i);

      const redirect = { headers: {}, ...JSON.parse(logs.error[0]).context } as CloudFrontResponse;
      expect(redirect).toMatchObject<CloudFrontResponse>(expectedError);
      expect(redirect).toMatchObject<CloudFrontResponse>(response as CloudFrontResponse);
    } finally {
      resetLogs();
    }
  });

  it('Redirects Apex S3 Path As Expected', async () => {
    const [logs, resetLogs] = makeLogData();
    let response: CloudFrontRequestResult;
    try {
      const event = getCfReqEvent(
        'foo.com',
        'origin-request',
        {
          host: [{ value: 'foo.com' }],
        },
        {
          s3: {
            authMethod: 'none',
            region: 'uk-test',
            domainName: 'foo.com',
            path: '/sites',
            customHeaders: {
              'x-base-host': [{ value: 'foo.com' }],
            },
          },
        }
      );
      const expectedRedirect: CloudFrontRequest = {
        clientIp: '0.0.0.0',
        headers: { host: [{ value: 'foo.com' }], 'x-target-domain': [{ value: 'foo.com' }] },
        method: 'GET',
        querystring: '',
        uri: '',
        origin: {
          s3: {
            authMethod: 'none',
            region: 'uk-test',
            domainName: 'foo.com',
            path: '/sites/www',
            customHeaders: { 'x-base-host': [{ value: 'foo.com' }] },
          },
        },
      };

      await expect(handler(event).then((r) => (response = r))).resolves.toBeDefined();

      expect(response).toBeDefined();
      expect(response).not.toBeNull();
      expect(logs.info).toHaveLength(3);
      expect(logs.info[0]).toMatch(/.*Received Origin Request Event.*/i);
      expect(logs.info[1]).toMatch(/.*Updating the S3 Origin Path.*/i);
      expect(logs.info[2]).toMatch(/.*Responding With Request.*/i);

      const redirect = JSON.parse(logs.info[2]).context as CloudFrontRequest;
      expect(redirect).toMatchObject<CloudFrontRequest>(expectedRedirect);
      expect(redirect).toMatchObject<CloudFrontRequest>(response as CloudFrontRequest);
    } finally {
      resetLogs();
    }
  });

  it('Redirects Subdomain S3 Path As Expected', async () => {
    const [logs, resetLogs] = makeLogData();
    let response: CloudFrontRequestResult;
    try {
      const event = getCfReqEvent(
        'admin.foo.com',
        'origin-request',
        {
          host: [{ value: 'admin.foo.com' }],
        },
        {
          s3: {
            authMethod: 'none',
            region: 'uk-test',
            domainName: 'admin.foo.com',
            path: '/sites',
            customHeaders: {
              'x-base-host': [{ value: 'foo.com' }],
            },
          },
        }
      );
      const expectedRedirect: CloudFrontRequest = {
        clientIp: '0.0.0.0',
        headers: { host: [{ value: 'admin.foo.com' }], 'x-target-domain': [{ value: 'admin.foo.com' }] },
        method: 'GET',
        querystring: '',
        uri: '',
        origin: {
          s3: {
            authMethod: 'none',
            region: 'uk-test',
            domainName: 'admin.foo.com',
            path: '/sites/admin',
            customHeaders: { 'x-base-host': [{ value: 'foo.com' }] },
          },
        },
      };

      await expect(handler(event).then((r) => (response = r))).resolves.toBeDefined();

      expect(response).toBeDefined();
      expect(response).not.toBeNull();
      expect(logs.info).toHaveLength(3);
      expect(logs.info[0]).toMatch(/.*Received Origin Request Event.*/i);
      expect(logs.info[1]).toMatch(/.*Updating the S3 Origin Path.*/i);
      expect(logs.info[2]).toMatch(/.*Responding With Request.*/i);

      const redirect = JSON.parse(logs.info[2]).context as CloudFrontRequest;
      expect(redirect).toMatchObject<CloudFrontRequest>(expectedRedirect);
      expect(redirect).toMatchObject<CloudFrontRequest>(response as CloudFrontRequest);
    } finally {
      resetLogs();
    }
  });

  it('Handles Custom Origin As Expected', async () => {
    const [logs, resetLogs] = makeLogData();
    let response: CloudFrontRequestResult;
    try {
      const event = getCfReqEvent(
        'admin.foo.com',
        'origin-request',
        {
          host: [{ value: 'admin.foo.com' }],
        },
        {
          custom: {
            keepaliveTimeout: 30,
            port: 443,
            protocol: 'https',
            readTimeout: 30,
            sslProtocols: ['TLS_1.2'],
            domainName: 'admin.foo.com',
            path: '/sites',
            customHeaders: {
              'x-base-host': [{ value: 'foo.com' }],
              'x-origin-admin': [{ value: 'https://api.foo.com/admin/{path}' }],
            },
          },
        }
      );
      const expectedRedirect: CloudFrontRequest = {
        clientIp: '0.0.0.0',
        headers: { host: [{ value: 'admin.foo.com' }], 'x-target-domain': [{ value: 'admin.foo.com' }] },
        method: 'GET',
        querystring: '',
        uri: '',
        origin: {
          custom: {
            path: '',
            readTimeout: 30,
            keepaliveTimeout: 5,
            domainName: 'api.foo.com',
            customHeaders: {
              'x-base-host': [{ value: 'foo.com' }],
              'x-origin-admin': [{ value: 'https://api.foo.com/admin/{path}' }],
            },
            port: 443,
            sslProtocols: ['TLSv1', 'TLSv1.1', 'TLSv1.2'],
            protocol: 'https',
          },
        },
      };

      await expect(handler(event).then((r) => (response = r))).resolves.toBeDefined();

      expect(response).toBeDefined();
      expect(response).not.toBeNull();
      expect(logs.info).toHaveLength(3);
      expect(logs.info[0]).toMatch(/.*Received Origin Request Event.*/i);
      expect(logs.info[1]).toMatch(/.*Updating Custom Origin Request.*/i);
      expect(logs.info[2]).toMatch(/.*Responding With Request.*/i);

      const redirect = JSON.parse(logs.info[2]).context as CloudFrontRequest;
      expect(redirect).toMatchObject<CloudFrontRequest>(expectedRedirect);
      expect(redirect).toMatchObject<CloudFrontRequest>(response as CloudFrontRequest);
    } finally {
      resetLogs();
    }
  });

  it('Handles Exceptions As Expected', async () => {
    const [logs, resetLogs] = makeLogData();
    let response: CloudFrontRequestResult;
    try {
      const event = getCfReqEvent(
        'admin.foo.com',
        'origin-request',
        {
          host: [{ value: 'admin.foo.com' }],
        },
        {
          custom: {
            keepaliveTimeout: 30,
            port: 443,
            protocol: 'https',
            readTimeout: 30,
            sslProtocols: ['TLS_1.2'],
            domainName: 'admin.foo.com',
            path: '/sites',
            customHeaders: {
              'x-origin-admin': [{ value: 'https://api.foo.com/admin/{path}' }],
            },
          },
        }
      );

      await expect(handler(event).then((r) => (response = r))).resolves.toBeDefined();

      expect(response).toBeDefined();
      expect(response).not.toBeNull();
      expect(response.body).not.toBeNull();
      expect(logs.info).toHaveLength(1);
      expect(logs.info[0]).toMatch(/.*Received Origin Request Event.*/i);

      expect(logs.error).toHaveLength(1);
      expect(logs.error[0]).toMatch(/.*Fatal Error Encountered.*/i);

      const errorBody = JSON.stringify(JSON.parse(logs.error[0]).context);
      expect(response.body).toMatch(errorBody);
    } finally {
      resetLogs();
    }
  });
});
