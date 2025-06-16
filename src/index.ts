import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStatus,
} from '@playwright/test/reporter'
import { ClientSecretCredential } from '@azure/identity'
import { LogsIngestionClient } from '@azure/monitor-ingestion'

// Define a type for the data we'll send to Log Analytics
interface LogAnalyticsTestData {
  [key: string]: unknown
  TimeGenerated: string
  RunID?: string
  TestSuite: string
  TestCaseTitle: string
  Status: TestStatus | 'TimedOut' // Playwright's TestStatus doesn't include 'TimedOut' directly in the same way
  DurationMs: number
  Browser?: string
  Environment?: string
  CommitSHA?: string
  ErrorMessage?: string
  StackTrace?: string
  Retries: number
  WorkerIndex?: number
  TestFile: string
  Tags?: string // Assuming tags might be parsed from title or a custom mechanism
  Project: string // Project name that all the tests belong to.  Just to organize if all tests are dumped into the same table
}

class AzureMonitorReporter implements Reporter {
  private logsIngestionClient?: LogsIngestionClient
  private testResults: LogAnalyticsTestData[] = []

  private projectName: string
  private dceEndpoint: string
  private dcrImmutableId: string
  private streamName: string
  private environment: string
  private RunId: string
  private commitSHA?: string
  private debugMode: boolean = false // Optional debug mode

  // To store config and suite information accessible in onTestEnd
  private currentConfig!: FullConfig
  private currentRunSuite!: Suite

  // Helper to get a "suite" name - typically the file name or a top-level describe
  private getTestSuite(test: TestCase): string {
    return test.parent?.title || test.location?.file.split(/[\\/]/).pop() || 'Unknown Suite'
  }

  constructor(options?: {
    projectName?: string
    azureTenantId?: string
    azureClientId?: string
    azureClientSecret?: string
    dceEndpoint?: string
    dcrImmutableId?: string
    streamName?: string
    environment?: string
    RunId?: string
    commitSHA?: string
    debugMode?: boolean // Optional debug mode to enable more verbose logging
  }) {
    // Retrieve Azure configuration from environment variables or options
    this.projectName = options?.projectName || process.env.AZURE_PROJECT_NAME || 'DefaultProject'
    this.dceEndpoint = options?.dceEndpoint || process.env.LOG_ANALYTICS_DCE_ENDPOINT!
    this.dcrImmutableId = options?.dcrImmutableId || process.env.LOG_ANALYTICS_DCR_IMMUTABLE_ID!
    this.streamName = options?.streamName || process.env.LOG_ANALYTICS_STREAM_NAME!

    const azureTenantId = options?.azureTenantId || process.env.AZURE_TENANT_ID
    const azureClientId = options?.azureClientId || process.env.AZURE_CLIENT_ID
    const azureClientSecret = options?.azureClientSecret || process.env.AZURE_CLIENT_SECRET

    this.environment = options?.environment || process.env.TEST_ENVIRONMENT || 'local' // Default to 'local' if not set
    this.RunId = options?.RunId || process.env.BUILD_BUILDID || process.env.CI_PIPELINE_RUN_ID || process.env.GITHUB_RUN_ID || `local-${Date.now()}`
    this.commitSHA = options?.commitSHA || process.env.BUILD_SOURCEVERSION || process.env.GIT_COMMIT_SHA || process.env.GITHUB_SHA

    if (!this.dceEndpoint || !this.dcrImmutableId || !this.streamName) {
      console.warn('Log Analytics Reporter: DCE Endpoint, DCR Immutable ID, or Stream Name is not configured. Reporter will not send data.')
      return
    }

    if (this.debugMode) {
      console.debug(`Log Analytics Reporter: Initialized with DCE Endpoint: ${this.dceEndpoint}`);
      console.debug(`Log Analytics Reporter: Initialized with DCR Immutable ID: ${this.dcrImmutableId}`);
      console.debug(`Log Analytics Reporter: Initialized with Stream Name: ${this.streamName}`);

      console.debug(`Log Analytics Reporter: Initialized with Azure Tenant: ${azureTenantId}`);
      console.debug(`Log Analytics Reporter: Initialized with Azure Client ID: ${azureClientId}`);
    }

    if (azureTenantId && azureClientId && azureClientSecret) {
      const credential = new ClientSecretCredential(azureTenantId, azureClientId, azureClientSecret)
      this.logsIngestionClient = new LogsIngestionClient(this.dceEndpoint, credential)
      if (this.debugMode) {
        console.debug("Log Analytics Reporter: Azure credentials successfully configured. Reporter will send data.");
        console.debug(`Log Analytics Reporter: logsIngestionClient: ${this.logsIngestionClient}`);
      }
    }
    else {
      console.warn('Log Analytics Reporter: Azure credentials not fully configured. Reporter will not send data.')
    }
  }

