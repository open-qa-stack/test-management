import { POSTGRES } from "@open-qa-stack/store/testing";
import { campaignsApiSuite } from "./suites/campaigns-api.ts";

campaignsApiSuite(POSTGRES);
