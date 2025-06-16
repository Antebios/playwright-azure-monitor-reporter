![Azure Monitor Overview](images/azure-monitor-overview.jpg)

## Create an Azure Data Collection Endpoint

Azure Data Collection Endpoints are used to ingest data into Azure Monitor Logs.

Steps to create a Data Collection Endpoint via Azure Portal:

1. Navigate to Azure Monitor:

   - In the Azure portal, search for and select "Monitor".

2. Access Data Collection Endpoints:

   - In the Monitor menu, under the "Settings" section, select "Data Collection Endpoints".

   ![](images/azure-monitor-dce-01.png)

3. Create a New Endpoint:

   - Click on the "+ Create" button.

4. Basics Tab:

   ![](images/azure-monitor-dce-02.png)

   - Endpoint Name: Provide a unique name for your data collection endpoint.
   - Subscription: Select your Azure subscription.
   - Resource Group: Choose an existing resource group or create a new one.
   - Region: Select the Azure region where you want to deploy the endpoint. This should ideally be the same region as your Log Analytics workspace and the resources sending data.
   - Click "Review + create".

5. Review + Create Tab:

   - bReview the configuration.
   - Click "Create".

Deployment will take a few moments. Once created, you can find your Data Collection Endpoint listed. You'll need its Logs ingestion URI when configuring data sources (like custom logs or using client libraries) to send data to Azure Monitor.

This endpoint acts as the ingestion point for data that will then be processed by Data Collection Rules (DCRs) before being sent to your Log Analytics workspace(s).

## Create an Azure Data Collection Table and Rule

Azure Data Collection Rules (DCRs) define what data to collect, how to transform it, and where to send it. They are used in conjunction with Data Collection Endpoints (DCEs) to ingest data into Azure Monitor Logs.

**Steps to create a Data Collection Rule via Azure Portal:**

### Create the Table

1. **Navigate to your log Log Analytics Workspace:**

   - In the Azure portal navigate to your Log Analytics workspace (LAW).

2. **Create a new Custom Log:**

   - Under the "Settings" section, select "Tables".
   - Click on the "+ Create" button.
     azure-monitor-dcr-01.png
     ![dcr-01](images/azure-monitor-dcr-01.png)

   - Select "New custom log (DCR-based)"
     ![dcr-02](images/azure-monitor-dcr-02.png)

3. **Create a custom log**

   ![dcr-03](images/azure-monitor-dcr-03.png)

   - **Table Name**: Enter a new table name to store your logs.
   - **Data Collection Endpoint**: Select the endpoint created above.
   - **Data Collection Rule**: Click on "Create a new data collection rule" link

### Create the Rule

![dcr-04](images/azure-monitor-dcr-04.png)

1. **Subscription:** Select your Azure subscription.

2. **Resource Group:** Choose an existing resource group or create a new one.

3. **Name:** Enter a unique name for your data collection rule.

4. Click Done.

### Continue to configure the custom log

1. Click "Next" to proceed after the Data Collection Rule is created.
2. Drag-and-drop the sample file [data-sample.json](../src/data-sample.json)

   ![dcr-05](images/azure-monitor-dcr-05.png)

3. The uploaded sample will appear:

   ![dcr-06](images/azure-monitor-dcr-06.png)

4. Click Next

5. Review and then click Next.

   ![dcr-07](images/azure-monitor-dcr-07.png)

Once created, the DCR will be associated with the selected resources and will start collecting data according to the defined data sources and sending it to the specified destinations via the associated Data Collection Endpoint.

Be sure to note the Data Collection Rule **Immutable ID** and the **Data Source** from "Configuration >> Data sources", as they will be needed for configuring the Playwright configuration file.

![dcr-08](images/azure-monitor-dcr-08.png)

![dcr-08](images/azure-monitor-dcr-09.png)

The new table **will not** appear in the LAW Tables until a log is sent to the endpoint.

## Create Environment Variables

In your Playwright project create this environment variables:

- **AZURE_TENANT_ID**: Your Azure Tenent ID
- **AZURE_CLIENT_ID**: Your Azure Client ID
- **AZURE_CLIENT_SECRET**: Your Azure Client Secret
- **LOG_ANALYTICS_DCE_ENDPOINT**: The ingestion URI from your Data Collection Endpoint
- **LOG_ANALYTICS_DCR_IMMUTABLE_ID**: The immutable ID of your Data Collection Rule
- **LOG_ANALYTICS_STREAM_NAME**: The stream name you defined in your DCR (e.g., Custom-PlaywrightTests_CL)

## Run a Playwright test

![dcr-11](images/azure-monitor-dcr-11.png)

![dcr-12](images/azure-monitor-dcr-12.png)

![dcr-13](images/azure-monitor-dcr-13.png)
n