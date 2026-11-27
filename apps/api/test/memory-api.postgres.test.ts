import { POSTGRES } from "@open-qa-stack/store/testing";
import { memoryApiSuite } from "./suites/memory-api.ts";

memoryApiSuite(POSTGRES);
