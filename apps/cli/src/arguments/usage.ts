/** How to run the command, as `oqas --help` prints it. */
export const USAGE = `Usage: oqas [--repository <folder>] [--environment <name>]
       oqas [--repository <folder>] [--environment <name>] --brief <text> [--follow] [--output text|json] [--no-input]
       oqas [--repository <folder>] sessions [--output text|json]
       oqas [--repository <folder>] show <session> [--follow] [--output text|json]
       oqas [--repository <folder>] attach <session> [--follow] [--output text|json]
       oqas [--repository <folder>] say <session> <text> [--output text|json]
       oqas [--repository <folder>] stop <session> [--output text|json]
       oqas [--repository <folder>] agents [instruct <agent> <text>|clear <agent>|prompt <agent>|default <agent>|replace <agent> <file>|reset <agent>] [--output text|json]
       oqas [--repository <folder>] config show|import|export|history|check [--output text|json]
       oqas [--repository <folder>] project [--output text|json]
       oqas [--repository <folder>] repository [--output text|json]
       oqas [--repository <folder>] model
       oqas [--repository <folder>] model status [--output text|json]
       oqas [--repository <folder>] model set --github --model <id> [--output text|json]
       oqas [--repository <folder>] model set --provider <name|address> [--key-env <variable>] --model <id> [--output text|json]
       oqas [--repository <folder>] knowledge list [--output text|json]
       oqas [--repository <folder>] knowledge add-document <source> <file>... [--output text|json]
       oqas [--repository <folder>] knowledge check [<source>] [--output text|json]
       oqas [--repository <folder>] applications check [<application>] [--output text|json]
       oqas [--repository <folder>] knowledge mapping|domains [--output text|json]
       oqas [--repository <folder>] knowledge remap [<source>]
       oqas [--repository <folder>] knowledge read|remove <source> <document> [--output text|json]
       oqas [--repository <folder>] tests [--output text|json]
       oqas [--repository <folder>] tests read|executions|versions|source <test> [--output text|json]
       oqas [--repository <folder>] tests rename <test> <title> <new title> [--output text|json]
       oqas [--repository <folder>] tests step <test> <title> <step> <text> [--output text|json]
       oqas [--repository <folder>] tests trace <test> <file>
       oqas [--repository <folder>] tests capture <test> <step> <file>
       oqas [--repository <folder>] reviews [show <id>|validate <id>|restore <id>|correct <id> <what to change>] [--output text|json]
       oqas [--repository <folder>] defects [report <test> <title of the test> <severity> <title> [<description>]|fix|close|open <id>] [--output text|json]
       oqas [--repository <folder>] memory [add design|discovery|all project|<application> <instruction>|on <id>|off <id>|reword <id> <text>] [--output text|json]
       oqas [--repository <folder>] reviews set-aside <id> covered <test> [<note>]|out-of-scope|wrong-oracle|wrong-level [<note>] [--output text|json]
       oqas [--repository <folder>] launch [<test>...] [--environment <name>] [--output text|json]
       oqas [--repository <folder>] campaigns [--output text|json]
       oqas [--repository <folder>] campaigns plan <name> --environment <name> [--objective <text>] [--target <version>] [--from <day>] [--until <day>] [--owner <text>]
            [--output text|json]
       oqas [--repository <folder>] campaigns show|ready|close <campaign> [--output text|json]
       oqas [--repository <folder>] campaigns choose <campaign> <test>... [--output text|json]
       oqas [--repository <folder>] campaigns launch <campaign> [failed|not-run] [--output text|json]
       oqas [--repository <folder>] executions [--outcome failing|passing] [--origin design|manual|campaign] [--before <execution>] [--output text|json]
       oqas [--repository <folder>] executions show <execution> [--output text|json]
       oqas [--repository <folder>] secrets [--output text|json]
       oqas [--repository <folder>] secrets set <variable>
       oqas [--repository <folder>] --ui [--host <address>] [--port <number>]
       oqas [--repository <folder>] --init

Without a command, in a terminal, opens a conversation: say what to test and a session opens, its thread is
followed live, what you type is said to its agents or, once it ended, goes on with it, and / lists the commands. With --brief, opens a session: maps the target application, designs Playwright tests on a new local branch, runs
them and gives a verdict per test. The other commands read the sessions of the test repository and act on one,
from any terminal: <session> is its identifier, or the start or the end of it when no other session shares it.
With --ui, serves the console of the test repository in a browser, on this machine, until Ctrl-C: the sessions
opened in it run in this process, and those of the other terminals are shown and followed in it.

Commands:
  sessions               List the sessions, the latest first.
  show <session>         Print a session and its thread so far.
  attach <session>       Follow a session to its end, as the command that opened it does.
  say <session> <text>   Say something to the agents of a session that goes on, or go on with one that ended:
                         its new turn runs here, followed to its end.
  stop <session>         Interrupt a session that goes on.
  agents                 List what the team asks of each agent.
  agents instruct <agent> <text>
                         Add instructions of the team at the end of the prompt of an agent.
  agents clear <agent>   Take them back.
  agents prompt <agent>  Print the prompt of an agent in force: its own, or the one of the team.
  agents default <agent> Print the prompt of an agent as the code writes it, where {{name}} stands for a variable.
  agents replace <agent> <file>
                         Put the prompt the file holds in place of that of an agent; what the harness adds after it stays.
  agents reset <agent>   Give the agent its own prompt back.
  config show            Print the configuration in force, and how oqas.json stands to it.
  config import          Take oqas.json as the configuration in force, when it differs.
  config export          Write the configuration in force over oqas.json, when it differs.
  config history         List the revisions of the configuration, the latest first, and where each was made.
  config check           Check oqas.json without taking it: each error where it is. Exits with 0 when it is valid,
                         with 3 otherwise.
  project                Name the project of the instance, and its applications.
  repository             Tell where the test repository stands: its folder, whether it is a git repository with a
                         commit, and whether it is a Playwright project.
  model                  In a terminal, set the connection to the model step by step: how to reach it, the
                         variable of its key and the key itself when it holds none, a test, then the model among
                         those it offers.
  model status           Test the connection to the model in force, and list the models it offers.
  model set              Set the connection to the model, then test it: --github for the GitHub account this machine
                         signed in with (gh auth login), or --provider with the name of a provider (OpenAI, Mistral AI,
                         OpenRouter…) or the address of an OpenAI-compatible server, and --model.
  knowledge list         List the knowledge sources of the configuration in force, and the documents the instance
                         keeps of each source declared "stored": true.
  knowledge add-document <source> <file>...
                         Upload Markdown files as documents of such a source, all of them or none: a document of
                         the same name is replaced.
  knowledge check [<source>]
                         Test that the knowledge sources answer, or one of them, without the model and indexing
                         nothing: exits with 0 when each answers, with 4 otherwise.
  applications check [<application>]
                         Test that each address of the environments answers — that of the interface, those of the
                         APIs —, of every application or of the one named: exits with 0 when each answers, with 4
                         otherwise.
  knowledge remap [<source>]
                         Map the knowledge again: the source named, or every source, is read again by a session
                         this command opens and follows to its end, unless one maps the knowledge already.
  knowledge mapping      Tell where the cartography of the knowledge stands: each source mapped, truncated, being
                         mapped or waiting, and the knowledge base that puts them together.
  tests                  List the tests of the test repository, each with its level, domain, functionality and case
                         when its tags give them, and the files whose tests cannot all be listed.
  tests verdicts         List what came of each test the last time it ran.
  tests read <test>      Read a test in steps, as the latest run that ran it reported it: <test> is the path of its
                         file, relative to the test repository.
  tests executions <test>
                         List what came of the tests of the file in the latest executions that ran them.
  tests versions <test>  List the versions of the tests of the file, the latest first.
  tests source <test>    Print the code of the file of the test, as it is now.
  tests rename <test> <title> <new title>
                         Change the own title of the test of the file that <title> names, as oqas tests lists it. A
                         test changed is given its tag @oqas-id-<uuid> if it bears none, and keeps its history. The
                         file is committed alone on the branch checked out.
  tests step <test> <title> <step> <text>
                         Change the text of a step of that test, by its number from 1; the number the harness wrote
                         before it stays.
  tests trace <test> <file>
                         Write the trace the latest run kept of the test to the file, which npx playwright show-trace opens.
  tests capture <test> <step> <file>
                         Write the capture the latest run attached for the step of the test to the file.
  reviews                List the tests the agents wrote for you to review, and those you set aside, the oldest
                         design first.
  reviews show <id>      Tell what you read to decide of one of them: why it was written, its steps, the remarks
                         of the agents that reviewed it, and the files its design wrote.
  defects                List the defects reported from tests that failed, the latest first.
  defects report <test> <title of the test> <severity> <title> [<description>]
                         Report a defect of a test of the file, from S1 (blocking) to S4 (cosmetic).
  defects fix|close|open <id>
                         Mark a defect fixed, close it, or open it again. Fixed, its test is to run again until it passes.
  memory                 List what the agents keep in mind: the instructions you gave them, and what they noted.
  memory add <work> <where> <instruction>
                         Give the agents an instruction, for design, discovery or all, kept to the project or to an
                         application: they are given it before each task of that work.
  memory on|off <id>     Have the agents keep a line in mind, or set it aside.
  memory reword <id> <text>
                         Change what a line says.
  reviews validate <id>  Take the test into the working branch: its file and those its design wrote are committed
                         there, in this checkout, which is left on that branch. Nothing is pushed.
  reviews set-aside <id> <reason> [<note>]
                         Leave the test out, with why: covered then the test that covers it, out-of-scope,
                         wrong-oracle or wrong-level. It stays listed, set aside.
  reviews restore <id>   Put a test you set aside back in review, as it was.
  reviews correct <id> <what to change>
                         Have the session that wrote the test correct it as you say: this command runs its new turn
                         and follows it. The test is to review again once it ended.
  launch [<test>...]     Launch tests of the test repository as they are, with no agent, in this process, against
                         --environment, and follow them to their end: every test, or those of the files named.
                         It exits with 0 when each passed, 1 when one failed, 2 when one was skipped.
  campaigns              List the campaigns, the latest planned first, with how many of their tests came to each verdict.
  campaigns plan <name>  Plan a campaign against --environment, with no test yet: what it is for, the version it tests,
                         the days it is meant to run and who answers for it may be said.
  campaigns choose <campaign> <test>...
                         Choose the tests of a campaign that is planned: every test of the files named.
  campaigns ready <campaign>
                         Fix the tests of a campaign: it may be launched from then on.
  campaigns launch <campaign> [failed|not-run]
                         Launch its tests, every one, those that failed or those not run yet, as oqas launch does.
  campaigns show <campaign>
                         Print a campaign with what came of each of its tests.
  campaigns close <campaign>
                         Close a campaign for good: what came of its tests is fixed.
  executions             List the executions of tests, the latest first, twenty at a time: --outcome keeps those
                         where a test failed or none did, --origin those of an origin, --before starts after an
                         execution.
  executions show <execution>
                         Print an execution, with what came of each of its tests and why a test failed.
  knowledge domains      List the domains the cartography found in the knowledge.
  knowledge exclude|restore <domain>
                         Keep a domain from the sessions and the agents, or take it back.
  knowledge rename <domain> <name>
                         Give a domain another name; the one the cartography gave takes it back.
  knowledge read <source> <document>
                         Print a document a source of the instance keeps.
  knowledge remove <source> <document>
                         Remove it from the source.
  secrets                List the variables the configuration names (the key of the model, the connection strings,
                         the test accounts) and where the value of each comes from: the environment, which wins, a
                         value saved on this machine, or none yet.
  secrets set <variable> Save the value of one of them on this machine, out of the test repository: typed without
                         being shown in a terminal, read from the input otherwise. A value saved is replaced.

Options:
  --repository <folder>  The test repository, which holds oqas.json once it is set up; the current folder by default.
  --environment <name>   The environment to run against; the only one declared by default.
  --brief <text>         What to test, in your words: a domain, a ticket, a rule, a journey.
  --follow               Print what the agents do besides what the harness tells: each tool call, its result, each message.
  --output text|json     How to print: lines to read, the default, or JSON Lines, one event of the session a line.
  --no-input             Never ask anything on the terminal: without a command, the conversation is not opened.
  --ui                   Serve the console of the test repository and print its address; Ctrl-C stops it.
  --host <address>       With --ui, the address to listen on; 127.0.0.1 by default. The console asks nobody who
                         they are: keep it on this machine.
  --port <number>        With --ui, the port to listen on; 6727 by default, 0 for any free port.
  --github               With model set: reach the model with the GitHub account of this machine, for GitHub Copilot.
  --provider <provider>  With model set: the name of a provider, or the address of an OpenAI-compatible server.
  --key-env <variable>   With model set and --provider: the variable that holds the key; that of the provider by default.
  --model <id>           With model set: the model to use, as the connection names it.
  --outcome failing|passing
                         With executions: keep those where a test failed, or those where none did.
  --origin design|manual|campaign
                         With executions: keep those a session ran, those launched by hand, or those of a campaign.
  --objective <text>     With campaigns plan: what the campaign is for.
  --target <version>     With campaigns plan: the version of the application it tests.
  --from <day>, --until <day>
                         With campaigns plan: the first and the last day it is meant to run, such as 2026-12-01.
  --owner <text>         With campaigns plan: who answers for it.
  --before <execution>   With executions: start the page after this execution.
  --init                 Initialise the test repository as a Playwright project, from its oqas.json: write the files it
                         lacks, overwrite none, run nothing.
  --help                 Print this help.

Exit codes of a session followed to its end, and of the conversation for the last session it opened: 0 every test passed, 1 a test failed, 2 a test was blocked,
indeterminate, skipped or not run, 3 the configuration or the arguments are invalid, 4 a prerequisite is missing,
5 the session did not go to its end. model status and model set exit with 0 when the model answers and is among those
it offers, with 4 otherwise. The other commands exit with 0, with 3 when they are refused, with 5 when they fail.
--ui exits with 0 once it is stopped, and so does a conversation that opened no session.
`;
