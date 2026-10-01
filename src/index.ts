import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStatus,
} from "@playwright/test/reporter";
import { ClientSecretCredential, DefaultAzureCredential } from "@azure/identity";
import { stripVTControlCharacters } from "node:util";
import { AzureMonitorPublisher, AzureMonitorTarget } from "./publisher.js";

export { AzureMonitorPublisher } from "./publisher.js";
export type { AzureMonitorPublisherOptions, AzureMonitorTarget } from "./publisher.js";

export interface AzureMonitorReporterOptions {
  projectName?: string;
  azureTenantId?: string;
  azureClientId?: string;
  azureClientSecret?: string;
  dceEndpoint?: string;
  dcrImmutableId?: string;
  streamName?: string;
  targets?: Record<string, AzureMonitorTarget>;
  testResultsTarget?: string;
  failOnUploadError?: boolean;
  environment?: string;
  RunId?: string;
  commitSHA?: string;
  debugMode?: boolean; // Optional debug mode to enable more verbose logging
}

// Define a type for the data we'll send to Log Analytics
interface LogAnalyticsTestData {
  [key: string]: unknown;
  TimeGenerated: string;
  RunID?: string;
  TestSuite: string;
  TestCaseTitle: string;
  Status: TestStatus | "TimedOut"; // Playwright's TestStatus doesn't include 'TimedOut' directly in the same way
  DurationMs: number;
  Browser?: string;
  Environment?: string;
  CommitSHA?: string;
  ErrorMessage?: string;
  StackTrace?: string;
  Retries: number;
  WorkerIndex?: number;
  TestFile: string;
  Tags?: string; // Assuming tags might be parsed from title or a custom mechanism
  Project: string; // Project name that all the tests belong to.  Just to organize if all tests are dumped into the same table
}

class AzureMonitorReporter implements Reporter {
  private publisher?: AzureMonitorPublisher;
  private fallbackPublisher?: AzureMonitorPublisher;
  private testResults: LogAnalyticsTestData[] = [];
  private targetName: string;
  private failOnUploadError: boolean;

  private projectName: string;
  private dceEndpoint: string;
  private dcrImmutableId: string;
  private streamName: string;
  private environment: string;
  private RunId: string;
  private commitSHA?: string;
  private debugMode = false; // Optional debug mode
  private authMode = "unconfigured";

