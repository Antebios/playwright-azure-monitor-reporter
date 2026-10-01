import { ClientSecretCredential, DefaultAzureCredential } from "@azure/identity";
import { LogsIngestionClient } from "@azure/monitor-ingestion";

export interface AzureMonitorTarget {
  dcrImmutableId: string;
  streamName: string;
  dceEndpoint?: string;
}

export interface AzureMonitorPublisherOptions {
  dceEndpoint?: string;
  azureTenantId?: string;
  azureClientId?: string;
  azureClientSecret?: string;
  credential?: ConstructorParameters<typeof LogsIngestionClient>[1];
  targets: Record<string, AzureMonitorTarget>;
}

export class AzureMonitorPublisher {
  private readonly targets = new Map<string, AzureMonitorTarget & { client: LogsIngestionClient }>();

  constructor(options: AzureMonitorPublisherOptions) {
    const targetEntries = Object.entries(options.targets);
    if (targetEntries.length === 0) {
      throw new Error("At least one Azure Monitor target is required.");
    }
    const endpoint = options.dceEndpoint || process.env.LOG_ANALYTICS_DCE_ENDPOINT || "";
    for (const [name, target] of targetEntries) {
      if (!name.trim() || !target.dcrImmutableId?.trim() || !target.streamName?.trim() || !(target.dceEndpoint || endpoint)?.trim()) {
        throw new Error(`Azure Monitor target '${name}' requires an endpoint, DCR immutable ID, and stream name.`);
      }
    }
    const tenantId = options.azureTenantId || process.env.AZURE_TENANT_ID;
    const clientId = options.azureClientId || process.env.AZURE_CLIENT_ID;
    const clientSecret = options.azureClientSecret || process.env.AZURE_CLIENT_SECRET;
    const credential = options.credential || (
      tenantId && clientId && clientSecret
        ? new ClientSecretCredential(tenantId, clientId, clientSecret)
        : new DefaultAzureCredential(clientId ? { managedIdentityClientId: clientId } : undefined)
    );
    const clients = new Map<string, LogsIngestionClient>();
    for (const [name, target] of targetEntries) {
      const targetEndpoint = target.dceEndpoint || endpoint;
      let client = clients.get(targetEndpoint);
      if (!client) {
        client = new LogsIngestionClient(targetEndpoint, credential);
        clients.set(targetEndpoint, client);
      }
      this.targets.set(name, { ...target, client });
    }
  }

  async publish<TRecord extends object>(targetName: string, records: TRecord[]): Promise<void> {
    const target = this.targets.get(targetName);
    if (!target) {
      throw new Error(`Unknown Azure Monitor target '${targetName}'.`);
    }
    if (records.length === 0) {
      return;
    }
    await target.client.upload(target.dcrImmutableId, target.streamName, records as Record<string, unknown>[], {
      maxConcurrency: 5,
    });
  }
}