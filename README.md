# Playwright Azure Monitor Reporter

This plugin sends Playwright test results to Azure Monitor Log Analytics, allowing you to centralize, analyze, and visualize your test metrics in Azure.

## Overview
The Playwright Azure Monitor Reporter is a custom reporter for Playwright tests that automatically collects test execution data and sends it to Azure Monitor Log Analytics.

## Prerequisites

- Azure subscription
- Log Analytics workspace
- Appropriate permissions to write to Log Analytics
- Playwright test suite

## Installation
To install the Playwright Azure Monitor Reporter...

`npm install playwright-azure-monitor-reporter`

or

`pnpm install playwright-azure-monitor-reporter`

## Configure Playwright

### Environment Variables

- **AZURE_TENANT_ID**: Your Azure Tenent ID
- **AZURE_CLIENT_ID**: Your Azure Client ID
- **AZURE_CLIENT_SECRET**: Your Azure Client Secret
- **LOG_ANALYTICS_DCE_ENDPOINT**: The ingestion URI from your Data Collection Endpoint
- **LOG_ANALYTICS_DCR_IMMUTABLE_ID**: The immutable ID of your Data Collection Rule
- **LOG_ANALYTICS_STREAM_NAME**: The stream name you defined in your DCR (e.g., Custom-PlaywrightTests_CL)

optional:

- **AZURE_PROJECT_NAME**: String of an arbitrary name to associate your Playwright tests.  Default: "DefaultProject"

- **TEST_ENVIRONMENT**: String of the environment the tests are run against.  Default: "local"

- **RunId**: Uses the following CI\CD environment variables if they are available:
  - Azure DevOps = BUILD_BUILDID
  - GitLab = CI_PIPELINE_RUN_ID
  - GitHub = GITHUB_RUN_ID
  - Default `local-${Date.now()}`

- **Commit SHA**: Uses the following CI\CD environment variables if they are avilable:
  - Azure DevOps = BUILD_SOURCEVERSION
  - GitLab = GIT_COMMIT_SHA
  - GitHub = GITHUB_SHA
  - Default: blank

### Playwright Configuration File


```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import type { AzureMonitorReporterOptions } from 'playwright-azure-monitor-reporter';

const azureOptions: AzureMonitorReporterOptions = {
  projectName: 'Some Project Name',
  environment: process.env.TEST_ENVIRONMENT,
  debugMode: false,
};

export default defineConfig({
  reporter: [
    ['list'],
    ['playwright-azure-monitor-reporter', azureOptions],
  ],
});
```

### Named Targets and Custom Measurements

The default reporter export, existing single-stream options, environment fallbacks,
and 16-column test-result schema remain compatible. `targets` adds named routes;
`testResultsTarget` selects one route for test results (default: `testResults`).
The reporter never broadcasts test results to other routes or mixes measurements
into the test-result schema.

For targets sharing a DCR, reuse `LOG_ANALYTICS_DCR_IMMUTABLE_ID` and configure
separate stream names. The examples below use an optional custom-target
ID override only when that target needs a different DCR. The `LOG_ANALYTICS_CUSTOM_*`
variables are example consumer configuration, not additional built-in package defaults.

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['playwright-azure-monitor-reporter', {
    dceEndpoint: process.env.LOG_ANALYTICS_DCE_ENDPOINT,
    targets: {
      testResults: {
        dcrImmutableId: process.env.LOG_ANALYTICS_DCR_IMMUTABLE_ID,
        streamName: process.env.LOG_ANALYTICS_STREAM_NAME,
      },
      customRecords: {
        dcrImmutableId:
          process.env.LOG_ANALYTICS_CUSTOM_DCR_IMMUTABLE_ID ||
          process.env.LOG_ANALYTICS_DCR_IMMUTABLE_ID,
        streamName: process.env.LOG_ANALYTICS_CUSTOM_STREAM_NAME,
      },
    },
    testResultsTarget: 'testResults',
    failOnUploadError: true,
  }]],
});
```

Use the exported `AzureMonitorPublisher` to upload caller-supplied records independently
of the reporter. Targets may use different streams on the same DCR, different DCRs,
or a per-target `dceEndpoint`. Clients are reused for targets sharing an endpoint.
Record fields and target names are chosen by the consumer; the package does not
enforce a domain-specific custom-record schema. For example, configure
`LOG_ANALYTICS_CUSTOM_STREAM_NAME=Custom-Measurements_CL` for your `Measurements_CL`
table and publish records from a Playwright test:

```typescript
import { test } from '@playwright/test';
import { AzureMonitorPublisher } from 'playwright-azure-monitor-reporter';