  onBegin(config: FullConfig, suite: Suite): void {
    console.log(`Log Analytics Reporter: Starting test run with ${suite.allTests().length} tests.`)
    this.currentConfig = config
    this.currentRunSuite = suite
    this.testResults = [] // Reset for new run
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const testData: LogAnalyticsTestData = {
      TimeGenerated: new Date().toISOString(),
      RunID: this.RunId,
      TestSuite: this.getTestSuite(test),
      TestCaseTitle: test.title,
      // Playwright's TestStatus can be 'passed', 'failed', 'timedOut', 'skipped', 'interrupted'
      // We map 'timedOut' explicitly as our interface has it.
      Status: result.status === 'timedOut' ? 'TimedOut' : result.status,
      DurationMs: result.duration,
      Browser: test.parent.project()?.name || 'unknown', // Get browser from project name
      Environment: this.environment,
      CommitSHA: this.commitSHA,
      ErrorMessage: result.error?.message,
      StackTrace: result.error?.stack,
      Retries: result.retry,
      WorkerIndex: result.workerIndex,
      TestFile: test.location.file,
      Tags: test.tags.join(',') || undefined,
      Project: this.projectName, // Get project name from config
    }

    this.testResults.push(testData)
    // console.log(`Log Analytics Reporter: Collected data for: ${test.title}, Status: ${result.status}`);
  }

  async onEnd(result: FullResult): Promise<void> {
    console.log(`Log Analytics Reporter: Test run finished with status: ${result.status}`)
    if (this.logsIngestionClient && this.testResults.length > 0) {
      console.log(`Log Analytics Reporter: Preparing to send ${this.testResults.length} results to Azure Log Analytics.`)
      if (this.debugMode) {
        // print out the results for debugging
        console.log('Log Analytics Reporter: Test Results:', JSON.stringify(this.testResults, null, 2))
      }
      try {
        // Ensure the streamName in your Data Collection Rule (DCR) is configured to accept the structure of LogAnalyticsTestData.
        // The DCR's stream name is what links the incoming data to the target Log Analytics table.
        await this.logsIngestionClient.upload(this.dcrImmutableId, this.streamName, this.testResults, {
          maxConcurrency: 5, // Optional: configure concurrency for uploads
        })
        console.log(`Log Analytics Reporter: Successfully uploaded ${this.testResults.length} test results to Azure Log Analytics.`)
      }
      catch (error) {
        console.error('Log Analytics Reporter: Error uploading data to Azure Log Analytics:', error)
        // Optionally, write to a local file as a fallback
        // import * as fs from 'fs'; // Use 'import * as fs' for ES modules or 'const fs = require("fs")' for CJS
        // fs.writeFileSync(`log-analytics-fallback-${Date.now()}.json`, JSON.stringify(this.testResults, null, 2));
      }
    }
    else if (this.testResults.length === 0) {
      console.log('Log Analytics Reporter: No test results to send.')
    }
  }

  onError(error: any): void {
    console.error('Log Analytics Reporter: An error occurred:', error)
  }
}

export default AzureMonitorReporter
