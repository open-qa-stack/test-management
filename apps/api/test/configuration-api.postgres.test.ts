import { POSTGRES } from "@open-qa-stack/store/testing";
import { configurationApiSuite } from "./suites/configuration-api.ts";

configurationApiSuite(POSTGRES);