const publisher = new AzureMonitorPublisher({
  dceEndpoint: process.env.LOG_ANALYTICS_DCE_ENDPOINT,
  targets: {
    customRecords: {
      dcrImmutableId: (
        process.env.LOG_ANALYTICS_CUSTOM_DCR_IMMUTABLE_ID ||
        process.env.LOG_ANALYTICS_DCR_IMMUTABLE_ID
      )!,
      streamName: process.env.LOG_ANALYTICS_CUSTOM_STREAM_NAME!,
    },
  },
});

test('publish custom measurements', async () => {
  await publisher.publish('customRecords', [{
    TimeGenerated: new Date().toISOString(),
    Service: 'orders-api',
    Measurement: 'ResponseTime',
    Value: 120,
    Unit: 'ms',
  }]);
});
```

The values above illustrate a row; real monitors must publish calculated measurements.
Missing configuration and unknown targets throw. Empty batches are skipped. Upload
failures reject `publish`; callers must await it before completing a monitoring run.
The publisher does not perform whole-batch credential fallback, which could duplicate
rows after a partial upload. Transient retry and batching are handled by the Azure SDK.

Authentication accepts an explicit `credential` implementing Azure's token credential
contract. Otherwise it uses complete client-secret configuration from options or
`AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`, falling back to
`DefaultAzureCredential` when those credentials are incomplete. Prefer managed identity
on Azure and a service principal or federated identity in CI; keep credentials outside
source control. The reporter preserves its existing authentication-error fallback and
logging-only failure behavior by default; `failOnUploadError: true` makes final upload
errors reject `onEnd` and incomplete routing fail initialization. For strict CI gating,
await `publisher.publish` in the monitoring test rather than relying only on a reporter
exception to determine Playwright's exit code.

Create the destination table and matching schema before configuring the DCR flow.
The SDK and DCR do not auto-create tables. Custom payloads must match the configured
input stream schema and, after any DCR transformation, the destination table schema.
The example table name and fields are illustrative; use your own custom table and
record fields. Keep the reporter's test-result schema separate from custom payloads.
Use separate custom tables for different schemas,
retention plans, or reader-access requirements. Use separate DCRs when writer permissions
must differ: publisher RBAC applies to the entire DCR, not one input stream.

These named APIs require a new package release; previously published versions do not
include them. Build and release the package, then update consumers to that version.

Reference: [Azure Monitor Logs Ingestion SDK for JavaScript](https://learn.microsoft.com/javascript/api/overview/azure/monitor-ingestion-readme).


## Data Schema
This the schema of data being sent to Azure Monitor so users understand what metrics/fields are available for querying and visualization.

```json
"columns": [
  { "name": "TimeGenerated", "type": "datetime" },
  { "name": "RunID", "type": "string" },
  { "name": "TestSuite", "type": "string" },
  { "name": "TestCaseTitle", "type": "string" },
  { "name": "Status", "type": "string" },
  { "name": "DurationMs", "type": "real" },
  { "name": "Browser", "type": "string" },
  { "name": "Environment", "type": "string" },
  { "name": "CommitSHA", "type": "string" },
  { "name": "ErrorMessage", "type": "string" },
  { "name": "StackTrace", "type": "string" },
  { "name": "Retries", "type": "int" },
  { "name": "WorkerIndex", "type": "int" },
  { "name": "TestFile", "type": "string" },
  { "name": "Tags", "type": "string" },
  { "name": "Project", "type": "string" }
]
```

This is a sample of the data sent to Azure Monitor:

```json
[
  {
    "TimeGenerated": "2024-01-01T00:00:00Z",
    "RunID": "abc123",
    "TestSuite": "LoginTests",
    "TestCaseTitle": "should login successfully",
    "Status": "Passed",
    "DurationMs": 1234.56,
    "Browser": "Chrome",
    "Environment": "Staging",
    "CommitSHA": "abcdef123456",
    "ErrorMessage": "",
    "StackTrace": "",
    "Retries": 0,
    "WorkerIndex": 1,
    "TestFile": "login.spec.ts",
    "Tags": "smoke", // comma-delmited list of tags
    "Project": "My Project Name"
  }
]
```

## Example KQL Queries

Provide example Kusto queries for common reporting scenarios:

```typescript
PlaywrightTests_CL
| where TestStatus == 'passed'
| summarize count() by Browser, TestFile
```

![KQL Query](https://raw.githubusercontent.com/Antebios/playwright-azure-monitor-reporter/refs/heads/main/docs/images/azure-monitor-lw-02.png)

## Guide to creating Azure resources

This is [detailed documentation](https://github.com/Antebios/playwright-azure-monitor-reporter/blob/main/docs/readme.md)  in order for you to create the Azure resources and table for this reporter to successfully publish the test results.

The following resources need to be created before using this reporter:

- Azure Log Analytics Workspace
- Data Collection Endpoint
- Data Collection Rule
- Log Table
