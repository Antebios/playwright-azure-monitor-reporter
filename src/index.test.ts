import AzureMonitorReporter, { AzureMonitorPublisher, AzureMonitorReporterOptions } from "./index";
import { LogsIngestionClient } from "@azure/monitor-ingestion";
import {
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import { stripVTControlCharacters } from "node:util";

const INGESTION_STREAM_NAME = "Custom-Measurements_CL";

jest.mock("@azure/monitor-ingestion", () => ({
  LogsIngestionClient: jest.fn().mockImplementation(() => ({
    upload: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe("AzureMonitorPublisher", () => {
  beforeEach(() => jest.clearAllMocks());

  const targets = {
    testResults: { dcrImmutableId: "shared-dcr", streamName: "Custom-PlaywrightTests_CL" },
    ingestion: { dcrImmutableId: "shared-dcr", streamName: INGESTION_STREAM_NAME },
    otherDcr: { dcrImmutableId: "other-dcr", streamName: "Custom-Other_CL" },
  };

  it("routes distinct payloads by stream and DCR while reusing the endpoint client", async () => {
    const publisher = new AzureMonitorPublisher({ dceEndpoint: "https://example.com", targets });
    const rows = [{ Service: "orders-api", Measurement: "ResponseTime", Value: 100 }];
    await publisher.publish("ingestion", rows);
    await publisher.publish("otherDcr", [{ Value: 42 }]);
    expect(LogsIngestionClient).toHaveBeenCalledTimes(1);
    const upload = jest.mocked(LogsIngestionClient).mock.results[0].value.upload;
    expect(upload).toHaveBeenNthCalledWith(1, "shared-dcr", INGESTION_STREAM_NAME, rows, { maxConcurrency: 5 });
    expect(upload).toHaveBeenNthCalledWith(2, "other-dcr", "Custom-Other_CL", [{ Value: 42 }], { maxConcurrency: 5 });
  });

  it("supports per-target endpoints and rejects unknown targets", async () => {
    const publisher = new AzureMonitorPublisher({ dceEndpoint: "https://example.com", targets: {
      ...targets,
      remote: { ...targets.ingestion, dceEndpoint: "https://other.example.com" },
    } });
    expect(LogsIngestionClient).toHaveBeenCalledTimes(2);
    await expect(publisher.publish("missing", [{}])).rejects.toThrow("Unknown Azure Monitor target");
  });

  it("accepts caller-defined typed records and an explicit token credential", async () => {
    interface CustomRecord {
      TimeGenerated: string;
      Service: string;
      Measurement: string;
      Value: number | null;
    }
    const credential = { getToken: jest.fn().mockResolvedValue(null) };
    const publisher = new AzureMonitorPublisher({ dceEndpoint: "https://example.com", targets, credential });
    const row: CustomRecord = {
      TimeGenerated: "2026-09-30T00:00:00Z", Service: "orders-api", Measurement: "ResponseTime", Value: null,
    };
    await publisher.publish("ingestion", [row]);
    expect(LogsIngestionClient).toHaveBeenCalledWith("https://example.com", credential);
    expect(jest.mocked(LogsIngestionClient).mock.results[0].value.upload).toHaveBeenCalledWith("shared-dcr", INGESTION_STREAM_NAME, [row], { maxConcurrency: 5 });
  });

  it("skips empty batches and propagates upload failures", async () => {
    const publisher = new AzureMonitorPublisher({ dceEndpoint: "https://example.com", targets });
    const upload = jest.mocked(LogsIngestionClient).mock.results[0].value.upload;
    await publisher.publish("ingestion", []);
    expect(upload).not.toHaveBeenCalled();
    upload.mockRejectedValueOnce(new Error("ingestion unavailable"));
    await expect(publisher.publish("ingestion", [{}])).rejects.toThrow("ingestion unavailable");
  });

  it("rejects incomplete targets before constructing an SDK client", () => {
    expect(() => new AzureMonitorPublisher({ targets: {} })).toThrow("At least one");
    expect(() => new AzureMonitorPublisher({ targets: { invalid: { dcrImmutableId: "", streamName: "stream" } } })).toThrow("requires an endpoint");
    expect(LogsIngestionClient).not.toHaveBeenCalled();
  });
});

describe("AzureMonitorReporter", () => {
  beforeEach(() => jest.clearAllMocks());
  const minimalOptions: AzureMonitorReporterOptions = {
    projectName: "TestProject",
    dceEndpoint: "https://example.com",
    dcrImmutableId: "dcr-id",
    streamName: "stream",
    azureTenantId: "tenant",
    azureClientId: "client",
    azureClientSecret: "secret",
    environment: "test",
    RunId: "run-1",
    commitSHA: "sha",
    debugMode: true,
  };

  it("should initialize with options", () => {
    const reporter = new AzureMonitorReporter(minimalOptions);
    expect(reporter).toBeInstanceOf(AzureMonitorReporter);
  });

  it("should not throw if required Azure config is missing", () => {
    expect(() => new AzureMonitorReporter({})).not.toThrow();
  });

  it("should collect test results on onTestEnd", () => {
    const reporter = new AzureMonitorReporter(minimalOptions);
    // @ts-expect-error: access private
    reporter.currentConfig = {} as FullConfig;
    // @ts-expect-error: access private
    reporter.currentRunSuite = {} as Suite;
    const fakeTest = {
      title: "should do something",
      parent: {
        title: "suite",
        project: () => ({ name: "chromium" }),
      },
      location: { file: "testfile.spec.ts" },
      tags: ["smoke"],
    } as unknown as TestCase;
    const fakeResult = {
      status: "passed",
      duration: 123,
      error: undefined,
      retry: 0,
      workerIndex: 1,
    } as TestResult;
    reporter.onTestEnd(fakeTest, fakeResult);
    // @ts-expect-error: access private
    expect(reporter.testResults.length).toBe(1);
    // @ts-expect-error: access private
    expect(reporter.testResults[0].TestCaseTitle).toBe("should do something");
  });

  it("should handle onBegin and onEnd", async () => {
    const reporter = new AzureMonitorReporter(minimalOptions);
    const fakeConfig = {} as FullConfig;
    const fakeSuite = { allTests: () => [1, 2, 3] } as unknown as Suite;
    reporter.onBegin(fakeConfig, fakeSuite);
    expect(reporter["currentConfig"]).toBe(fakeConfig);
    expect(reporter["currentRunSuite"]).toBe(fakeSuite);
    await expect(
      reporter.onEnd({ status: "passed" } as FullResult)
    ).resolves.toBeUndefined();
  });

  it("should log error on onError", () => {
    const reporter = new AzureMonitorReporter(minimalOptions);
    const spy = jest.spyOn(console, "error").mockImplementation();
    reporter.onError(new Error("fail"));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should strip ANSI codes from error messages", () => {
    const ansiString = "\u001b[31mfail\u001b[0m"; // Example ANSI escape codes
    const strippedString = stripVTControlCharacters(ansiString);
    expect(strippedString).toBe("fail");
  });

  function collectResult(reporter: AzureMonitorReporter) {
    reporter.onTestEnd({
      title: "ingestion check", parent: { title: "suite", project: () => ({ name: "node" }) },
      location: { file: "ingestion.spec.ts" }, tags: [],
    } as unknown as TestCase, {
      status: "passed", duration: 12, retry: 0, workerIndex: 0,
    } as TestResult);
  }

  it("preserves legacy single-stream options and test-result payloads", async () => {
    const reporter = new AzureMonitorReporter(minimalOptions);
    collectResult(reporter);
    await reporter.onEnd({ status: "passed" } as FullResult);
    const upload = jest.mocked(LogsIngestionClient).mock.results[0].value.upload;
    expect(upload).toHaveBeenCalledWith("dcr-id", "stream", [expect.objectContaining({ TestCaseTitle: "ingestion check", RunID: "run-1" })], { maxConcurrency: 5 });
  });

  it("uses a selected named target without sending test rows to metric targets", async () => {
    const reporter = new AzureMonitorReporter({ ...minimalOptions, testResultsTarget: "results", targets: {
      results: { dcrImmutableId: "results-dcr", streamName: "Custom-Results_CL" },
      metrics: { dcrImmutableId: "metrics-dcr", streamName: INGESTION_STREAM_NAME },
    } });
    collectResult(reporter);
    await reporter.onEnd({ status: "passed" } as FullResult);
    const upload = jest.mocked(LogsIngestionClient).mock.results[0].value.upload;
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0].slice(0, 2)).toEqual(["results-dcr", "Custom-Results_CL"]);
  });

  it("preserves legacy logging-only failures but supports strict upload failures", async () => {
    const legacy = new AzureMonitorReporter(minimalOptions);
    collectResult(legacy);
    jest.mocked(LogsIngestionClient).mock.results[0].value.upload.mockRejectedValue(new Error("transport failure"));
    await expect(legacy.onEnd({ status: "passed" } as FullResult)).resolves.toBeUndefined();
    const strict = new AzureMonitorReporter({ ...minimalOptions, failOnUploadError: true });
    collectResult(strict);
    jest.mocked(LogsIngestionClient).mock.results[2].value.upload.mockRejectedValue(new Error("transport failure"));
    await expect(strict.onEnd({ status: "passed" } as FullResult)).rejects.toThrow("transport failure");
  });

  it("keeps the existing authentication fallback and propagates a failed fallback in strict mode", async () => {
    const reporter = new AzureMonitorReporter({ ...minimalOptions, failOnUploadError: true });
    collectResult(reporter);
    const primary = jest.mocked(LogsIngestionClient).mock.results[0].value.upload;
    const fallback = jest.mocked(LogsIngestionClient).mock.results[1].value.upload;
    primary.mockRejectedValue(new Error("credential unavailable"));
    await expect(reporter.onEnd({ status: "passed" } as FullResult)).resolves.toBeUndefined();
    expect(fallback).toHaveBeenCalledTimes(1);
    fallback.mockRejectedValueOnce(new Error("fallback unavailable"));
    await expect(reporter.onEnd({ status: "passed" } as FullResult)).rejects.toThrow("fallback unavailable");
  });

  it("rejects missing selected targets and strict incomplete configuration", () => {
    expect(() => new AzureMonitorReporter({ targets: {}, testResultsTarget: "missing" })).toThrow("Unknown test-results target");
    expect(() => new AzureMonitorReporter({ dceEndpoint: "https://example.com", dcrImmutableId: "dcr", streamName: "", failOnUploadError: true })).toThrow("are required");
  });
});
