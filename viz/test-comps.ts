import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { ParcelService } from "../../civil-api-js/civil/public/parcels/v1/parcels_connect";
import { GetEquityComparablesRequestSchema } from "../../civil-api-js/civil/public/parcels/v1/parcels_pb";
import { create } from "@bufbuild/protobuf";

async function run() {
  const transport = createConnectTransport({
    baseUrl: "http://localhost:8080",
    httpVersion: "1.1"
  });
  const client = createPromiseClient(ParcelService, transport);
  
  const req = create(GetEquityComparablesRequestSchema, {
    selectedParcelIds: ["f08eb111-b0a2-4919-8d02-6dd0e2ba24ac"]
  });
  
  try {
    const res = await client.getEquityComparables(req);
    const p = res.parcels["f08eb111-b0a2-4919-8d02-6dd0e2ba24ac"];
    console.log("Parcel UUID:", p.parcelId);
    console.log("Feature ID:", p.featureId);
    console.log("Feature ID Type:", typeof p.featureId);
    console.log("Attributes:", p.attributes?.length);
  } catch (err) {
    console.error(err);
  }
}
run();
