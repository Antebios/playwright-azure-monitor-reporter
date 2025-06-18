import AzureMonitorReporter, { AzureMonitorReporterOptions } from './index';
import { FullConfig, Suite, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

describe('AzureMonitorReporter', () => {
  const minimalOptions: AzureMonitorReporterOptions = {
    projectName: 'TestProject',
    dceEndpoint: 'https://example.com',
    dcrImmutableId: 'dcr-id',
    streamName: 'stream',
    azureTenantId: 'tenant',
    azureClientId: 'client',
    azureClientSecret: 'secret',
    environment: 'test',
    RunId: 'run-1',
    commitSHA: 'sha',
    debugMode: true,
  };

  it('should initialize with options', () => {
    const reporter = new AzureMonitorReporter(minimalOptions);
    expect(reporter).toBeInstanceOf(AzureMonitorReporter);
  });

  it('should not throw if required Azure config is missing', () => {
    expect(() => new AzureMonitorReporter({})).not.toThrow();
  });

  it('should collect test results on onTestEnd', () => {
    const reporter = new AzureMonitorReporter(minimalOptions);
    // @ts-expect-error: access private
    reporter.currentConfig = {} as FullConfig;
    // @ts-expect-error: access private
    reporter.currentRunSuite = {} as Suite;
    const fakeTest = {
      title: 'should do something',
      parent: {
        title: 'suite',
        project: () => ({ name: 'chromium' }),
      },
      location: { file: 'testfile.spec.ts' },
      tags: ['smoke'],
    } as unknown as TestCase;
    const fakeResult = {
      status: 'passed',
      duration: 123,
      error: undefined,
      retry: 0,
      workerIndex: 1,
    } as TestResult;
    reporter.onTestEnd(fakeTest, fakeResult);
    // @ts-expect-error: access private
    expect(reporter.testResults.length).toBe(1);
    // @ts-expect-error: access private
    expect(reporter.testResults[0].TestCaseTitle).toBe('should do something');
  });

  it('should handle onBegin and onEnd', async () => {
    const reporter = new AzureMonitorReporter(minimalOptions);
    const fakeConfig = {} as FullConfig;
    const fakeSuite = { allTests: () => [1, 2, 3] } as unknown as Suite;
    reporter.onBegin(fakeConfig, fakeSuite);
    expect(reporter['currentConfig']).toBe(fakeConfig);
    expect(reporter['currentRunSuite']).toBe(fakeSuite);
    await expect(reporter.onEnd({ status: 'passed' } as FullResult)).resolves.toBeUndefined();
  });

  it('should log error on onError', () => {
    const reporter = new AzureMonitorReporter(minimalOptions);
    const spy = jest.spyOn(console, 'error').mockImplementation();
    reporter.onError(new Error('fail'));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
