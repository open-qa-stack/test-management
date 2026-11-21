import { CONFIG_FILE_NAME } from "@open-qa-stack/domain";

/** What a person is told to do in a test repository that holds no configuration yet: the console sets it up step by step. */
export const START_ADVICE = `Start with oqas --ui, which sets it up step by step, or write a ${CONFIG_FILE_NAME} at the root of the test repository.`;
