import { SQLITE } from "@open-qa-stack/store/testing";
import { knowledgeApiSuite } from "./suites/knowledge-api.ts";

knowledgeApiSuite(SQLITE);
