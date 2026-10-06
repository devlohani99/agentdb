export type DemoCustomer = {
  id: string;
  name: string;
};

export type DemoTenant = {
  id: string;
  name: string;
  apiKey: string;
  customers: DemoCustomer[];
};

export const DEMO_TENANTS: DemoTenant[] = [
  {
    id: "demo",
    name: "Acme Corp",
    apiKey: "dev-demo-key",
    customers: [
      { id: "cust-alice", name: "Alice Chen" },
      { id: "cust-bob", name: "Bob Rivera" },
    ],
  },
  {
    id: "demo-b",
    name: "Globex",
    apiKey: "dev-demo-b-key",
    customers: [
      { id: "cust-carol", name: "Carol Smith" },
      { id: "cust-dan", name: "Dan Lee" },
    ],
  },
];

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";
