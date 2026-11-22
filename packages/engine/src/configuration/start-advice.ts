import { CONFIG_FILE_NAME } from "@open-qa-stack/domain";

/** What a person is told to do in a test repository that holds no configuration yet: the console, or the conversation, sets it up step by step. */
export const START_ADVICE = `Start with oqas in a terminal or oqas --ui, which set it up step by step, or write a ${CONFIG_FILE_NAME} at the root of the test repository.`;