  // To store config and suite information accessible in onTestEnd
  private currentConfig!: FullConfig;
  private currentRunSuite!: Suite;

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }

    if (typeof error === "string") {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private getNestedErrorMessages(error: unknown): string[] {
    if (!error || typeof error !== "object") {
      return [];
    }

    const nestedErrors = (error as { errors?: { cause?: unknown }[] }).errors;
    if (!Array.isArray(nestedErrors)) {
      return [];
    }

    return nestedErrors
      .map(entry => this.formatError(entry.cause))
      .filter(message => message && message !== "undefined");
  }

  private isAuthenticationError(error: unknown): boolean {
    const combined = [this.formatError(error), ...this.getNestedErrorMessages(error)]
      .join(" | ")
      .toLowerCase();

    return combined.includes("authentication") || combined.includes("credential");
  }

  private createDefaultCredential(clientId?: string): DefaultAzureCredential {
    return new DefaultAzureCredential(
      clientId
        ? {
            managedIdentityClientId: clientId,
          }
        : undefined
    );
  }

  private async uploadWithPublisher(
    publisher: AzureMonitorPublisher,
    authMode: string
  ): Promise<void> {
    await publisher.publish(this.targetName, this.testResults);

    console.log(
      `Log Analytics Reporter: Successfully uploaded ${this.testResults.length} test results to Azure Log Analytics using ${authMode} authentication.`
    );
  }

  // Helper to get a "suite" name - typically the file name or a top-level describe
  private getTestSuite(test: TestCase): string {
    return (
      test.parent?.title ||
      test.location?.file.split(/[\\/]/).pop() ||
      "Unknown Suite"
    );
  }

  constructor(options?: AzureMonitorReporterOptions) {
    this.targetName = options?.testResultsTarget || "testResults";
    this.failOnUploadError = options?.failOnUploadError ?? false;
    const selectedTarget = options?.targets?.[this.targetName];
    if (options?.targets && !selectedTarget) {
      throw new Error(`Unknown test-results target '${this.targetName}'.`);
    }
    // Retrieve Azure configuration from environment variables or options
    this.projectName =
      options?.projectName ||
      process.env.AZURE_PROJECT_NAME ||
      "DefaultProject";
    this.dceEndpoint =
      selectedTarget?.dceEndpoint || options?.dceEndpoint || process.env.LOG_ANALYTICS_DCE_ENDPOINT || "";
    this.dcrImmutableId =
      selectedTarget?.dcrImmutableId || options?.dcrImmutableId ||
      process.env.LOG_ANALYTICS_DCR_IMMUTABLE_ID ||
      "";
    this.streamName =
      selectedTarget?.streamName || options?.streamName || process.env.LOG_ANALYTICS_STREAM_NAME || "";

    const azureTenantId = options?.azureTenantId || process.env.AZURE_TENANT_ID;
    const azureClientId = options?.azureClientId || process.env.AZURE_CLIENT_ID;
    const azureClientSecret =
      options?.azureClientSecret || process.env.AZURE_CLIENT_SECRET;

    this.environment =
      options?.environment || process.env.TEST_ENVIRONMENT || "local"; // Default to 'local' if not set
    this.RunId =
      options?.RunId ||
      process.env.BUILD_BUILDID ||
      process.env.CI_PIPELINE_RUN_ID ||
      process.env.GITHUB_RUN_ID ||
      `local-${Date.now()}`;
    this.commitSHA =
      options?.commitSHA ||
      process.env.BUILD_SOURCEVERSION ||
      process.env.GIT_COMMIT_SHA ||
      process.env.GITHUB_SHA;
    this.debugMode = options?.debugMode ?? false; // Optional debug mode
    this.authMode = "unconfigured";

    if (!this.dceEndpoint || !this.dcrImmutableId || !this.streamName) {
      if (this.failOnUploadError) {
        throw new Error("DCE endpoint, DCR immutable ID, and stream name are required.");
      }
      console.warn(
        "Log Analytics Reporter: DCE Endpoint, DCR Immutable ID, or Stream Name is not configured. Reporter will not send data."
      );
      return;
    }

    if (this.debugMode) {
      console.debug(
        `Log Analytics Reporter: Initialized with DCE Endpoint: ${this.dceEndpoint}`
      );
      console.debug(
        `Log Analytics Reporter: Initialized with DCR Immutable ID: ${this.dcrImmutableId}`
      );
      console.debug(
        `Log Analytics Reporter: Initialized with Stream Name: ${this.streamName}`
      );

      console.debug(
        `Log Analytics Reporter: Azure Tenant configured: ${Boolean(azureTenantId)}`
      );
      console.debug(
        `Log Analytics Reporter: Azure Client ID configured: ${Boolean(azureClientId)}`
      );
      console.debug(
        `Log Analytics Reporter: Azure Client Secret configured: ${Boolean(azureClientSecret)}`
      );
    }

    const publisherOptions = {
      dceEndpoint: options?.dceEndpoint || process.env.LOG_ANALYTICS_DCE_ENDPOINT || this.dceEndpoint,
      targets: options?.targets || {
        [this.targetName]: { dcrImmutableId: this.dcrImmutableId, streamName: this.streamName },
      },
    };
    if (azureTenantId && azureClientId && azureClientSecret) {
      const credential = new ClientSecretCredential(
        azureTenantId,
        azureClientId,
        azureClientSecret
      );
      this.publisher = new AzureMonitorPublisher({ ...publisherOptions, credential });
      this.fallbackPublisher = new AzureMonitorPublisher({
        ...publisherOptions,
        credential: this.createDefaultCredential(azureClientId),
      });
      this.authMode = "client-secret";
      if (this.debugMode) {
        console.debug(
          "Log Analytics Reporter: Azure credentials successfully configured. Reporter will send data."
        );
        console.debug("Log Analytics Reporter: DefaultAzureCredential fallback enabled.");
      }
    } else {
      this.publisher = new AzureMonitorPublisher({
        ...publisherOptions,
        credential: this.createDefaultCredential(azureClientId),
      });
      this.authMode = "default-credential";

      console.warn(
        "Log Analytics Reporter: Explicit client secret credentials were not fully configured. Falling back to DefaultAzureCredential."
      );
    }
  }

  onBegin(config: FullConfig, suite: Suite): void {
    console.log(
      `Log Analytics Reporter: Starting test run with ${
        suite.allTests().length
      } tests.`
    );
    this.currentConfig = config;
    this.currentRunSuite = suite;
    this.testResults = []; // Reset for new run
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const testData: LogAnalyticsTestData = {
      TimeGenerated: new Date().toISOString(),
      RunID: this.RunId,
      TestSuite: this.getTestSuite(test),
      TestCaseTitle: test.title,
      // Playwright's TestStatus can be 'passed', 'failed', 'timedOut', 'skipped', 'interrupted'
      // We map 'timedOut' explicitly as our interface has it.
      Status: result.status === "timedOut" ? "TimedOut" : result.status,
      DurationMs: result.duration,
      Browser: test.parent.project()?.name || "unknown", // Get browser from project name
      Environment: this.environment,
      CommitSHA: this.commitSHA,
      ErrorMessage: stripVTControlCharacters(result.error?.message ?? ""),
      StackTrace: stripVTControlCharacters(result.error?.stack ?? ""),
      Retries: result.retry,
      WorkerIndex: result.workerIndex,
      TestFile: test.location.file,
      Tags: test.tags.join(",") || undefined,
      Project: this.projectName, // Get project name from config
    };

    this.testResults.push(testData);
    // console.log(`Log Analytics Reporter: Collected data for: ${test.title}, Status: ${result.status}`);
  }

  async onEnd(result: FullResult): Promise<void> {
    console.log(
      `Log Analytics Reporter: Test run finished with status: ${result.status}`
    );
    if (this.publisher && this.testResults.length > 0) {
      console.log(
        `Log Analytics Reporter: Preparing to send ${this.testResults.length} results to Azure Log Analytics.`
      );
      if (this.debugMode) {
        // print out the results for debugging
        console.log(
          "Log Analytics Reporter: Test Results:",
          JSON.stringify(this.testResults, null, 2)
        );
      }
      try {
        await this.uploadWithPublisher(this.publisher, this.authMode);
      } catch (error) {
        const nestedMessages = this.getNestedErrorMessages(error);
        console.error(
          `Log Analytics Reporter: Error uploading data to Azure Log Analytics via ${this.authMode}: ${this.formatError(error)}`
        );
        if (nestedMessages.length > 0) {
          console.error(
            `Log Analytics Reporter: Nested upload errors: ${nestedMessages.join(" | ")}`
          );
        }

        if (
          this.fallbackPublisher &&
          this.isAuthenticationError(error)
        ) {
          console.warn(
            "Log Analytics Reporter: Retrying upload with DefaultAzureCredential fallback."
          );

          try {
            await this.uploadWithPublisher(
              this.fallbackPublisher,
              "default-credential fallback"
            );
            return;
          } catch (fallbackError) {
            const fallbackNestedMessages = this.getNestedErrorMessages(fallbackError);
            console.error(
              `Log Analytics Reporter: Fallback upload failed: ${this.formatError(fallbackError)}`
            );
            if (fallbackNestedMessages.length > 0) {
              console.error(
                `Log Analytics Reporter: Fallback nested upload errors: ${fallbackNestedMessages.join(" | ")}`
              );
            }
            if (this.failOnUploadError) {
              throw fallbackError;
            }
          }
        }

        if (this.failOnUploadError) {
          throw error;
        }

        // Optionally, write to a local file as a fallback
        // import * as fs from 'fs'; // Use 'import * as fs' for ES modules or 'const fs = require("fs")' for CJS
        // fs.writeFileSync(`log-analytics-fallback-${Date.now()}.json`, JSON.stringify(this.testResults, null, 2));
      }
    } else if (this.testResults.length === 0) {
      console.log("Log Analytics Reporter: No test results to send.");
    }
  }

  onError(error): void {
    console.error("Log Analytics Reporter: An error occurred:", error);
  }
}

export default AzureMonitorReporter;
