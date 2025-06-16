# Playwright Azure Monitor Reporter

This plugin sends Playwright test results to Azure Monitor Log Analytics, allowing you to centralize, analyze, and visualize your test metrics in Azure.

## Overview
The Playwright Azure Monitor Reporter is a custom reporter for Playwright tests that automatically collects test execution data and sends it to Azure Monitor Log Analytics. It enables you to:

- Track test execution metrics in a central location
- Monitor test results across different test runs, environments, and browsers
- Create custom dashboards and alerts based on test results
- Analyze trends in test stability and performance over time

The reporter captures detailed information about each test, including:

- Test status (passed, failed, skipped, etc.)
- Test duration
- Error messages and stack traces for failed tests
- Test file paths and suite names
- Browser information
- Environment details
- CI/CD run information and commit IDs

### Key Features
- Easy Configuration: Set up with environment variables or direct configuration in Playwright config
- Authentication: Secure Azure authentication using Azure Identity credentials
- Rich Data: Captures comprehensive test metadata for detailed analysis
- Error Handling: Robust error handling to ensure test results are reliably captured
- Flexibility: Works with any Playwright test project with minimal configuration

### Use Cases
- CI/CD Pipeline Integration: Track test results across builds and deployments
- Test Health Monitoring: Identify flaky tests and track test stability over time
- Cross-Environment Analysis: Compare test performance across different environments
- Release Quality Insights: Get aggregated test metrics to inform release decisions
- Check the documentation for setup instructions and configuration options.

## Prerequisites

- Azure subscription
- Log Analytics workspace
- Appropriate permissions to write to Log Analytics
- Playwright test suite

## Installation
To install the Playwright Azure Monitor Reporter...

`npm install playwright-azure-monitor-reporter`

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
import { AzureMonitorReporter } from 'playwright-azure-monitor-reporter';

export default defineConfig({
  reporter: [
    ['list'],
    ['playwright-azure-monitor-reporter', {
      // Configuration here
      projectName: 'Some Project Name', // to identify the test project or other information to group tests
      // Additional options which look for environment variables if not defined here
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

    } as AzureMonitorReporter,
    ]
  ],
  // Other Playwright configuration
});
```

Authentication Methods
Explain the different ways to authenticate with Azure:

Environment variables
Azure Identity library credentials
Direct credential configuration
Environment Variables
List all supported environment variables:

Data Schema
Document the schema of data being sent to Azure Monitor so users understand what metrics/fields are available for querying and visualization.

Example KQL Queries
Provide example Kusto queries for common reporting scenarios:
```
PlaywrightTestResults
| where TestStatus == 'failed'
| summarize count() by Browser, TestFile
```


Best Practices
Tips for organizing test data
Recommended approaches for setting up dashboards
Guidelines for querying and filtering test results
CI/CD Integration
Instructions for integrating with common CI/CD platforms (GitHub Actions, Azure DevOps, etc.)

Troubleshooting
Common issues and their solutions:

Authentication problems
Data not appearing in Log Analytics
Error handling
Advanced Configuration
Detailed explanation of additional configuration options and customizations.

Contributing
How others can contribute to the project.

This structure provides a comprehensive guide that helps users quickly understand, implement, and troubleshoot the package while maximizing their use of Azure Monitor for test reporting and analysis.
