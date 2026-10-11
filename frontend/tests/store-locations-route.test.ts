import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/store-locations/route";

const { getCatalog } = vi.hoisted(() => ({ getCatalog: vi.fn() }));

vi.mock("../lib/catalog", () => ({ getCatalog }));

describe("store location route", () => {
  beforeEach(() => {
    getCatalog.mockReset();
    getCatalog.mockResolvedValue({
      catalog: {
        products: [],
        offers: [],
        swaps: [],
        stores: [
          {
            id: "kroger:branch:1100461",
            name: "Kroger - Edgewood",
            address: "1225 Caroline St NE, Atlanta, GA 30307",
            latitude: 33.756079,
            longitude: -84.3480363,
          },
          {
            id: "lidl:catalog:zip:30302",
            name: "Lidl - Online catalog",
            latitude: 33.7499,
            longitude: -84.3885,
          },
        ],
      },
    });
  });

  it("returns live Supabase-backed coordinates for requested stores", async () => {
    const response = await POST(new Request("http://localhost/api/store-locations", {
      method: "POST",
      body: JSON.stringify({ storeIds: ["kroger:branch:1100461"] }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      stores: [{
        id: "kroger:branch:1100461",
        name: "Kroger - Edgewood",
        address: "1225 Caroline St NE, Atlanta, GA 30307",
        lat: 33.756079,
        lon: -84.3480363,
      }],
    });
  });

  it("rejects an invalid store ID request", async () => {
    const response = await POST(new Request("http://localhost/api/store-locations", {
      method: "POST",
      body: JSON.stringify({ storeIds: [] }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(400);
    expect(getCatalog).not.toHaveBeenCalled();
  });
});
